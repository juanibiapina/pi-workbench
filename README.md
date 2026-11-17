# pi-workbench

pi-workbench turns [Pi](https://github.com/earendil-works/pi) into a development environment.

## Full workbench

`@juanibiapina/pi-workbench` loads all components below as one Pi extension. Install it to use the full workbench:

```sh
pi install npm:@juanibiapina/pi-workbench
```

## Components

Alternatively, install only the components you want. Each component's README lists the other components it needs. Do not install the full workbench and separate components in the same Pi installation.

| Component | Purpose |
| --- | --- |
| [`pi-workbench`](packages/pi-workbench) | Installs all components together. |
| [`pi-session-context`](packages/pi-session-context) | Stores session data and live status. |
| [`pi-socket`](packages/pi-socket) | Lets local programs control a running Pi session. |
| [`pi-plans`](packages/pi-plans) | Per session plans. |
| [`pi-skills`](packages/pi-skills) | Improve skills loader with support for remote URLs. |
| [`pi-title`](packages/pi-title) | Names sessions. |

### pi-session-context

Tracks data for each session and live status. Check [protocol](docs/protocol.md) for integrating your own extensions.

**Tools:**

- `get_session_context`: Returns all data saved in the current session context.

Session data lives in `<sessionFile>.context.json`. Live status lives under `~/.local/share/pi/status/` until the session closes.

### pi-socket

Opens a private Unix socket for the running session. Local programs can read its state and control the session.

**Socket requests:** `ping`, `get_state`, `send_user_message`, `abort`, `shutdown`, `set_editor_text`, `compact`.

The socket path appears in the live status from `pi-session-context`.

### pi-plans

Keeps editable Markdown plans with the session. Plan files live in `<sessionFile>.plans/`. Use the [plan browser](packages/pi-plans#open-and-review-a-plan) to read plans and send comments to Pi.

**Tools:**

- `save_plan`: Saves a plan and returns its path.
- `delete_plan`: Removes a saved plan.

### pi-skills

Loads local skills and skills from public GitHub URLs. Records loaded skills with the session.

**Tools:**

- `load_skill`: Loads a skill by local name or GitHub URL.

Skills invoked with `/skill:<name>` are also tracked.

### pi-title

Names sessions. While a session has no name, it reminds the agent to name it.

**Tools:**

- `set_session_name`: Sets the session name.

**Commands:** `/title <name>` sets the session name.
