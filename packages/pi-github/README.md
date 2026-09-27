# @juanibiapina/pi-github

Associates GitHub pull requests with a Pi session.

## Install

Install the session context provider alongside this extension:

```sh
pi install npm:@juanibiapina/pi-session-context
pi install npm:@juanibiapina/pi-github
```

If you use the [full workbench](../pi-workbench), this component is already included.

## Use

- `save_pr({ url })` adds a GitHub pull request URL to the current session. Saving the same URL again has no effect.
- `remove_pr({ url })` removes an associated pull request.
- `get_session_context()` lists the saved URLs under the `pi-github` namespace.

URLs must point to `https://github.com/<owner>/<repo>/pull/<number>`. The associations are saved in the session's context file.
