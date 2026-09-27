# Session contribution protocol

Enable `@juanibiapina/pi-session-context` alongside any feature that persists data. The provider is the only writer of `<sessionFile>.context.json`, its managed plan attachments, and `~/.local/share/pi/status/<sessionId>.json`.

Import `createContributor` from `@juanibiapina/pi-session-context/client`. Construct a client during the feature factory, then await calls from Pi lifecycle handlers or tools:

```ts
import { createContributor } from "@juanibiapina/pi-session-context/client";

export default function (pi) {
  const notes = createContributor(pi, "example.notes", 1);
  pi.on("session_start", async (_event, ctx) => {
    await notes.putSession(ctx, { items: [] });
    await notes.putRuntime(ctx, { ready: true });
  });
}
```

Namespace names use lowercase letters, digits, dots, and hyphens. A process can register one owner per namespace. Duplicate owners fail. `putSession` replaces only that namespace; `updateSession(ctx, current => next)` makes a read and update atomic within one namespace. `putRuntime` publishes machine-local data, and `clearRuntime` removes it. Calls reject if the provider is unavailable, the runtime has not started, the session changed, a namespace has another owner, or an update is invalid. Session writes require a session file. Contributions are plain JSON values, at most 32 levels deep; complete records are limited to 1 MiB.

The client discovers the version 1 broker through Pi's event bus and awaits broker methods. The event itself does not acknowledge a write. Provider startup and client startup can occur in either order. Clients wait up to 500 ms for discovery.

The durable format is `{version:2,sessionId,extensions:{namespace:{version:1,data}}}`. Runtime adds `pid`, `cwd`, optional `name`, `sessionFile`, `contextPath`, `state`, `startedAt`, and `updatedAt`. The provider migrates version 1 durable sidecars on first access, preserving plan Markdown and a `.v1.bak` copy. Existing version 1 runtime files disappear on normal process exit.

Plan attachments use `createAttachment(ctx, content, update)` and `deleteAttachment(ctx, id, update)`. The provider serializes the file operation with the namespace index update and restores the file if the index write fails. The returned attachment path is editable Markdown. `get_session_context` lists managed attachments by ID and absolute path alongside all namespace data. IDs are 24 lowercase hex characters.
