'use strict';

const path = require('path');
const crypto = require('crypto');
const fsp = require('fs/promises');
const { LocalApiServer, normalizeApiKey } = require('./local-api-server');
const { RpaEngine } = require('./rpa-engine');
const { RpaStore } = require('./rpa-store');
const { WindowSyncBridge } = require('./window-sync-bridge');
const { AppCenter } = require('./app-center');
const { ProxyStore } = require('./proxy-store');

/**
 * Mount automation stack (Local API + RPA + window-sync + app center + proxy library).
 * MCP is a separate stdio process: `node automation/mcp-server.js`.
 * Fully self-contained — does not call or embed external browser binaries.
 */
async function startAutomation(context = {}) {
  const {
    app,
    engine,
    liveSync,
    beginSync,
    endSync,
    restartSync,
    getSyncState,
    setSelection,
    tile,
    emit = () => {},
    port = Number(process.env.OPENBROWSER_API_PORT || 50325),
    apiKey = process.env.OPENBROWSER_API_KEY || '',
  } = context;

  const storePath = path.join(app.getPath('userData'), 'rpa-store.json');
  const rpaStore = new RpaStore(storePath);
  await rpaStore.load();

  const apiKeyPath = path.join(app.getPath('userData'), 'local-api-key');
  const savedApiKey = await fsp.readFile(apiKeyPath, 'utf8').catch(() => '');
  let resolvedApiKey;
  try { resolvedApiKey = normalizeApiKey(apiKey || savedApiKey); }
  catch (error) {
    if (apiKey) throw error;
    resolvedApiKey = normalizeApiKey(crypto.randomBytes(32).toString('base64url'));
  }
  const persistApiKey = async (value) => {
    const temporary = apiKeyPath + '.tmp';
    await fsp.writeFile(temporary, value, { encoding: 'utf8', mode: 0o600 });
    await fsp.rename(temporary, apiKeyPath);
    await fsp.chmod(apiKeyPath, 0o600).catch(() => {});
  };
  if (savedApiKey.trim() !== resolvedApiKey) await persistApiKey(resolvedApiKey);

  const proxyStore = new ProxyStore(path.join(app.getPath('userData'), 'proxy-library.json'));
  await proxyStore.load();

  const rpaEngine = new RpaEngine({
    engine,
    store: rpaStore,
    emit: (event) => emit(event),
    userDataPath: app.getPath('userData'),
  });

  const syncBridge = new WindowSyncBridge({
    getLiveSync: () => liveSync,
    beginSync,
    endSync,
    restartSync,
    getSyncState,
    setSelection,
    tile,
    getSettings: () => liveSync.getSettings(),
    updateSettings: (value) => liveSync.updateSettings(value),
  });

  const appCenter = new AppCenter({ engine });
  let service = null;

  const localApi = new LocalApiServer({
    host: '127.0.0.1',
    port,
    apiKey: resolvedApiKey,
    onApiKeyChange: async (value) => {
      await persistApiKey(value);
      if (service) service.apiKey = value;
    },
    engine,
    rpaEngine,
    rpaStore,
    syncBridge,
    appCenter,
    proxyStore,
    getVersion: () => app.getVersion(),
  });

  const info = await localApi.start();
  emit({ type: 'local-api', ...info });

  service = {
    localApi,
    rpaEngine,
    rpaStore,
    syncBridge,
    appCenter,
    proxyStore,
    info,
    apiKey: resolvedApiKey,
    async setApiKey(value) {
      await localApi.setApiKey(value);
      service.apiKey = localApi.apiKey;
      emit({ type: 'local-api-key-changed' });
      return { ...localApi.info(), apiKey: service.apiKey };
    },
    async stop() {
      await rpaEngine.stop();
      await localApi.stop();
    },
  };
  return service;
}

module.exports = {
  startAutomation,
  LocalApiServer,
  RpaEngine,
  RpaStore,
  WindowSyncBridge,
  AppCenter,
  ProxyStore,
};
