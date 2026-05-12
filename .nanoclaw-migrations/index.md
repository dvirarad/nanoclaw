# NanoClaw Migration Guide

Generated: 2026-05-10
Base: `934f063` (last common ancestor with upstream — was v1.2.52 area)
HEAD at generation: `8b8ce07` (local main, fork v1.2.14)
Upstream HEAD: `e185bb8` (upstream/main, tagged v2.0.54)
Backup tag at extract time: `pre-update-8b8ce07-20260510-224715`

## Why this guide exists

The fork drifted across an upstream major version bump (v1 → v2). A merge across that gap is unsafe — v2 deleted `src/db.ts` and `src/logger.ts`, restructured `src/db/`, replaced pino, moved channels to separate remotes, and introduced a two-DB session split (`inbound.db` + `outbound.db`) plus a new entity model (users / messaging groups / agent groups).

Instead of merging, this guide captures the fork's customizations as intent. A fresh Claude session checks out clean v2 in a worktree, then reapplies these customizations file-by-file using the v2 idioms.

## Migration Plan

Order matters because some customizations depend on others.

| Stage | Step | Why this order |
|---|---|---|
| 1 | Worktree on clean upstream v2 | Pristine base to layer on |
| 2 | Run `/init-onecli` if not already configured | v2 requires OneCLI vault for credentials |
| 3 | Reapply channel skills via `/add-whatsapp`, `/add-gmail`, `/add-image-vision`, `/add-pdf-reader`, `/add-voice-transcription` | Skills install channel + container code in v2 layout |
| 4 | Apply Baileys patches (`01-baileys-patches.md`) | These ride on top of whatsapp skill, after install |
| 5 | Apply MCP remote support (`02-mcp-remote.md`) | Independent — adds external MCP capability |
| 6 | Apply Google OAuth auto-refresh (`03-google-oauth-refresh.md`) | Requires gmail channel to be present |
| 7 | Apply multimodal image content blocks (`04-multimodal-images.md`) | Requires image-vision skill to be present |
| 8 | Container additions (`05-container-additions.md`) | Dockerfile poppler-utils, mcp-remote npm dep, MCP allowedTools |
| 9 | Misc core (`06-misc-core.md`) | Logger ILogger compat (v2 has new logger — check if still needed), removed CI workflows |
| 10 | Build + test in worktree | Validate before swapping |
| 11 | Swap worktree into main, restart service | |

## Applied Skills

These are reapplied at Stage 3 by running the upstream `/add-*` skills (v2's channel installation flow):

| Skill | Source on v2 | Notes |
|---|---|---|
| `add-whatsapp` | upstream skill (or `whatsapp` remote per CHANGELOG note) | After install, also re-merge `whatsapp/main` for the Baileys logger compatibility fix per upstream CHANGELOG |
| `add-voice-transcription` | upstream skill (or `whatsapp/skill/voice-transcription`) | Variant of WhatsApp |
| `add-gmail` | upstream skill (or `gmail` remote) | OAuth2 with `~/.gmail-mcp/` |
| `add-image-vision` | upstream skill (`.claude/skills/add-image-vision/`) | Sharp resize, multimodal |
| `add-pdf-reader` | upstream skill (`.claude/skills/add-pdf-reader/`) | poppler-utils + pdftotext |

**No purely user-created custom skills** — all skill dirs match upstream/remotes.

## Skill Interactions

- **whatsapp + voice-transcription**: voice-transcription extends the whatsapp channel. Apply voice-transcription *after* whatsapp.
- **whatsapp + image-vision**: both add attachment-handling to `src/channels/whatsapp.ts` (image processing call into `processImage()`). Apply whatsapp first, then image-vision, then verify the call site in `whatsapp.ts` matches `src/image.ts`'s exported function name.
- **whatsapp + pdf-reader**: pdf-reader is a *container* skill (`container/skills/pdf-reader/`). The whatsapp channel detects `documentMessage`, downloads via `downloadMediaMessage()`, and emits `[PDF: attachments/<file>]`. After applying both, verify the agent runner mounts attachments and the container has poppler-utils.
- **gmail + Google OAuth refresh (customization #2)**: refresh function reads from `~/.gmail-mcp/credentials.json` written by the gmail OAuth flow. Apply gmail first, then OAuth refresh.

## Customizations Index

| File | Topic |
|---|---|
| [01-baileys-patches.md](01-baileys-patches.md) | 6 patches: getPlatformId, retry cache, LID translation, mention normalization, surrogate stripping, ILogger compat |
| [02-mcp-remote.md](02-mcp-remote.md) | External MCP server support (e.g. Lumana) via mcp-remote |
| [03-google-oauth-refresh.md](03-google-oauth-refresh.md) | Auto-refresh Google OAuth tokens before container spawn |
| [04-multimodal-images.md](04-multimodal-images.md) | Pass WhatsApp images as Claude content blocks, not text |
| [05-container-additions.md](05-container-additions.md) | Dockerfile poppler-utils, mcp-remote npm dep, MCP allowedTools |
| [06-misc-core.md](06-misc-core.md) | DB helper, channel registry imports, setup flow, removed CI |

## Notable absences (preserve these)

- **No Telegram / Slack / Discord** — fork is WhatsApp + Gmail only.
- **Pinned to v1.2.14, no auto-bump** — after migration to v2, this becomes moot (v2 has its own versioning). Do NOT reintroduce `.github/workflows/bump-version.yml` or `update-tokens.yml`.
- **ESLint removed** — fork uses prettier only. v2 may have brought eslint back; if so, decide per-fork whether to keep or strip.

## v2 architectural shifts to be aware of

These affect HOW customizations are reapplied (not what):

1. **`src/db.ts` → `src/db/`** — DB layer is now per-table files. The user's `getMessageContentById()` helper goes into the relevant per-table file (likely `src/db/messages-in.ts` or similar).
2. **pino logger removed** — v2 uses a built-in logger. ILogger compat customization (#11) likely no longer needed; the upstream WhatsApp branch already provides this per CHANGELOG.
3. **Two-DB session split** — `inbound.db` (host writes) + `outbound.db` (container writes). Affects where the DB helper lives.
4. **OneCLI Vault is mandatory** — credential proxy was removed; `/init-onecli` is required.
5. **Channel isolation modes** — channels can be `session_mode: 'shared'` or `'agent-shared'`. The fork's "WhatsApp + Gmail in main group" pattern maps to `agent-shared` for both.
6. **Install flow** — `bash nanoclaw.sh` replaces `/setup`. The fork's custom `setup/whatsapp-auth.ts` step is now handled by the whatsapp skill itself.

## Files NOT to touch

`groups/`, `store/`, `data/`, `.env`, `~/.gmail-mcp/`, `~/.calendar-mcp/` — user data, preserved as-is across migration.

## Rollback

```bash
git reset --hard pre-update-8b8ce07-20260510-224715
```

Backup branch: `backup/pre-update-8b8ce07-20260510-224715`.
