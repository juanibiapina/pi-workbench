import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const names = ["pi-session-context", "pi-tmux", "pi-socket", "pi-plans", "pi-github", "pi-skills", "pi-workbench"];
for (const name of names) {
  const workspace = `packages/${name}`;
  const { version } = JSON.parse(readFileSync(`${workspace}/package.json`, "utf8"));
  const packageName = `@juanibiapina/${name}`;
  const lookup = spawnSync("npm", ["view", `${packageName}@${version}`, "version", "--prefer-online", "--json"], { encoding: "utf8" });
  if (lookup.status === 0) {
    console.log(`${packageName}@${version} already published`);
    continue;
  }
  if (!/E404|404 Not Found/.test(lookup.stderr ?? "")) {
    throw new Error(`Cannot check ${packageName}@${version}: ${lookup.stderr}`);
  }
  execFileSync("npm", ["publish", "--workspace", workspace, "--access", "public"], { stdio: "inherit" });
}
