/**
 * Seed the owner user_role for the WhatsApp ID derived from store/auth/creds.json.
 * Idempotent: if a row already exists, leaves it alone.
 *
 * Usage: pnpm exec tsx /home/nanoclaw/nanoclaw-v2/scripts/seed-owner.ts [user_id]
 *
 * If user_id is omitted, read it from store/auth/creds.json (the bot's own
 * phone JID); but for v1→v2 migrations the owner is normally the *bot
 * operator's* phone, not the bot's. Pass the operator's id explicitly.
 */
import { initDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrations/index.js';
import { DATA_DIR } from '../src/config.js';
import path from 'node:path';

async function main(): Promise<void> {
  const userId = process.argv[2];
  if (!userId) {
    console.error('Usage: seed-owner.ts <user_id>');
    console.error('Example: seed-owner.ts whatsapp:972508802594@s.whatsapp.net');
    process.exit(1);
  }

  const db = initDb(path.join(DATA_DIR, 'v2.db'));
  runMigrations(db);

  const user = db
    .prepare('SELECT id, kind, display_name FROM users WHERE id = ?')
    .get(userId) as { id: string; kind: string; display_name: string } | undefined;

  if (!user) {
    console.log(`USER NOT FOUND in users table: ${userId}`);
    console.log('Recent users (run again with correct ID):');
    const recent = db
      .prepare('SELECT id, kind, display_name FROM users ORDER BY rowid DESC LIMIT 10')
      .all();
    for (const u of recent) console.log(' ', u);
    process.exit(1);
  }

  console.log(`USER FOUND: ${user.id} (${user.kind}) display=${user.display_name}`);

  const existing = db
    .prepare("SELECT role, agent_group_id FROM user_roles WHERE user_id = ? AND role = 'owner'")
    .all(userId);

  if (existing.length > 0) {
    console.log(`OWNER ROLE ALREADY EXISTS for ${userId}:`, existing);
    return;
  }

  db.prepare(
    "INSERT INTO user_roles (user_id, role, agent_group_id, granted_by, granted_at) VALUES (?, 'owner', NULL, NULL, datetime('now'))",
  ).run(userId);

  const after = db
    .prepare('SELECT user_id, role, agent_group_id, granted_at FROM user_roles WHERE user_id = ?')
    .all(userId);
  console.log('OK: seeded owner role. Current rows for this user:');
  for (const r of after) console.log(' ', r);
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
