# @juanibiapina/pi-skills

Loads local and public GitHub skills in a Pi session.

## Install

```sh
pi install npm:@juanibiapina/pi-skills
```

## Use

- `load_skill({ source })` loads a discovered local skill by name or a public GitHub skill by URL. GitHub URLs can point to a repository, a `/tree/<ref>[/<path>]` directory, or a `/blob/<ref>/<path>/SKILL.md` file. Pass `force: true` to refresh a GitHub skill's cached copy.
- `/skill:<name>` loads a local skill from Pi input.

The extension also presents the available skill catalog to Pi in its prompt.
