# Google OAuth Auto-Refresh

**Intent:** Gmail and Google Calendar MCP servers run inside the container and read their OAuth credentials from `~/.gmail-mcp/credentials.json` and `~/.calendar-mcp/credentials.json`. These tokens expire after 1 hour. If the agent runs for >50 minutes, mid-session refresh inside the container can fail (network, file-locking). Solution: refresh tokens on the host *before each container spawn* if they're within a 10-minute expiry window.

## File location

**v1 path:** `src/container-runner.ts` had a `refreshGoogleTokens()` function called before each `spawn()`.

**v2 path:** Find the equivalent — v2 has refactored container spawn. Likely `src/container-runner.ts` still exists, possibly renamed. Hook into the pre-spawn step.

## Implementation

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const REFRESH_WINDOW_MS = 10 * 60 * 1000; // refresh if token expires within 10 min

interface GoogleCredentials {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  token_type: string;
  scope: string;
}

async function refreshOne(credPath: string, clientId: string, clientSecret: string): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(credPath, 'utf8');
  } catch {
    return; // file missing — not configured, skip silently
  }
  const creds = JSON.parse(raw) as GoogleCredentials;
  const now = Date.now();
  if (creds.expiry_date && creds.expiry_date - now > REFRESH_WINDOW_MS) {
    return; // still fresh
  }
  if (!creds.refresh_token) {
    logger.warn({ credPath }, 'no refresh_token in google creds, cannot auto-refresh');
    return;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: creds.refresh_token,
    grant_type: 'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    logger.error({ credPath, status: res.status, errText }, 'google token refresh failed');
    return;
  }

  const data = await res.json() as { access_token: string; expires_in: number; token_type: string };
  creds.access_token = data.access_token;
  creds.expiry_date = Date.now() + data.expires_in * 1000;
  await fs.writeFile(credPath, JSON.stringify(creds, null, 2));
  logger.info({ credPath }, 'refreshed google oauth token');
}

export async function refreshGoogleTokens(): Promise<void> {
  const home = os.homedir();
  const gmailKeysPath = path.join(home, '.gmail-mcp', 'gcp-oauth.keys.json');
  let clientId: string | undefined;
  let clientSecret: string | undefined;
  try {
    const keys = JSON.parse(await fs.readFile(gmailKeysPath, 'utf8'));
    const inner = keys.installed || keys.web;
    clientId = inner?.client_id;
    clientSecret = inner?.client_secret;
  } catch {
    return; // no gmail OAuth configured at all
  }
  if (!clientId || !clientSecret) return;

  await Promise.all([
    refreshOne(path.join(home, '.gmail-mcp', 'credentials.json'), clientId, clientSecret),
    refreshOne(path.join(home, '.calendar-mcp', 'credentials.json'), clientId, clientSecret),
  ]);
}
```

## Call site

In the container spawn path, immediately before `child_process.spawn(...)`:

```typescript
await refreshGoogleTokens();
// then spawn container
```

Failure must not block container spawn — `refreshGoogleTokens()` swallows its own errors (logs + returns). The fallback is the container's existing in-process refresh.

## Container mounts (depends on this)

For the refreshed tokens to reach the MCP servers inside the container, mount the host dirs read-write:

```typescript
const mounts = [
  // ... existing mounts
  {
    type: 'bind',
    source: path.join(os.homedir(), '.gmail-mcp'),
    target: '/home/node/.gmail-mcp',
    readonly: false,
  },
  {
    type: 'bind',
    source: path.join(os.homedir(), '.calendar-mcp'),
    target: '/home/node/.calendar-mcp',
    readonly: false,
  },
];
```

The container runs as `node` user (uid varies — match v2's user). `readonly: false` because the MCP server inside may still update its own state (e.g. last-sync timestamps).
