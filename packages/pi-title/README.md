# @juanibiapina/pi-title

Names Pi sessions and asks the agent to name unnamed ones.

## Install

```sh
pi install npm:@juanibiapina/pi-title
```

## Use

- `/title <name>` sets the session name.
- `set_session_name({ name })` lets the agent set the session name. The agent is told to call it once, in its first tool batch.
- While the session has no name, each prompt carries a hidden reminder asking the agent to name it.

Pi shows the session name in the `/resume` selector instead of the first message.
