# @juanibiapina/pi-plans

Saves editable Markdown plans with a Pi session.

## Install

Install the session context provider alongside this extension:

```sh
pi install npm:@juanibiapina/pi-session-context
pi install npm:@juanibiapina/pi-plans
```

If you use the [full workbench](../pi-workbench), this component is already included.

## Use

- `save_plan({ title, content })` creates a Markdown file and returns its path and plan ID.
- Edit the returned file path with your usual file tools. The plan lives in `<sessionFile>.plans/`.
- `get_session_context()` lists plan IDs and attachment paths.
- `delete_plan({ planId })` removes the plan and its Markdown file.

The plan index is saved in the session's context file under the `pi-plans` namespace.

## Open and review a plan

Start the server from a source checkout:

```sh
npm ci
npm run build
npm run plans
```

Open the browser link in expanded `save_plan` results. The package also provides the `pi-plans-serve` command.

Select text, add comments, and send them to the plan's Pi session. That session must be running with `pi-socket` loaded. Busy sessions receive comments on their next turn. Drafts are saved in the browser, and plans remain readable after their session closes.

### Configuration

```sh
npm run plans -- --port 19434 --root /absolute/session-directory
```

The default session directory is `~/.pi/agent/sessions`. Repeat `--root` for additional directories. Live status also supplies session locations while Pi is running. `--data-dir` selects the live status directory's parent; its default is `~/.local/share/pi`.

For a custom port, set `PI_PLANS_URL` to the server URL when launching Pi. Set the same URL in [Starmux's `plan_server_url`](https://github.com/juanibiapina/starmux/blob/main/docs/configuration.md#selected-pi-context) to open plans from its sidebar.

## Development checks

Run `npm run check`, `npm test`, and `npm run build`.
