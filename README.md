# pi-workbench

pi-workbench turns [Pi](https://github.com/earendil-works/pi) in tmux into a development environment.

## Full workbench

`@juanibiapina/pi-workbench` loads all components below as one Pi extension. Install it to use the full workbench:

```sh
pi install npm:@juanibiapina/pi-workbench
```

Run Pi inside tmux to see activity and notifications in tmux. Other features also work outside tmux.

## Components

Alternatively, install only the components you want. Each component's README lists the other components it needs. Do not install the full workbench and separate components in the same Pi installation.

| Component | Purpose |
| --- | --- |
| [`pi-workbench`](packages/pi-workbench) | Installs all components together. |
| [`pi-session-context`](packages/pi-session-context) | Stores session data and live status. |
| [`pi-tmux`](packages/pi-tmux) | Publishes Pi activity and pending notification state to tmux. |
| [`pi-socket`](packages/pi-socket) | Lets local programs control a running Pi session. |
| [`pi-plans`](packages/pi-plans) | Per session plans. |
| [`pi-github`](packages/pi-github) | Per session tracking of pushed branches, pull requests, and builds. |
| [`pi-skills`](packages/pi-skills) | Improve skills loader with support for remote URLs. |
| [`pi-title`](packages/pi-title) | Names sessions. |
| [`pi-git`](packages/pi-git) | Detects git pushes for other extensions. |

### pi-session-context

Tracks data for each session and live status. Check [protocol](docs/protocol.md) for integrating your own extensions.

**Tools:**

- `get_session_context`: Returns all data saved in the current session context.

Session data lives in `<sessionFile>.context.json`. Live status lives under `~/.local/share/pi/status/` until the session closes.

### pi-tmux

Tmux integration. Tracks when Pi is working and when it finishes outside the visible pane. It also saves the pane and window location in live session status.

These variables are available to display Pi's state in your tmux configuration:

- `@pi_state`: The pane's working or pending notification state.
- `@pi_notify_at`: The time of a pending notification.
- `@pi_win_state`: The window's state across its panes.

**Commands:** `pi-tmux-notify-switch` visits the oldest pending notification. `pi-tmux-notify-clear` clears notifications in a window.

Pi must run inside tmux for this feature to work. Configure tmux to call the clear command when you view a window.

### pi-socket

Opens a private Unix socket for the running session. Local programs can read its state and control the session.

**Socket requests:** `ping`, `get_state`, `send_user_message`, `abort`, `shutdown`, `set_editor_text`, `compact`.

The socket path appears in the live status from `pi-session-context`.

### pi-plans

Keeps editable Markdown plans with the session. Plan files live in `<sessionFile>.plans/`. Use the [plan browser](packages/pi-plans#open-and-review-a-plan) to read plans and send comments to Pi. With a TypeSafe API key, saved plans get a [Jev review](packages/pi-plans#plan-review).

**Tools:**

- `save_plan`: Saves a plan and returns its path.
- `delete_plan`: Removes a saved plan.

### pi-github

Tracks branches pushed during the session, with their pull requests and build status. Build status updates while builds run. Needs `gh` installed and logged in.

**Tools:**

- `save_pr`: Tracks a pull request the session did not push.
- `remove_pr`: Stops tracking a pull request.

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

### pi-git

Detects git pushes from any source while Pi runs: the agent, `!` commands, or another terminal. Other extensions receive each push on Pi's event bus. See [pi-git](packages/pi-git) for the event.
