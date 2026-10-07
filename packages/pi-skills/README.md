# @juanibiapina/pi-skills

Loads local and public GitHub skills and records their use in a Pi session.

## Install

Install the session context provider alongside this extension:

```sh
pi install npm:@juanibiapina/pi-session-context
pi install npm:@juanibiapina/pi-skills
```

## Use

- `load_skill({ source })` loads a discovered local skill by name or a public GitHub skill by URL. GitHub URLs can point to a repository, a `/tree/<ref>[/<path>]` directory, or a `/blob/<ref>/<path>/SKILL.md` file. Pass `force: true` to refresh a GitHub skill's cached copy.
- `/skill:<name>` loads a local skill from Pi input.
- `get_session_context()` lists loaded skills under the `pi-skills` namespace.

The extension also presents the available skill catalog to Pi in its prompt.
