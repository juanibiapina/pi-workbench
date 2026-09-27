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
