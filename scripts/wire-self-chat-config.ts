/**
 * One-shot wrapper to wire self-chat (ag-1778566239609-eh1xto) with
 * gmail + calendar MCP servers + additional_mounts.
 *
 * Reads a single JSON from stdin with shape:
 *   { mcp_servers: {...}, additional_mounts: [...] }
 *
 * Avoids shell/SQL escaping: values stay as parsed JS objects until
 * updateContainerConfigJson serializes them.
 */
import { initDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrations/index.js';
import { DATA_DIR } from '../src/config.js';
import {
  getContainerConfig,
  updateContainerConfigJson,
} from '../src/db/container-configs.js';
import path from 'node:path';

const AGENT_GROUP_ID = 'ag-1778566239609-eh1xto';

async function readStdin(): Promise<string> {
  let s = '';
  for await (const chunk of process.stdin) s += chunk;
  return s;
}

async function main(): Promise<void> {
  const raw = await readStdin();
  const input = JSON.parse(raw) as {
    mcp_servers?: Record<string, unknown>;
    additional_mounts?: unknown[];
  };

  const db = initDb(path.join(DATA_DIR, 'v2.db'));
  runMigrations(db);

  const before = getContainerConfig(AGENT_GROUP_ID);
  if (!before) {
    console.error(`ERROR: no container_configs row for ${AGENT_GROUP_ID}`);
    process.exit(1);
  }

  if (input.mcp_servers) {
    updateContainerConfigJson(AGENT_GROUP_ID, 'mcp_servers', input.mcp_servers);
    console.log(`OK: mcp_servers set (${Object.keys(input.mcp_servers).join(', ')})`);
  }
  if (input.additional_mounts) {
    updateContainerConfigJson(AGENT_GROUP_ID, 'additional_mounts', input.additional_mounts);
    console.log(`OK: additional_mounts set (${input.additional_mounts.length} entries)`);
  }

  const after = getContainerConfig(AGENT_GROUP_ID);
  console.log('--- after ---');
  console.log('mcp_servers:', JSON.stringify(after?.mcp_servers, null, 2));
  console.log('additional_mounts:', JSON.stringify(after?.additional_mounts, null, 2));
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
