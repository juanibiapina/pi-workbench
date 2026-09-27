import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

const packages = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../packages");
const features = ["pi-tmux", "pi-socket", "pi-plans", "pi-github", "pi-skills"];
test("copied packages load individually and together with Pi's loader", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-packages-loader-"));
  const agentDir = path.join(directory, "empty-agent");
  try {
    const aggregate = path.join(directory, "pi-workbench");
    await cp(path.join(packages, "pi-workbench"), aggregate, { recursive: true });
    const dependencies = path.join(aggregate, "node_modules", "@juanibiapina");
    for (const name of ["pi-session-context", ...features]) {
      await cp(path.join(packages, name), path.join(dependencies, name), { recursive: true });
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
