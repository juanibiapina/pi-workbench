# @juanibiapina/pi-github

Tracks builds of commits pushed in a Pi session and their GitHub pull requests.

## Install

Install the session context provider and pi-git alongside this extension:

```sh
pi install npm:@juanibiapina/pi-session-context
pi install npm:@juanibiapina/pi-git
pi install npm:@juanibiapina/pi-github
```

The [GitHub CLI](https://cli.github.com) `gh` must be installed and logged in.

## Tracking

The session keeps two lists: builds and pull requests. When a branch is pushed to a GitHub remote during the session, the session records a build with the pushed commit and its build status, replacing the branch's previous build. It also records the branch's pull request if one exists. Pushes to branches without a pull request, such as `main`, record only the build. [pi-git](../pi-git) detects the pushes.

pi-github checks GitHub shortly after a push and keeps checking until the builds finish. It also picks up a pull request opened for the branch soon after the push.

When a build fails, a "Build failed" line appears in the transcript with the repository, branch, commit, and pull request. Expand it to see the failed checks with links. The agent receives the same details: if it is working, it reads them during that run; otherwise it starts a turn to handle the failure.

## Agent tools

This extension adds these tools to Pi's context:

- `save_pr`: Tracks a pull request the session did not push, such as one the user gives. The URL must point to `https://github.com/<owner>/<repo>/pull/<number>`.
- `remove_pr`: Stops tracking a pull request and the build of its branch.

The required session context extension adds `get_session_context`, which shows tracked builds and pull requests under the `pi-github` namespace.
