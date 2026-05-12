# MCP Remote Support

**Intent:** Connect the agent to a third-party MCP server (e.g. Lumana) hosted at an external URL with bearer-token auth. The remote MCP runs on the host network, not in the container, so we rewrite `localhost` → `host.docker.internal` and exclude it from the OneCLI proxy via `NO_PROXY`.

## .env additions

Add to `.env.example` (and document for the user to set in real `.env`):

```bash
# Optional: external MCP server (e.g. Lumana)
MCP_REMOTE_URL=
MCP_REMOTE_AUTH=
```

## Host side — read from .env and rewrite localhost

**File:** `src/container-runner.ts` (or wherever the v2 equivalent of container spawn config lives).

When constructing the agent's MCP config, read these vars **from the `.env` file directly**, not `process.env` — under launchd `process.env` doesn't have `.env` loaded by default. Use the existing `.env` parser if v2 has one, otherwise:

```typescript
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
const envFile = loadEnv({ path: path.join(process.cwd(), '.env') }).parsed || {};
const mcpUrl = envFile.MCP_REMOTE_URL;
const mcpAuth = envFile.MCP_REMOTE_AUTH;
```

If `mcpUrl` contains `localhost` or `127.0.0.1`, rewrite it for container access:

```typescript
const containerMcpUrl = mcpUrl?.replace(/localhost|127\.0\.0\.1/, 'host.docker.internal');
```

Pass to the container as `MCP_REMOTE_URL` (containerized form) and `MCP_REMOTE_AUTH` (verbatim) via `--env`.

## NO_PROXY exclusion

OneCLI proxies all outbound HTTPS for credential injection. The MCP remote host should bypass it. Add to the container's `NO_PROXY` env var:

```typescript
const mcpHost = mcpUrl ? new URL(mcpUrl).hostname : undefined;
const noProxy = ['localhost', '127.0.0.1', 'host.docker.internal', mcpHost]
  .filter(Boolean)
  .join(',');
// pass NO_PROXY=$noProxy to container
```

## Container side — MCP config in agent runner

**File:** `container/agent-runner/src/index.ts` (or v2 equivalent — file where the Claude Agent SDK's `mcpServers` is configured).

The SDK config should conditionally include the `remote` MCP server when `MCP_REMOTE_URL` is set:

```typescript
const mcpServers: Record<string, McpServerConfig> = {
  nanoclaw: {
    command: 'node',
    args: ['/app/node_modules/.bin/nanoclaw-mcp'], // or wherever v2 puts it
  },
};

if (process.env.MCP_REMOTE_URL) {
  const args = ['/app/node_modules/.bin/mcp-remote', process.env.MCP_REMOTE_URL];
  if (process.env.MCP_REMOTE_AUTH) {
    args.push('--header', `Authorization: Bearer ${process.env.MCP_REMOTE_AUTH}`);
  }
  mcpServers.remote = { command: 'node', args };
}
```

## allowedTools expansion

Add `mcp__remote__*` to the SDK's `allowedTools`:

```typescript
allowedTools: [
  // ... existing tools
  'mcp__remote__*',
],
```

## NPM dep (container side)

Add to `container/agent-runner/package.json`:

```json
"dependencies": {
  "mcp-remote": "^0.1.0"
}
```

Rebuild the container image after the dep change.

## Validation

After applying, in the container, check that `mcp-remote` is reachable:

```bash
docker exec <container> ls /app/node_modules/.bin/mcp-remote
```

Then send a test message from WhatsApp that triggers an `mcp__remote__*` tool call. The agent should not fail with "unknown tool".
