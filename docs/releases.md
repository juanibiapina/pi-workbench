# npm releases

Run `npm ci`, `npm run check`, `npm test`, and `npm pack --dry-run --workspaces` before publishing.

## Package changelogs

Each package keeps its release history in `packages/<name>/CHANGELOG.md`. Add user-visible changes under that package's `[Unreleased]` heading as they land. Use the Keep a Changelog categories `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, and `Security` when relevant. Write concise entries about what users can observe. The `pi-workbench` changelog covers the bundled installation; feature details belong in the feature package's changelog.

For a release, move the affected entries to a dated section named for that package's new version, and leave `[Unreleased]` ready for future changes. Bump changed package versions and their dependants, keeping internal dependency versions exact. A dependant published only to update its dependency version can have a version section without a feature entry. Commit the relevant changelogs with the version changes, then push a `v*` tag to trigger `.github/workflows/publish.yml`. The publish script skips package versions already on npm, so the tag can trigger releases with different package versions. Do not use a root `npm version` command to bump all workspaces.
