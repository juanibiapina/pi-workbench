import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const features = ["pi-tmux", "pi-socket", "pi-plans", "pi-github", "pi-skills"];
test("packed packages load individually and together with Pi's loader", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-packages-loader-"));
  const agentDir = path.join(directory, "empty-agent");
  try {
    execFileSync("npm", ["pack", "--workspaces", "--pack-destination", directory], { cwd: root, stdio: "pipe" });
    const tarballs = await readdir(directory);
    const { version } = JSON.parse(await readFile(path.join(root, "packages/pi-workbench/package.json"), "utf8"));
    const aggregate = path.join(directory, "pi-workbench");
    const dependencies = path.join(aggregate, "node_modules", "@juanibiapina");
    for (const name of ["pi-workbench", "pi-session-context", ...features]) {
      const destination = name === "pi-workbench" ? aggregate : path.join(dependencies, name);
      await mkdir(destination, { recursive: true });
      const tarball = tarballs.find((entry) => entry === `juanibiapina-${name}-${version}.tgz`);
      assert.ok(tarball, `Missing ${name} tarball`);
      execFileSync("tar", ["-xzf", path.join(directory, tarball), "-C", destination, "--strip-components=1"]);
    }
    const provider = path.join(dependencies, "pi-session-context");
    for (const feature of features) {
      const featurePath = path.join(dependencies, feature);
      for (const entries of [[provider, featurePath], [featurePath, provider]]) {
        const result = await discoverAndLoadExtensions(entries, directory, agentDir);
        assert.deepEqual(result.errors, [], `${feature} failed in ${entries.map((entry) => path.basename(entry)).join(", ")} order`);
        assert.equal(result.extensions.length, 2);
        assert.equal(result.extensions.flatMap((extension) => [...extension.tools.keys()]).filter((name) => name === "get_session_context").length, 1);
      }
    }
    const onlyProvider = await discoverAndLoadExtensions([provider], directory, agentDir);
    assert.deepEqual(onlyProvider.errors, []);
    assert.deepEqual(onlyProvider.extensions.flatMap((extension) => [...extension.tools.keys()]), ["get_session_context"]);
    const complete = await discoverAndLoadExtensions([aggregate], directory, agentDir);
    assert.deepEqual(complete.errors, []);
    assert.deepEqual(complete.extensions.flatMap((extension) => [...extension.tools.keys()]).sort(),
      ["get_session_context", "save_plan", "delete_plan", "save_pr", "remove_pr", "load_skill"].sort());
  } finally { await rm(directory, { recursive: true, force: true }); }
});
