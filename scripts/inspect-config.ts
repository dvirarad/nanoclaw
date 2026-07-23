import path from 'node:path';
import { initDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrations/index.js';
import { DATA_DIR } from '../src/config.js';

const db = initDb(path.join(DATA_DIR, 'v2.db'));
runMigrations(db);

const row = db
  .prepare(
    'SELECT mcp_servers, additional_mounts FROM container_configs WHERE agent_group_id = ?',
  )
  .get('ag-1778566239609-eh1xto') as
  | { mcp_servers: string; additional_mounts: string }
  | undefined;

if (!row) {
  console.error('no row');
  process.exit(1);
}

console.log('mcp_servers length:', row.mcp_servers.length);
console.log('mcp_servers head (300 chars):', row.mcp_servers.slice(0, 300));
console.log('mcp_servers tail (300 chars):', row.mcp_servers.slice(-300));
console.log();
console.log('additional_mounts:', row.additional_mounts);

try {
  const parsed = JSON.parse(row.mcp_servers);
  console.log();
  console.log('parsed type:', typeof parsed);
  console.log('parsed keys:', Object.keys(parsed));
  console.log('values type:', Object.values(parsed)[0] && typeof Object.values(parsed)[0]);
} catch (err) {
  console.log('parse failed:', err);
}
