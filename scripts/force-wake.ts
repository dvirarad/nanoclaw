/**
 * Direct insert of a wake message into a session's inbound.db so the
 * host sweep spawns a fresh container.
 *
 * Usage: pnpm exec tsx scripts/force-wake.ts <session-id> <inbound-db-path> <message>
 *
 * Mirrors the row format that worked for Andy Money's natural restart:
 *   kind=chat, trigger=1, status=pending, content={text,sender,senderId}
 *
 * Use even seq number (host writes even, container writes odd per v2 design).
 */
import Database from 'better-sqlite3';

const [, , dbPath, message] = process.argv;
if (!dbPath || !message) {
  console.error('Usage: force-wake.ts <inbound-db-path> "<wake message>"');
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const maxSeqRow = db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM messages_in').get() as { m: number };
let seq = maxSeqRow.m + 1;
if (seq % 2 !== 0) seq += 1; // host uses even seq

const id = `restart-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const now = new Date().toISOString();
const content = JSON.stringify({ text: message, sender: 'system', senderId: 'system' });

db.prepare(
  "INSERT INTO messages_in (id, seq, kind, timestamp, status, trigger, content) VALUES (?, ?, 'chat', ?, 'pending', 1, ?)",
).run(id, seq, now, content);

console.log(`OK: ${dbPath} ← ${id} seq=${seq}`);
db.close();
