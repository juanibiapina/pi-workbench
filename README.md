# pi-workbench

pi-workbench adds skill loading and session naming to [Pi](https://github.com/earendil-works/pi).

## Full workbench

`@juanibiapina/pi-workbench` loads all components below as one Pi extension. Install it to use the full workbench:

```sh
pi install npm:@juanibiapina/pi-workbench
```

## Components

Alternatively, install only the components you want. Each component's README lists the other components it needs. Do not install the full workbench and separate components in the same Pi installation.

| Component | Purpose |
| --- | --- |
| [`pi-workbench`](packages/pi-workbench) | Installs all components together. |
| [`pi-skills`](packages/pi-skills) | Improve skills loader with support for remote URLs. |
| [`pi-title`](packages/pi-title) | Names sessions. |

### pi-skills

Loads local skills and skills from public GitHub URLs.

**Tools:**

- `load_skill`: Loads a skill by local name or GitHub URL.

### pi-title

Names sessions. While a session has no name, it reminds the agent to name it.

**Tools:**

- `set_session_name`: Sets the session name.

**Commands:** `/title <name>` sets the session name.
