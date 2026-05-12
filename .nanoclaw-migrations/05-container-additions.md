# Container Additions

Changes that ride inside the container image.

## Dockerfile additions

**File:** `container/Dockerfile`

### poppler-utils (for PDF reader)

The pdf-reader container skill (`container/skills/pdf-reader/pdf-reader`) shells out to `pdftotext`. Install poppler-utils:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
  poppler-utils \
  && rm -rf /var/lib/apt/lists/*
```

Add to the `apt-get install` line of the existing system-deps step rather than introducing a new layer. Check if `/add-pdf-reader` already added this in v2; if so, skip.

### pdf-reader CLI placement

```dockerfile
COPY container/skills/pdf-reader/pdf-reader /usr/local/bin/pdf-reader
RUN chmod +x /usr/local/bin/pdf-reader
```

Again, `/add-pdf-reader` likely does this. Verify the v2 skill installs to `/usr/local/bin/` or wherever the agent picks it up.

## NPM dependency: mcp-remote

**File:** `container/agent-runner/package.json`

Inside `dependencies`:

```json
"mcp-remote": "^0.1.0"
```

After adding, run `npm install` inside `container/agent-runner/` to refresh `package-lock.json` (or `bun.lock` if v2 uses bun — per the upstream files we observed, v2 has `bun.lock` for the agent runner).

## SDK allowedTools

**File:** `container/agent-runner/src/index.ts` (or v2 equivalent — wherever the SDK is configured with `allowedTools`).

The full allowlist for this fork's feature set:

```typescript
allowedTools: [
  // existing baseline tools (whatever v2 ships)
  // ...

  // NanoClaw built-in MCP
  'mcp__nanoclaw__*',

  // Remote MCP (Lumana, etc.)
  'mcp__remote__*',

  // Gmail MCP server
  'mcp__gmail__read_email',
  'mcp__gmail__list_emails',
  'mcp__gmail__send_email',
  'mcp__gmail__list_labels',
  'mcp__gmail__create_draft',
  'mcp__gmail__list_drafts',
  'mcp__gmail__get_thread',
  'mcp__gmail__search_threads',
  'mcp__gmail__label_message',
  'mcp__gmail__label_thread',
  'mcp__gmail__unlabel_message',
  'mcp__gmail__unlabel_thread',
  'mcp__gmail__create_label',

  // Calendar MCP server
  'mcp__calendar__*',
],
```

Use the wildcard `mcp__remote__*` and `mcp__calendar__*` to avoid enumerating; Gmail listed explicitly above is the set the user has historically allowed — keep explicit if v2's MCP loader doesn't support wildcards reliably.

## MCP server registry

**File:** same as allowedTools.

Beyond `remote` (see `02-mcp-remote.md`), also register Gmail and Calendar MCP servers if not already added by `/add-gmail`:

```typescript
mcpServers: {
  // ...
  gmail: {
    command: 'npx',
    args: ['-y', '@gongrzhe/server-gmail-autoauth-mcp'],
    env: {
      // gmail MCP reads creds from /home/node/.gmail-mcp/credentials.json by default
    },
  },
  calendar: {
    command: 'npx',
    args: ['-y', '@gongrzhe/server-calendar-autoauth-mcp'],
    env: {},
  },
},
```

Verify package names — these are third-party MCP servers. As of v1 they were the `@gongrzhe/server-*-autoauth-mcp` packages. If maintainers changed the package, update accordingly.
