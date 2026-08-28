'use strict';

const path = require('path');
const crypto = require('crypto');
const fsp = require('fs').promises;

const KEY_FILE = 'mcp-key.json';

function generateKey() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Persists the Local API / MCP shared key in userData/mcp-key.json so the key
 * survives app restarts. An explicit key (OPENBROWSER_API_KEY env) always wins
 * and never touches the file, so unsetting the env later falls back to the
 * previously stored key instead of minting a new one.
 */
class ApiKeyStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, KEY_FILE);
    this.apiKey = '';
  }

  async resolve(explicitKey) {
    if (explicitKey) {
      this.apiKey = String(explicitKey);
      return this.apiKey;
    }
    try {
      const saved = JSON.parse(await fsp.readFile(this.filePath, 'utf8'));
      if (typeof saved.apiKey === 'string' && saved.apiKey) {
        this.apiKey = saved.apiKey;
        return this.apiKey;
      }
    } catch (_) {
      // first launch, or unreadable/corrupt file — regenerate below
    }
    this.apiKey = generateKey();
    try {
      await this.save();
    } catch (error) {
      // Degrade to the old per-launch behavior instead of killing the whole
      // automation stack when userData is unwritable (locked file, AV scan).
      console.warn('OpenBrowser mcp-key.json persist failed, key is session-only:', error.message);
    }
    return this.apiKey;
  }

  async rotate() {
    this.apiKey = generateKey();
    await this.save();
    return this.apiKey;
  }

  async save() {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = this.filePath + '.tmp';
    await fsp.writeFile(temporary, JSON.stringify({ version: 1, apiKey: this.apiKey }, null, 2), { mode: 0o600 });
    await fsp.rm(this.filePath, { force: true });
    await fsp.rename(temporary, this.filePath);
  }
}

module.exports = { ApiKeyStore, KEY_FILE };
