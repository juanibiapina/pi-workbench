import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Pi installations expose a server that serves packaged plans and assets", { timeout: 120_000 }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-plans-package-"));
  try {
    execFileSync("npm", ["pack", "--workspaces", "--pack-destination", directory], { cwd: root, stdio: "pipe" });
    const tarballs: Record<string, string> = {};
    for (const file of await readdir(directory)) {
      if (!file.endsWith(".tgz")) continue;
      const manifest = JSON.parse(execFileSync("tar", ["-xOf", path.join(directory, file), "package/package.json"], { encoding: "utf8" }));
      tarballs[manifest.name] = path.join(directory, file);
    }
    for (const [name, local] of [["pi-plans", false], ["pi-workbench", false], ["pi-plans", true]] as const) {
      await t.test(`${name} ${local ? "project" : "personal"} installation`, async () => {
        const cwd = path.join(directory, `${name}-${local}`);
        const agentDir = path.join(cwd, "agent");
        const installRoot = local ? path.join(cwd, ".pi", "npm") : path.join(agentDir, "npm");
        await mkdir(installRoot, { recursive: true });
        const packageName = `@juanibiapina/${name}`;
        // Install internal packages from tarballs and reuse the real external dependencies installed by npm ci.
        const overrides = Object.fromEntries(Object.entries(tarballs).filter(([entry]) => entry !== packageName).map(([entry, file]) => [entry, `file:${file}`]));
        for (const dependency of ["@earendil-works/pi-ai", "@sinclair/typebox"]) {
          overrides[dependency] = `file:${path.join(root, "node_modules", dependency)}`;
        }
        await writeFile(path.join(installRoot, "package.json"), JSON.stringify({ name: "pi-extensions", private: true, overrides }));
        const settingsManager = SettingsManager.inMemory({ npmCommand: ["npm", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"] }, { projectTrusted: true });
        const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
        await manager.install(`npm:${tarballs[packageName]}`, { local });
        const binary = path.join(installRoot, "node_modules", ".bin", "pi-plans-serve");
        const help = execFileSync(binary, ["--help"], { cwd, encoding: "utf8", env: { ...process.env, PI_PLANS_URL: "http://127.0.0.1:19433" } });
        assert.match(help, /pi-plans-serve/);
        assert.match(help, /--port/);
        assert.match(help, /--root/);
        assert.match(help, /--data-dir/);

        const sessions = path.join(cwd, "sessions");
        const sessionFile = path.join(sessions, "session.jsonl");
        const id = "0123456789abcdef01234567";
        const planPath = `/plans/session-a/${id}`;
        const markdown = "# Packaged plan\n\nRun the installed server.\n";
        await mkdir(`${sessionFile}.plans`, { recursive: true });
        await writeFile(sessionFile, "");
        await writeFile(`${sessionFile}.plans/${id}.md`, markdown);
        await writeFile(`${sessionFile}.context.json`, JSON.stringify({ version: 2, sessionId: "session-a", extensions: { "pi-plans": { version: 1, data: { plans: [{ id, title: "Packaged plan", path: `session.jsonl.plans/${id}.md` }] } } } }));
        const listener = createServer();
        listener.listen(0, "127.0.0.1");
        await once(listener, "listening");
        const address = listener.address();
        assert.ok(address && typeof address !== "string");
        const port = address.port;
        await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
        const origin = `http://127.0.0.1:${port}`;
        const child = spawn(binary, ["--port", String(port), "--root", sessions, "--data-dir", cwd], { cwd, env: { ...process.env, PI_PLANS_URL: origin }, stdio: ["ignore", "pipe", "pipe"] });
        let output = "";
        let errors = "";
        child.stderr.on("data", (data) => { errors += data; });
        try {
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error(`Server startup timed out: ${output}${errors}`)), 10_000);
            child.once("error", (error) => { clearTimeout(timeout); reject(error); });
            child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Server exited (${code}): ${output}${errors}`)); });
            child.stdout.on("data", (data) => {
              output += data;
              if (output.includes(`Plan server listening at ${origin}.`)) { clearTimeout(timeout); resolve(); }
            });
          });
          const response = await fetch(`${origin}${planPath}`, { signal: AbortSignal.timeout(10_000) });
          assert.equal(response.status, 200);
          const html = await response.text();
          const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map((match) => match[1]);
          assert.ok(assets.some((asset) => asset.endsWith(".js")), "HTML references bundled JavaScript");
          assert.ok(assets.some((asset) => asset.endsWith(".css")), "HTML references bundled CSS");
          for (const asset of assets) {
            const response = await fetch(`${origin}${asset}`, { signal: AbortSignal.timeout(10_000) });
            assert.equal(response.status, 200, asset);
            assert.ok((await response.arrayBuffer()).byteLength > 0, asset);
          }
          const document = await fetch(`${origin}/api${planPath}`, { signal: AbortSignal.timeout(10_000) });
          assert.equal(document.status, 200);
          assert.equal((await document.json()).markdown, markdown);
        } finally {
          if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, "exit", { signal: AbortSignal.timeout(10_000) });
            child.kill("SIGINT");
            try { await exited; } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
          }
        }
        const probe = createServer();
        probe.listen(port, "127.0.0.1");
        try { await once(probe, "listening"); }
        finally { await new Promise<void>((resolve) => probe.close(() => resolve())); }
      });
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
