'use strict';

/**
 * Minimal stdio MCP server for OpenBrowser Local API.
 * Protocol subset: initialize, tools/list, tools/call (JSON-RPC 2.0 over NDJSON/stdio).
 *
 * Run standalone:
 *   OPENBROWSER_API_PORT=50325 OPENBROWSER_API_KEY=your_api_key node automation/mcp-server.js
 *
 * Cursor / Claude Desktop config example:
 * {
 *   "mcpServers": {
 *     "openbrowser-local-api": {
 *       "command": "node",
 *       "args": ["/path/to/Browserapp/automation/mcp-server.js"],
 *       "env": { "OPENBROWSER_API_PORT": "50325", "OPENBROWSER_API_KEY": "your_api_key" }
 *     }
 *   }
 * }
 */

const http = require('http');

const PORT = Number(process.env.OPENBROWSER_API_PORT || process.env.PORT || 50325);
const HOST = process.env.OPENBROWSER_API_HOST || '127.0.0.1';
const API_KEY = process.env.OPENBROWSER_API_KEY || process.env.API_KEY || '';

function request(method, path, body, options = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: HOST,
      port: PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(API_KEY ? { 'api-key': API_KEY } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      timeout: Number(options.timeout) || 30000,
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data || '{}'));
        } catch (error) {
          reject(new Error(`Invalid JSON from Local API: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Local API timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

const TOOLS = [
  {
    name: 'list_profiles',
    description: 'List browser profiles and running status (debug ports)',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'start_profile',
    description: 'Start a browser profile by id',
    inputSchema: {
      type: 'object',
      properties: { profile_id: { type: 'string' } },
      required: ['profile_id'],
    },
  },
  {
    name: 'stop_profile',
    description: 'Stop a browser profile by id',
    inputSchema: {
      type: 'object',
      properties: { profile_id: { type: 'string' } },
      required: ['profile_id'],
    },
  },
  {
    name: 'list_active_browsers',
    description: 'List currently active browser profiles',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'stop_all_profiles',
    description: 'Stop every running browser profile',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'profile_create',
    description: 'Create a browser profile. Common fields: name, remark, proxy (e.g. "socks5://user:pass@host:port"), user_proxy_config {proxy_type,proxy_host,proxy_port,proxy_user,proxy_password}, privacy, language',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'optional custom id ([A-Za-z0-9_-]{1,64}); generated when omitted' },
        name: { type: 'string' },
        proxy: { type: 'string' },
        user_proxy_config: { type: 'object' },
        privacy: { type: 'object' },
        language: { type: 'string' },
      },
    },
  },
  {
    name: 'profile_delete',
    description: 'Delete browser profile(s) and their local data',
    inputSchema: {
      type: 'object',
      properties: {
        profile_id: { type: 'string' },
        profile_ids: { type: 'array', items: { type: 'string' } },
        delete_data: { type: 'boolean', description: 'default true' },
      },
    },
  },
  {
    name: 'window_sync_start',
    description: 'Start multi-window sync. First profile is master.',
    inputSchema: {
      type: 'object',
      properties: {
        profile_ids: { type: 'array', items: { type: 'string' } },
        operate: { type: 'string', description: 'comma list: click,move,scroll,keyboard' },
      },
      required: ['profile_ids'],
    },
  },
  {
    name: 'window_sync_stop',
    description: 'Stop multi-window sync',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'window_sync_status',
    description: 'Get window sync status',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'window_sync_restart',
    description: 'Restart multi-window sync',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'window_sync_arrange',
    description: 'Arrange profile windows (tile or cascade)',
    inputSchema: {
      type: 'object',
      properties: {
        profile_ids: { type: 'array', items: { type: 'string' } },
        mode: { type: 'string', description: 'tile (default) | cascade' },
      },
      required: ['profile_ids'],
    },
  },
  {
    name: 'window_sync_settings',
    description: 'Get sync settings, or update them when settings object is given',
    inputSchema: {
      type: 'object',
      properties: { settings: { type: 'object' } },
    },
  },
  {
    name: 'rpa_run_steps',
    description: 'Run RPA steps on a running profile (goto/click/type/wait/scroll/evaluate/...). Set wait:false for long tasks — returns task_id immediately; poll rpa_task_result',
    inputSchema: {
      type: 'object',
      properties: {
        profile_id: { type: 'string' },
        steps: { type: 'array', items: { type: 'object' } },
        name: { type: 'string' },
        wait: { type: 'boolean', description: 'default true (blocks up to 10 min); false returns task_id immediately' },
      },
      required: ['profile_id', 'steps'],
    },
  },
  {
    name: 'rpa_run_plan',
    description: 'Run a saved RPA plan by id on its profiles. Set wait:false to start it and poll rpa_tasks for results',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        wait: { type: 'boolean', description: 'default true (blocks up to 10 min); false returns immediately' },
      },
      required: ['plan_id'],
    },
  },
  {
    name: 'rpa_status',
    description: 'Get RPA engine status',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'rpa_stop',
    description: 'Stop RPA task(s)',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' } },
    },
  },
  {
    name: 'rpa_task_result',
    description: 'Get one RPA task by id, including process_result (variables / exports / remarks) and the persisted log tail',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
  },
  {
    name: 'rpa_tasks',
    description: 'List RPA tasks newest first (optionally filtered by status)',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'running | success | failed | cancelled' },
        limit: { type: 'number', description: 'max tasks to return (default 50)' },
      },
    },
  },
  {
    name: 'rpa_task_delete',
    description: 'Delete one RPA task (and its run record) by id',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
  },
  {
    name: 'rpa_plans',
    description: 'List saved RPA plans (name, steps, profiles)',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'rpa_plan_save',
    description: 'Create or update an RPA plan (upsert by id). Fields: plan_name, profile_ids, steps, process_content, variables',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'omit to create a new plan' },
        plan_name: { type: 'string' },
        profile_ids: { type: 'array', items: { type: 'string' } },
        steps: { type: 'array', items: { type: 'object' } },
      },
    },
  },
  {
    name: 'rpa_plan_delete',
    description: 'Delete a saved RPA plan by id',
    inputSchema: {
      type: 'object',
      properties: { plan_id: { type: 'string' } },
      required: ['plan_id'],
    },
  },
  {
    name: 'rpa_templates',
    description: 'List RPA templates (builtin + custom) with categories',
    inputSchema: {
      type: 'object',
      properties: { q: { type: 'string' } },
    },
  },
  {
    name: 'rpa_template_install',
    description: 'Install an RPA template as an editable plan',
    inputSchema: {
      type: 'object',
      properties: { template_id: { type: 'string' } },
      required: ['template_id'],
    },
  },
  {
    name: 'list_applications',
    description: 'List application center apps (team / recommended / local)',
    inputSchema: {
      type: 'object',
      properties: {
        tab: { type: 'string', description: 'team | recommended | local | all' },
        q: { type: 'string' },
      },
    },
  },
  {
    name: 'extension_list',
    description: 'List installed extensions with assignment counts',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'extension_assign',
    description: 'Assign (or unassign) an extension to profiles',
    inputSchema: {
      type: 'object',
      properties: {
        extension_id: { type: 'string' },
        profile_ids: { type: 'array', items: { type: 'string' } },
        enabled: { type: 'boolean', description: 'default true' },
      },
      required: ['extension_id', 'profile_ids'],
    },
  },
  {
    name: 'get_fingerprint',
    description: 'Get deterministic fingerprint config for a profile id',
    inputSchema: {
      type: 'object',
      properties: { profile_id: { type: 'string' } },
      required: ['profile_id'],
    },
  },
  {
    name: 'isolation_audit',
    description: 'Audit multi-open isolation (user-data-dir / CDP port collisions)',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'proxy_list',
    description: 'List proxy library entries',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'proxy_create',
    description: 'Create a proxy entry (or many via list). Fields: name, proxy ("socks5://user:pass@host:port") or host/port/user/password/type, remark',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        proxy: { type: 'string' },
        remark: { type: 'string' },
      },
    },
  },
  {
    name: 'proxy_update',
    description: 'Update a proxy entry by id',
    inputSchema: {
      type: 'object',
      properties: {
        proxy_id: { type: 'string' },
        name: { type: 'string' },
        proxy: { type: 'string' },
        remark: { type: 'string' },
      },
      required: ['proxy_id'],
    },
  },
  {
    name: 'proxy_delete',
    description: 'Delete proxy entries by id (one or many)',
    inputSchema: {
      type: 'object',
      properties: {
        proxy_id: { type: 'string' },
        proxy_ids: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'proxy_check',
    description: 'Check a proxy (by library id or raw proxy string): exit IP, country, latency',
    inputSchema: {
      type: 'object',
      properties: {
        proxy_id: { type: 'string' },
        proxy: { type: 'string', description: 'raw proxy URL, used when proxy_id is absent' },
      },
    },
  },
  {
    name: 'get_version',
    description: 'Get app version and Local API server info',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

async function callTool(name, args = {}) {
  switch (name) {
    case 'list_profiles':
      return request('GET', '/api/v1/user/list');
    case 'start_profile':
      return request('POST', '/api/v1/browser/start', { user_id: args.profile_id });
    case 'stop_profile':
      return request('POST', '/api/v1/browser/stop', { user_id: args.profile_id });
    case 'list_active_browsers':
      return request('GET', '/api/v1/browser/active');
    case 'stop_all_profiles':
      return request('POST', '/api/browser/stop-all', {});
    case 'profile_create':
      return request('POST', '/api/v1/user/create', args);
    case 'profile_delete': {
      const ids = (Array.isArray(args.profile_ids) ? args.profile_ids : [args.profile_id]).map((id) => String(id || '').trim()).filter(Boolean);
      return request('POST', '/api/v1/user/delete', { user_ids: ids, delete_data: args.delete_data });
    }
    case 'window_sync_restart':
      return request('POST', '/api/sync/restart', {});
    case 'window_sync_arrange':
      return request('POST', '/api/sync/arrange', { profile_ids: args.profile_ids, mode: args.mode || 'tile' });
    case 'window_sync_settings':
      return args.settings && typeof args.settings === 'object'
        ? request('POST', '/api/sync/settings', args.settings)
        : request('GET', '/api/sync/settings');
    case 'window_sync_start':
      return request('POST', '/api/sync/start', {
        profile_ids: args.profile_ids,
        operate: args.operate,
      });
    case 'window_sync_stop':
      return request('POST', '/api/sync/stop', {});
    case 'window_sync_status':
      return request('GET', '/api/sync/status');
    case 'rpa_run_steps':
      return request('POST', '/api/rpa/run', {
        profile_id: args.profile_id,
        steps: args.steps,
        name: args.name || 'mcp-rpa',
        wait: args.wait !== false,
      }, { timeout: args.wait === false ? 30000 : 600000 });
    case 'rpa_run_plan':
      return request('POST', '/api/rpa/run', {
        plan_id: args.plan_id,
        wait: args.wait !== false,
      }, { timeout: args.wait === false ? 30000 : 600000 });
    case 'rpa_status':
      return request('GET', '/api/rpa/status');
    case 'rpa_stop':
      return request('POST', '/api/rpa/stop', { task_id: args.task_id });
    case 'rpa_task_result':
      return request('GET', '/api/rpa/tasks/' + encodeURIComponent(String(args.task_id || '')));
    case 'rpa_tasks': {
      const params = new URLSearchParams();
      if (args.status) params.set('status', String(args.status));
      if (args.limit) params.set('limit', String(args.limit));
      const qs = params.toString();
      return request('GET', '/api/rpa/tasks' + (qs ? '?' + qs : ''));
    }
    case 'rpa_task_delete':
      return request('DELETE', '/api/rpa/tasks/' + encodeURIComponent(String(args.task_id || '')));
    case 'rpa_plans':
      return request('GET', '/api/rpa/plans');
    case 'rpa_plan_save':
      return request('POST', '/api/rpa/plans', args);
    case 'rpa_plan_delete':
      return request('DELETE', '/api/rpa/plans/' + encodeURIComponent(String(args.plan_id || '')));
    case 'rpa_templates': {
      const params = new URLSearchParams();
      if (args.q) params.set('q', String(args.q));
      const qs = params.toString();
      return request('GET', '/api/rpa/templates' + (qs ? '?' + qs : ''));
    }
    case 'rpa_template_install':
      return request('POST', '/api/rpa/templates/' + encodeURIComponent(String(args.template_id || '')) + '/install', {});
    case 'list_applications': {
      const params = new URLSearchParams();
      if (args.tab) params.set('tab', args.tab);
      if (args.q) params.set('q', args.q);
      const qs = params.toString();
      return request('GET', '/api/v1/application/list' + (qs ? '?' + qs : ''));
    }
    case 'get_fingerprint':
      return request('GET', '/api/fingerprint?profile_id=' + encodeURIComponent(args.profile_id || ''));
    case 'isolation_audit':
      return request('GET', '/api/isolation/audit');
    case 'proxy_list':
      return request('GET', '/api/proxy/list');
    case 'proxy_create':
      return request('POST', '/api/proxy/create', args);
    case 'proxy_update':
      return request('POST', '/api/proxy/update', args);
    case 'proxy_delete': {
      const ids = (Array.isArray(args.proxy_ids) ? args.proxy_ids : [args.proxy_id]).map((id) => String(id || '').trim()).filter(Boolean);
      return request('POST', '/api/proxy/delete', { ids });
    }
    case 'proxy_check':
      return request('POST', '/api/proxy/check', args);
    case 'extension_list':
      return request('GET', '/api/extension/list');
    case 'extension_assign':
      return request('POST', '/api/extension/assign', {
        extension_id: args.extension_id,
        profile_ids: args.profile_ids,
        enabled: args.enabled,
      });
    case 'get_version':
      return request('GET', '/api/getVersion');
    default:
      throw new Error('Unknown tool: ' + name);
  }
}

function writeMessage(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

async function handleRpc(message) {
  const id = message.id;
  const method = message.method;
  const params = message.params || {};

  try {
    if (method === 'initialize') {
      return writeMessage({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'openbrowser-local-api-mcp', version: '1.0.0' },
        },
      });
    }
    if (method === 'notifications/initialized' || method === 'initialized') {
      return;
    }
    if (method === 'tools/list') {
      return writeMessage({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    }
    if (method === 'tools/call') {
      const name = params.name;
      const args = params.arguments || {};
      const data = await callTool(name, args);
      return writeMessage({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
          isError: data && data.code !== 0 && data.code !== undefined,
        },
      });
    }
    if (method === 'ping') {
      return writeMessage({ jsonrpc: '2.0', id, result: {} });
    }
    return writeMessage({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: 'Method not found: ' + method },
    });
  } catch (error) {
    if (id === undefined) return;
    return writeMessage({
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: error.message || String(error) },
    });
  }
}

function main() {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (_) {
        continue;
      }
      handleRpc(message);
    }
  });
  process.stdin.on('end', () => process.exit(0));
}

if (require.main === module) main();

module.exports = { TOOLS, callTool, request };
