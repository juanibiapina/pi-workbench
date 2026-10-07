# @juanibiapina/pi-workbench

Installs every pi-workbench component as one Pi extension.

## Install

```sh
pi install npm:@juanibiapina/pi-workbench
```

The bundle includes the session context provider and all feature components. Install individual packages only if you want a subset of these features.

## Components

- [`pi-session-context`](../pi-session-context): Session data and live status, including `get_session_context`.
- [`pi-tmux`](../pi-tmux): Tmux activity state and pending notifications.
- [`pi-socket`](../pi-socket): Local Unix socket for session control.
- [`pi-plans`](../pi-plans): Editable session plans with `save_plan` and `delete_plan`.
- [`pi-github`](../pi-github): Builds of pushed commits and their pull requests, plus `save_pr` and `remove_pr`.
- [`pi-skills`](../pi-skills): Local and GitHub skill loading with `load_skill`.
- [`pi-title`](../pi-title): Session naming with `/title` and `set_session_name`.
- [`pi-git`](../pi-git): Push detection for other extensions.

Run Pi inside tmux to use the tmux features. The other components also work outside tmux. See each component's README for usage details.
