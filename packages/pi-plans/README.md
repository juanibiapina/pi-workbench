# @juanibiapina/pi-plans

Saves editable Markdown plans with a Pi session.

## Install

```sh
pi install npm:@juanibiapina/pi-session-context
pi install npm:@juanibiapina/pi-plans
```

Already included in the [full workbench](../pi-workbench).

## Agent tools

This extension adds these tools to Pi's context:

- `save_plan`: Saves a plan as an editable Markdown file in `<sessionFile>.plans/`.
- `delete_plan`: Removes a saved plan and its file.

The required session context extension adds `get_session_context`, which lists saved plans and other session data.

## Open and review a plan

Start the server in a separate terminal:

```sh
~/.pi/agent/npm/node_modules/.bin/pi-plans-serve
```

Open the browser link in expanded `save_plan` results. Ctrl-C stops the server.

Approve a plan or submit comments to its running Pi session. This requires [pi-socket](../pi-socket#install), included in the full workbench.

### Configuration

For a project-local install, run `./.pi/npm/node_modules/.bin/pi-plans-serve` from the project directory.

Use `--help` for options. The default port is `19433`; if you change it with `--port`, set `PI_PLANS_URL` when launching Pi and [Starmux's `plan_server_url`](https://github.com/juanibiapina/starmux/blob/main/docs/configuration.md#selected-pi-context) to match.

## Development

From the repository root:

```sh
npm ci
npm run build
npm run plans
```

Run `npm run check` and `npm test` after building.
