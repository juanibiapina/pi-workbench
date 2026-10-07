# @juanibiapina/pi-github

Tracks pushed branches, their GitHub pull requests, and their build status in a Pi session.

## Install

Install the session context provider and pi-git alongside this extension:

```sh
pi install npm:@juanibiapina/pi-session-context
pi install npm:@juanibiapina/pi-git
pi install npm:@juanibiapina/pi-github
```

The [GitHub CLI](https://cli.github.com) `gh` must be installed and logged in.

## Tracking

When a branch is pushed to a GitHub remote during the session, the session records the pushed commit, the branch's pull request if one exists, and the build status of the commit. Pushes to branches without a pull request, such as `main`, record build status only. [pi-git](../pi-git) detects the pushes.

While builds are running, pi-github checks GitHub every minute until they finish. Checks pause after 10 minutes without activity in Pi and resume on the next prompt. Pull request state and builds also refresh when a session resumes and before prompts, at most once a minute.

## Agent tools

This extension adds these tools to Pi's context:

- `save_pr`: Tracks a pull request the session did not push, such as one the user gives. The URL must point to `https://github.com/<owner>/<repo>/pull/<number>`.
- `remove_pr`: Stops tracking a pull request.

The required session context extension adds `get_session_context`, which shows tracked branches under the `pi-github` namespace.
