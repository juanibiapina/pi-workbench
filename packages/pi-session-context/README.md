# @juanibiapina/pi-session-context

Stores durable session data and live status for Pi extensions.

## Install

```sh
pi install npm:@juanibiapina/pi-session-context
```

Install this provider alongside any standalone workbench component that saves session data. The [full workbench](../pi-workbench) already includes it. Load only one provider per Pi installation.

## Use

`get_session_context()` shows the current session's extension data and editable attachment paths. Session data is stored in `<sessionFile>.context.json`. Live status is published in `~/.local/share/pi/status/<sessionId>.json` while Pi runs.

Extension authors can import `createContributor` from `@juanibiapina/pi-session-context/client` to save namespaced session data, publish runtime status, and manage Markdown attachments. See the [contribution protocol](../../docs/protocol.md) for the API and data format.
