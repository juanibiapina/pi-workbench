# Pi Workbench

Seven Pi packages in one npm workspace. `@juanibiapina/pi-session-context` owns session and runtime files; five features contribute through its broker. `@juanibiapina/pi-workbench` loads all six from one Pi entry.

## Install

Install **either** `@juanibiapina/pi-workbench` **or** the provider and selected feature packages. For example, use `pi install npm:@juanibiapina/pi-workbench` for the full set, or `pi install npm:@juanibiapina/pi-session-context npm:@juanibiapina/pi-plans` for plans. A feature's npm dependency provides client code; it does not enable the provider extension. Do not enable both the aggregate and individual packages in one Pi installation.

Local path packages need their dependencies available under `node_modules`. The dotfiles repository pins one monorepo revision through Nix and assembles the package links before enabling the aggregate. npm installations resolve dependencies normally.

See [the contribution protocol](docs/protocol.md) and [release procedure](docs/releases.md).
