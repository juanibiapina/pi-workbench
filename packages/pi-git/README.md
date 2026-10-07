# @juanibiapina/pi-git

Detects git pushes made while Pi runs, from any source, and announces them to other extensions.

## Install

```sh
pi install npm:@juanibiapina/pi-git
```

## Push event

Each push is emitted on Pi's extension event bus:

```ts
import { PUSH_EVENT, type PushEvent } from "@juanibiapina/pi-git";

pi.events.on(PUSH_EVENT, (data) => {
  const push = data as PushEvent;
});
```

| Field | Meaning |
| --- | --- |
| `repository` | Worktree top-level directory |
| `remote` | Remote name, such as `origin` |
| `remoteUrl` | Remote URL |
| `branch` | Branch name on the remote |
| `before` | Previous commit of the remote branch, or `null` if the push created it |
| `after` | Pushed commit |
| `pushedAt` | Push time in milliseconds |
| `source` | `"agent"` for pushes during a tool call, `"external"` for pushes found before a prompt |

## Limits

These pushes are not detected:

- Pushes to a URL instead of a remote name.
- Branch deletions.
- Pushes from tools that do not use the git command line, such as some GUI clients.
- Pushes from outside Pi while it is idle, until the next prompt.
