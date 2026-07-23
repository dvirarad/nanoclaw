/**
 * Properly delete an agent group with cascade.
 *
 * Usage: pnpm exec tsx scripts/delete-group.ts <agent_group_id>
 *
 * Cleans up (in order):
 *  1. messaging_group_agents wiring rows where agent_group_id = X
 *  2. container_configs row for agent_group_id = X
 *  3. agent_groups row for id = X
 *
 * Does NOT touch:
 *  - messaging_groups (the WhatsApp group definition stays)
 *  - groups/<folder>/ on disk (CLAUDE.md, conversations preserved)
 *  - data/v2-sessions/<id>/ on disk (inbound/outbound DBs preserved)
 *
 * The user can rm those manually if confident, but we keep them by default
 * for reversibility.
 */
import { initDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrations/index.js';
import { DATA_DIR } from '../src/config.js';
import path from 'node:path';

const id = process.argv[2];
if (!id) {
  console.error('Usage: delete-group.ts <agent_group_id>');
  process.exit(1);
}

const db = initDb(path.join(DATA_DIR, 'v2.db'));
runMigrations(db);

const ag = db
  .prepare('SELECT id, name, folder FROM agent_groups WHERE id = ?')
  .get(id) as { id: string; name: string; folder: string } | undefined;

if (!ag) {
  console.error(`Agent group not found: ${id}`);
  process.exit(1);
}

console.log(`Deleting agent group: ${ag.name} (${ag.id}, folder=${ag.folder})`);

const wiringRows = db
  .prepare('SELECT id, messaging_group_id FROM messaging_group_agents WHERE agent_group_id = ?')
  .all(id);
console.log(`  Found ${wiringRows.length} wiring row(s) in messaging_group_agents`);
db.prepare('DELETE FROM messaging_group_agents WHERE agent_group_id = ?').run(id);
console.log('  → wiring deleted');

const cfgInfo = db.prepare('DELETE FROM container_configs WHERE agent_group_id = ?').run(id);
console.log(`  → container_configs: ${cfgInfo.changes} row(s) deleted`);

const agInfo = db.prepare('DELETE FROM agent_groups WHERE id = ?').run(id);
console.log(`  → agent_groups: ${agInfo.changes} row(s) deleted`);

console.log(`Done. Preserved on disk (for rollback): groups/${ag.folder}/, data/v2-sessions/${id}/`);
