# @juanibiapina/pi-git

Detects git pushes made by the agent's commands in a Pi session and announces them to other extensions.

A push belongs to the session whose `bash` command made it. The command must mention `push`, `gh pr create`, or `but pr`, directly or from a codemode script. Other sessions in the same repository or its worktrees do not report the push.

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

## Limits

These pushes are not detected:

- Pushes to a URL instead of a remote name.
- Branch deletions.
- Pushes from tools that do not record pushes in the git reflog, such as some GUI clients.
- Pushes from commands that do not mention `push`, `gh pr create`, or `but pr`, such as `npm run release`.
- Pushes from a terminal or from another session.

When two sessions run push commands at the same time, both report each other's pushes.
