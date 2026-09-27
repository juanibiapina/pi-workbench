# @juanibiapina/pi-socket

Lets local programs inspect and control a running Pi session through a private Unix socket.

## Install

Install the session context provider alongside this extension:

```sh
pi install npm:@juanibiapina/pi-session-context
pi install npm:@juanibiapina/pi-socket
```

If you use the [full workbench](../pi-workbench), this component is already included.

## Use

The socket path is published in `~/.local/share/pi/status/<sessionId>.json` under `extensions["pi-socket"].data.socketPath`. Send one JSON object per line and read one JSON response per line. For example:

```json
{"id":1,"protocolVersion":1,"type":"get_state"}
```

A successful response has `ok: true` and a `result` object; failures have `ok: false` and an `error` object. Requests support `ping`, `get_state`, `send_user_message`, `abort`, `shutdown`, `set_editor_text`, and `compact`. `send_user_message` accepts a `message` string and optional `delivery` (`auto`, `immediate`, `steer`, or `followUp`) and `images`. `set_editor_text` requires an interactive UI.

The socket is created under `~/.local/share/pi/sockets/` and removed when the session shuts down.
