# Baileys Patches (WhatsApp channel)

Apply these **after** running `/add-whatsapp` and `/add-voice-transcription` on the v2 base. All six patches are real-world workarounds for Baileys 6.x quirks and WhatsApp protocol changes. None are "nice to have" — every one was hit in production.

Per upstream v2 CHANGELOG: "WhatsApp users must re-merge the WhatsApp fork to pick up the Baileys logger compatibility fix." First do that:

```bash
git fetch whatsapp main
git merge whatsapp/main --no-edit
```

If the merge already includes the patches below, you may skip the redundant ones — but verify each.

---

## Patch 1: Baileys getPlatformId pairing fix

**Intent:** Baileys 6.x has a bug where `getPlatformId(browser)` returns `'49'` (charCode of `'1'`) instead of the enum value `'1'` for the `'Chrome'` browser. Result: device pairing returns "couldn't link device" silently. Patch overrides `getPlatformId` to return the actual `proto.DeviceProps.PlatformType` enum value.

**File:** `src/whatsapp-auth.ts` (the pairing-code flow path)

**Why this lives in `whatsapp-auth.ts`, not `whatsapp.ts`:** The bug fires during pairing, not during runtime message flow. `whatsapp-auth.ts` is loaded by `setup/whatsapp-auth.ts` before any sockets open, so the patch is applied early.

**Why CJS `createRequire`, not ESM `import`:** ESM `import * as` creates a read-only namespace — you can't reassign `_generics.getPlatformId`. CJS `require()` returns a mutable object reference.

**How to apply:**

At the top of `src/whatsapp-auth.ts`, before any Baileys usage:

```typescript
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);
const _generics = _require('@whiskeysockets/baileys/lib/Utils/generics') as Record<string, unknown>;
const { proto } = _require('@whiskeysockets/baileys') as { proto: any };

_generics.getPlatformId = (browser: string): string => {
  const platformType = proto.DeviceProps.PlatformType[
    browser.toUpperCase() as keyof typeof proto.DeviceProps.PlatformType
  ];
  return platformType ? platformType.toString() : '1';
};
```

If on v2 the WhatsApp skill no longer uses `whatsapp-auth.ts` (because setup moved into the skill), apply this patch in whichever file calls `makeWASocket()` for the pairing-code path, before that call.

---

## Patch 2: getMessage retry cache

**Intent:** When the bot self-chats (sends a message to its own JID and reads it later), Baileys can ask for the original encrypted form on retry. If we don't provide it, the recipient sees "Waiting for this message" forever. Cache the last 256 sent messages and serve them via the `getMessage` socket option.

**File:** `src/channels/whatsapp.ts` (whichever class holds the socket; in v1 it was the `WhatsAppChannel` class)

**How to apply:**

Add a member to the channel class:

```typescript
import type { proto, WAMessageKey } from '@whiskeysockets/baileys';

class WhatsAppChannel {
  private sentMessageCache = new Map<string, proto.IMessage>();
  // ... existing members
}
```

In the `makeWASocket({...})` options object:

```typescript
getMessage: async (key: WAMessageKey) => {
  const cached = this.sentMessageCache.get(key.id || '');
  if (cached) {
    logger.debug({ id: key.id }, 'getMessage: returning cached message for retry');
    return cached;
  }
  return undefined;
},
```

After every successful `sock.sendMessage()`:

```typescript
const sent = await this.sock.sendMessage(jid, { text: prefixed });
if (sent?.key?.id && sent.message) {
  this.sentMessageCache.set(sent.key.id, sent.message);
  if (this.sentMessageCache.size > 256) {
    const oldest = this.sentMessageCache.keys().next().value!;
    this.sentMessageCache.delete(oldest);
  }
}
```

The 256-entry cap is a memory budget; tune if needed.

---

## Patch 3: LID → phone JID with senderPn fallback

**Intent:** WhatsApp's newer "LID" (linked ID) protocol uses opaque `@lid` JIDs. Baileys' built-in signalRepository LID-to-phone lookup sometimes returns nothing for first-message-from-new-contact, but the same message carries the phone number in `msg.key.senderPn`. Use it as a fallback so messages route correctly on first contact.

**File:** `src/channels/whatsapp.ts`, inside the inbound message handler (`messages.upsert` event).

**How to apply:**

After resolving the raw JID, before consuming it:

```typescript
let chatJid = await this.translateJid(rawJid);
if (chatJid.endsWith('@lid') && (msg.key as any).senderPn) {
  const pn = (msg.key as any).senderPn as string;
  const phoneJid = pn.includes('@') ? pn : `${pn}@s.whatsapp.net`;
  this.lidToPhoneMap[rawJid.split('@')[0].split(':')[0]] = phoneJid;
  chatJid = phoneJid;
  logger.info({ lidJid: rawJid, phoneJid }, 'Translated LID via senderPn');
}
```

`this.lidToPhoneMap` is a `Record<string, string>` on the channel — declare it if not already present:

```typescript
private lidToPhoneMap: Record<string, string> = {};
```

---

## Patch 4: Normalize bot's LID mention to @AssistantName

**Intent:** In group messages, when someone tags the bot, WhatsApp inserts the bot's LID (`@80355281346633` or similar) rather than its phone number. Trigger pattern matching looks for `@AssistantName` (e.g. `@Andy`), so LID mentions miss the trigger. Replace the bot's known LID with the assistant name string before trigger matching.

**Files:** `src/channels/whatsapp.ts`

**How to apply:**

On `connection.update`, when the connection completes and we know both the LID and phone forms of the bot's own JID:

```typescript
private botLidUser?: string;

this.sock.ev.on('connection.update', (update) => {
  // ... existing handling
  if (update.connection === 'open' && this.sock.user) {
    const lidUser = this.sock.user.lid?.split('@')[0]?.split(':')[0];
    const phoneUser = this.sock.user.id?.split('@')[0]?.split(':')[0];
    if (lidUser && phoneUser) {
      this.lidToPhoneMap[lidUser] = `${phoneUser}@s.whatsapp.net`;
      this.botLidUser = lidUser;
    }
  }
});
```

In the message text extraction code, before trigger matching:

```typescript
if (this.botLidUser && content.includes(`@${this.botLidUser}`)) {
  content = content.replace(`@${this.botLidUser}`, `@${ASSISTANT_NAME}`);
}
```

`ASSISTANT_NAME` is imported from config / env. Use whatever v2 exposes as the assistant name constant.

---

## Patch 5: Strip orphan Unicode surrogates

**Intent:** WhatsApp messages occasionally contain unpaired UTF-16 surrogate code points (mojibake from copy/paste). These break `JSON.stringify` downstream when IPC-ing to the container. Strip them at the channel boundary.

**File:** `src/channels/whatsapp.ts`, in message content extraction, immediately before forwarding the content to the router/IPC.

**How to apply:**

```typescript
content = content.replace(
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
  '',
);
```

The regex matches high surrogates not followed by a low surrogate, and low surrogates not preceded by a high surrogate. Valid emoji and CJK pairs are untouched.

---

## Patch 6: Logger ILogger TypeScript compat

**Intent:** Baileys' `makeWASocket()` types require an `ILogger`-shaped object (`level`, `child()`, `trace()`, etc.). NanoClaw's logger doesn't strictly match. Cast it as `any` at the call site.

**Note:** v2's CHANGELOG says the upstream WhatsApp branch *already provides* the ILogger compatibility fix. If you re-merge `whatsapp/main` as instructed in step 2 of the migration plan, this patch may already be in place — verify before adding manually.

**File:** `src/channels/whatsapp.ts`, in `makeWASocket({...})`:

**How to apply:**

```typescript
this.sock = makeWASocket({
  auth: state,
  logger: logger as any,  // NanoClaw logger satisfies ILogger at runtime
  getMessage: /* see Patch 2 */,
  // ... other options
});
```

If v2 has its own logger with `level`/`child`/`trace` already, the `as any` cast may be unnecessary. Try without first; add the cast only if TypeScript complains.
