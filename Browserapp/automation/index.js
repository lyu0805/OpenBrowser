'use strict';

const path = require('path');
const { LocalApiServer } = require('./local-api-server');
const { RpaEngine } = require('./rpa-engine');
const { RpaStore } = require('./rpa-store');
const { WindowSyncBridge } = require('./window-sync-bridge');
const { AppCenter } = require('./app-center');
const { ProxyStore } = require('./proxy-store');
const { ApiKeyStore } = require('./api-key-store');

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
  } = context;

  const apiKeyStore = new ApiKeyStore(app.getPath('userData'));
  const apiKey = await apiKeyStore.resolve(context.apiKey || process.env.OPENBROWSER_API_KEY || '');

  const storePath = path.join(app.getPath('userData'), 'rpa-store.json');
  const rpaStore = new RpaStore(storePath);
  await rpaStore.load();

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

  const localApi = new LocalApiServer({
    host: '127.0.0.1',
    port,
    apiKey,
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

  return {
    localApi,
    rpaEngine,
    rpaStore,
    syncBridge,
    appCenter,
    proxyStore,
    info,
    apiKey,
    apiKeyStore,
    async rotateApiKey() {
      const key = await apiKeyStore.rotate();
      localApi.setApiKey(key);
      this.apiKey = key;
      return key;
    },
    async stop() {
      await rpaEngine.stop();
      await localApi.stop();
    },
  };
}

module.exports = {
  startAutomation,
  LocalApiServer,
  RpaEngine,
  RpaStore,
  WindowSyncBridge,
  AppCenter,
  ProxyStore,
  ApiKeyStore,
};
