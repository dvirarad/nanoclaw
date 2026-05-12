# Multimodal Image Content Blocks

**Intent:** When WhatsApp sends an image, don't just pass `[Image: path]` text to Claude — pass the actual image as a `{type: 'image'}` content block so the model sees the image. This is what makes image vision actually *work* end-to-end.

This customization sits on top of the `/add-image-vision` skill. The skill installs the host-side image processing (`src/image.ts`: resize + store). This customization wires the resized image *through* to the agent SDK as a multimodal content block.

## Two parts

1. **Host side** — extract image references from missed messages, pass as `imageAttachments` to the container.
2. **Container side** — receive the image attachments and push them to the Claude SDK as multimodal content.

---

## Host side

**File:** `src/index.ts` (orchestrator) and the `ContainerInput` type (likely in `src/container-runner.ts`).

### Type addition

```typescript
interface ImageAttachment {
  relativePath: string;   // e.g. "attachments/img-1700000000-abc.jpg"
  caption?: string;
}

interface ContainerInput {
  // ... existing fields
  imageAttachments?: ImageAttachment[];
}
```

### Extraction helper

In `src/index.ts` (or a util):

```typescript
function parseImageReferences(messages: string[]): ImageAttachment[] {
  const result: ImageAttachment[] = [];
  const re = /\[Image:\s*([^\]]+)\](?:\s*(.+?))?(?=\n|$|\[)/g;
  for (const msg of messages) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(msg)) !== null) {
      result.push({ relativePath: m[1].trim(), caption: m[2]?.trim() || undefined });
    }
  }
  return result;
}
```

The exact `[Image: ...]` format is what `src/image.ts` (from `/add-image-vision`) emits. Verify the format matches in v2 — if the skill puts images in a different format, update the regex.

### Wiring

Before calling `runAgent({...})`:

```typescript
const imageAttachments = parseImageReferences(missedMessages);
await runAgent({
  // ... existing fields
  imageAttachments,
});
```

`runAgent` (or v2 equivalent) passes this through to the container input.

---

## Container side

**File:** `container/agent-runner/src/index.ts` (or v2 equivalent — wherever the SDK conversation loop is).

### Push helper

Add a method (or function) that constructs and pushes a multimodal message:

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';

async function pushMultimodal(text: string, imageAttachments: ImageAttachment[]) {
  const content: ContentBlock[] = [];

  for (const att of imageAttachments) {
    const fullPath = path.join('/workspace/group', att.relativePath);
    let data: Buffer;
    try {
      data = await fs.readFile(fullPath);
    } catch (err) {
      logger.warn({ path: fullPath, err: String(err) }, 'image not found, skipping');
      continue;
    }

    // Determine media type from extension
    const ext = path.extname(fullPath).toLowerCase();
    const mediaType =
      ext === '.png' ? 'image/png' :
      ext === '.gif' ? 'image/gif' :
      ext === '.webp' ? 'image/webp' :
      'image/jpeg';

    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: data.toString('base64'),
      },
    });

    if (att.caption) {
      content.push({ type: 'text', text: `[caption: ${att.caption}]` });
    }
  }

  content.push({ type: 'text', text });

  // Push to the SDK message stream (v1 used MessageStream.pushMultimodal — find v2 equivalent)
  await messageStream.push({ role: 'user', content });
}
```

Use `pushMultimodal()` instead of `pushText()` when `imageAttachments.length > 0`. Otherwise fall back to the existing text-only path.

### Mount

The container needs read access to the group's `attachments/` directory. The agent runs in `/workspace/group`, so `attachments/` is already inside the mount — no additional mount needed *unless* v2 changed the workspace layout.

---

## Validation

End-to-end test:
1. Send an image from WhatsApp with a caption ("what is this?").
2. Agent responds describing the image.
3. If response says "I can't see images" or similar, the multimodal block isn't reaching the SDK — check container logs for the `pushMultimodal` path.

## Notes for v2

v2's CHANGELOG mentions a per-group `model` and `effort` override (PR #2233). Image vision requires a vision-capable model (Sonnet 4.6 or Opus 4.7). If the per-group model is Haiku, vision will silently degrade. Surface this if the user reports image issues.
