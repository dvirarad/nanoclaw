/**
 * Add gdrive MCP server + mount to self-chat (ag-1778566239609-eh1xto).
 * Preserves existing gmail + calendar entries.
 */
import fs from 'node:fs';
import path from 'node:path';
import { initDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrations/index.js';
import { DATA_DIR } from '../src/config.js';
import {
  getContainerConfig,
  updateContainerConfigJson,
} from '../src/db/container-configs.js';

const AGENT_GROUP_ID = 'ag-1778566239609-eh1xto';
const KEYS = '/home/nanoclaw/.gmail-mcp/gcp-oauth.keys.json';

const keys = JSON.parse(fs.readFileSync(KEYS, 'utf8'));
const inner = keys.installed || keys.web || {};
const clientId: string = inner.client_id;
const clientSecret: string = inner.client_secret;
if (!clientId || !clientSecret) {
  console.error('ERROR: client_id/secret missing from', KEYS);
  process.exit(1);
}

const db = initDb(path.join(DATA_DIR, 'v2.db'));
runMigrations(db);

const cfg = getContainerConfig(AGENT_GROUP_ID) as
  | { mcp_servers: string | null; additional_mounts: string | null }
  | undefined;
if (!cfg) {
  console.error('ERROR: no container_configs row for', AGENT_GROUP_ID);
  process.exit(1);
}

// JSON columns come back as raw strings from getContainerConfig — parse them.
const existingMcp = cfg.mcp_servers ? JSON.parse(cfg.mcp_servers) : {};
const existingMounts = cfg.additional_mounts ? JSON.parse(cfg.additional_mounts) : [];

console.log('Existing MCP servers:', Object.keys(existingMcp));
console.log('Existing mounts:', existingMounts.length);

if (existingMcp.gdrive) {
  console.log('gdrive MCP server already present, will overwrite');
}

const newMcp = {
  ...existingMcp,
  gdrive: {
    command: 'npx',
    args: ['-y', 'mcp-gdrive-workspace'],
    env: {
      HOME: '/workspace/extra',
      MCP_GDRIVE_ACCESS_MODE: 'read_write',
      GOOGLE_CLIENT_ID: clientId,
      GOOGLE_CLIENT_SECRET: clientSecret,
    },
  },
};

const gdriveMountExists = existingMounts.some(
  (m: { containerPath: string }) => m.containerPath === '.mcp-gdrive',
);
const newMounts = gdriveMountExists
  ? existingMounts
  : [
      ...existingMounts,
      {
        hostPath: '/home/nanoclaw/.mcp-gdrive',
        containerPath: '.mcp-gdrive',
        readonly: false,
      },
    ];

updateContainerConfigJson(AGENT_GROUP_ID, 'mcp_servers', newMcp);
updateContainerConfigJson(AGENT_GROUP_ID, 'additional_mounts', newMounts);

console.log('Updated. MCP servers now:', Object.keys(newMcp));
console.log('Mounts now:', newMounts.length, 'entries (containerPaths:', newMounts.map((m: { containerPath: string }) => m.containerPath).join(', ') + ')');
