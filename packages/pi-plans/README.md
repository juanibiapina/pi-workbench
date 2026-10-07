# @juanibiapina/pi-plans

Saves editable Markdown plans with a Pi session.

## Install

```sh
pi install npm:@juanibiapina/pi-session-context
pi install npm:@juanibiapina/pi-plans
```

## Agent tools

This extension adds these tools to Pi's context:

- `save_plan`: Saves a plan as an editable Markdown file in `<sessionFile>.plans/`.
- `delete_plan`: Removes a saved plan and its file.

The required session context extension adds `get_session_context`, which lists saved plans and other session data.

## Plan review

When `TYPESAFE_API_KEY` is set in Pi's environment, `save_plan` asks TypeSafe's Jev model about each line of the saved plan. The saved plan shows the result: the number of findings, no findings, or why the review failed. Findings are also added to the tool result Pi reads. Jev flags lines that may:

- Build by hand something an existing library or tool already does.
- Add a component a simpler design could avoid.

Without the key, plans save as before. The review needs Pi 0.99 or later, adds about half a second, and sends the plan text to TypeSafe.

## Open and review a plan

Start the server in a separate terminal:

```sh
~/.pi/agent/npm/node_modules/.bin/pi-plans-serve
```

Open the browser link in expanded `save_plan` results. Ctrl-C stops the server.

Approve a plan or submit comments to its running Pi session. This requires [pi-socket](../pi-socket#install).

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
