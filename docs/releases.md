# npm releases

Run `npm ci`, `npm run check`, `npm test`, and `npm pack --dry-run --workspaces` before publishing. Seven first versions must be created manually because npm cannot configure a trusted publisher for a package that does not exist yet ([npm/cli#8544](https://github.com/npm/cli/issues/8544)). Do this only after the dotfiles installation has passed its fresh-process checks.

## One-time manual first publish

Sign in with an npm account that owns the `@juanibiapina` scope. From this repository root, run each command in this order:

```sh
npm publish --workspace packages/pi-session-context --access public
npm publish --workspace packages/pi-tmux --access public
npm publish --workspace packages/pi-socket --access public
npm publish --workspace packages/pi-plans --access public
npm publish --workspace packages/pi-github --access public
npm publish --workspace packages/pi-skills --access public
npm publish --workspace packages/pi-workbench --access public
```

Check each name with `npm view @juanibiapina/<package> version`. Each package starts at `0.1.0`; the aggregate depends on the six published `0.1.0` versions.

## OIDC

On npmjs.com, open **Settings → Trusted publishing** on **each** of the seven packages. Set GitHub owner `juanibiapina`, repository `pi-workbench`, workflow filename `publish.yml`, and allow direct `npm publish`. The workflow uses a GitHub-hosted runner and `id-token: write`; it has no npm publish token. These settings are per package.

Bump all seven package versions and their internal dependency versions to `0.1.1`; commit and tag the public repository `v0.1.1`. The tag runs `.github/workflows/publish.yml`, checks the source, and publishes packages in provider/feature/aggregate order through OIDC. Verify all seven names report `0.1.1` with `npm view` and that a clean Pi installation loads each feature separately with the provider and loads the aggregate alone. For later releases, bump only changed packages and their dependants, keeping dependency versions exact.
