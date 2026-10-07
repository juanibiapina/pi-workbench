# @juanibiapina/pi-tmux

Shows Pi activity in tmux and navigates pending notifications.

## Install

Install the session context provider alongside this extension:

```sh
pi install npm:@juanibiapina/pi-session-context
pi install npm:@juanibiapina/pi-tmux
```

Run Pi inside tmux to publish pane and window state.

## Use

The extension sets these tmux user options:

- `@pi_state` on the Pi pane: `working`, `notify` when Pi finishes outside the visible pane, or unset when idle and seen.
- `@pi_notify_at` on the pane: timestamp in milliseconds for pending notifications.
- `@pi_win_state` on the window: `working`, `notify`, or unset, computed from its panes.

Use `#{@pi_win_state}` in a tmux status format to show window state. `pi-tmux-notify-switch` selects the oldest pending notification. `pi-tmux-notify-clear [window-id]` clears pending notifications in a window (the current window by default). Configure a tmux navigation hook to call the clear command when a window is viewed.

The extension also publishes its tmux location in the session context provider's live status under `pi-tmux`.
