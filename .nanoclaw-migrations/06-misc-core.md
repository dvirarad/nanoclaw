# Miscellaneous Core Changes

Small but necessary bits that don't belong in the topical files.

## DB helper: getMessageContentById

**Intent:** The voice-transcription error-recovery path needs to fetch the original message content by ID + chat JID to log/retry. v1 added a helper to `src/db.ts`.

**v2 location:** `src/db.ts` no longer exists. DB layer is now `src/db/` per-table files. The messages table likely lives in `src/db/messages-in.ts` or `src/db/messaging-groups.ts` — inspect v2 to find the right file. Add the helper there.

```typescript
export function getMessageContentById(
  id: string,
  chatJid: string,
): string | undefined {
  const row = db
    .prepare('SELECT content FROM messages_in WHERE id = ? AND chat_jid = ?')
    .get(id, chatJid) as { content: string } | undefined;
  return row?.content;
}
```

**Important:** v2 has a two-DB split (`inbound.db` host writes, `outbound.db` container writes). The function above reads from inbound. If the use case is "look up a message the user sent us", inbound is correct. If "look up a message we sent", switch to outbound. Confirm from context.

**Also:** v2 may have renamed the `messages` table to `messages_in` or similar. Check v2's migration files (`src/db/migrations/`) to find the actual table name.

## Channel registry imports

**Intent:** Channels self-register at startup by being imported. v1's `src/channels/index.ts` did:

```typescript
import './gmail.js';
import './whatsapp.js';
```

**v2:** Channels live in separate remotes/branches. After running `/add-whatsapp` and `/add-gmail`, those skills should add the imports themselves. **Verify** after applying skills that `src/channels/index.ts` (or wherever v2 puts the registry) contains both imports. If a skill doesn't add the import, add it manually.

## Setup flow: whatsapp-auth step

**Intent:** Before WhatsApp can connect, the user must scan a QR code or enter a pairing code. v1 had `setup/index.ts` register a `'whatsapp-auth'` step that ran `setup/whatsapp-auth.ts`.

**v2:** Install flow replaced — `bash nanoclaw.sh` is the new default; `/setup` is the fallback. The whatsapp skill in v2 should handle its own auth flow at install time. **Verify** after running `/add-whatsapp` that the user is walked through auth (QR/pairing). If not, port `setup/whatsapp-auth.ts` from `.nanoclaw-migrations/extracted/setup-whatsapp-auth.ts.bak` (we'll extract this in Phase 2 as a backup before swapping).

## .env additions

Add these env vars to `.env.example` (and document in CLAUDE.md):

```bash
ASSISTANT_HAS_OWN_NUMBER=
OPENAI_API_KEY=        # for voice transcription (Whisper)
MCP_REMOTE_URL=        # optional, see 02-mcp-remote.md
MCP_REMOTE_AUTH=       # optional, bearer token for above
```

The user's *actual* `.env` is not touched by migration (data dir). After migration, verify these vars are present and pointing at the right values.

## Removed CI workflows — do NOT reintroduce

These were deleted on the fork intentionally:

- `.github/workflows/bump-version.yml` — auto-version-bump runs on every push to main. The fork doesn't follow upstream's version cadence.
- `.github/workflows/update-tokens.yml` — token-count tracking; not relevant for a private fork.

If v2 ships these workflows again (likely yes — they're in upstream), delete them after migration:

```bash
rm -f .github/workflows/bump-version.yml .github/workflows/update-tokens.yml
```

## ESLint removal

v1 fork removed ESLint and ts-eslint. v2 may have brought eslint back via its CI changes. After migration, decide:

- **Keep eslint:** leave it in; fix any lint errors from your customizations.
- **Strip eslint:** remove `eslint`, `typescript-eslint`, `eslint-plugin-no-catch-all`, `globals` from `package.json` devDependencies. Remove `lint` and `lint:fix` npm scripts. Delete `.eslintrc*` config files.

Recommendation: keep eslint on v2 — it's part of the new dev flow and only adds friction if you fight it. The original fork stripped it for v1-era reasons that probably don't apply now.

## Version pinning

v1 fork is locked at `1.2.14` in `package.json`. v2's version is `2.0.54`. **Do not preserve the v1 version pin** — accept v2's version. If you don't want auto-bump, just don't merge upstream's version bump commits going forward; let the fork stay at whatever v2 was on at migration.
