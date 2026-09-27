import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { migrateContexts } from "../scripts/migrate-context.mjs";

const legacy = (id: string) => ({ version: 1, sessionId: id, plans: [], pullRequests: [], skills: [] });

test("migration validates first, backs up inactive sessions, and waits for old processes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-context-migrate-"));
  const sessions = path.join(directory, "sessions");
  const status = path.join(directory, "status");
  await mkdir(sessions);
  await mkdir(status);
  try {
    for (const id of ["inactive", "active"]) {
      await writeFile(path.join(sessions, `${id}.jsonl`), "");
      await writeFile(path.join(sessions, `${id}.jsonl.context.json`), JSON.stringify(legacy(id)));
    }
    const activeStatus = path.join(status, "active.json");
    await writeFile(activeStatus, JSON.stringify({ version: 1, pid: process.pid, sessionFile: path.join(sessions, "active.jsonl") }));
    const planned = await migrateContexts(sessions, status);
    assert.equal(planned.validated, 2);
    assert.equal(planned.migrated, 0);
    assert.equal(planned.active.length, 1);
    const first = await migrateContexts(sessions, status, true);
    assert.equal(first.migrated, 1);
    assert.equal(JSON.parse(await readFile(path.join(sessions, "active.jsonl.context.json"), "utf8")).version, 1);
    assert.equal(JSON.parse(await readFile(path.join(sessions, "inactive.jsonl.context.json"), "utf8")).version, 2);
    assert.equal(JSON.parse(await readFile(path.join(sessions, "inactive.jsonl.context.json.v1.bak"), "utf8")).version, 1);
    await unlink(activeStatus);
    const second = await migrateContexts(sessions, status, true);
    assert.equal(second.migrated, 1);
    assert.equal(second.active.length, 0);
    assert.equal(JSON.parse(await readFile(path.join(sessions, "active.jsonl.context.json"), "utf8")).version, 2);
    await stat(path.join(sessions, "active.jsonl.context.json.v1.bak"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("invalid legacy data aborts before changing other contexts", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-context-invalid-"));
  try {
    const good = path.join(directory, "a.jsonl.context.json");
    await writeFile(good, JSON.stringify(legacy("a")));
    await writeFile(path.join(directory, "z.jsonl.context.json"), "{invalid");
    await assert.rejects(migrateContexts(directory, path.join(directory, "missing-status"), true), /Invalid JSON/);
    assert.equal(JSON.parse(await readFile(good, "utf8")).version, 1);
    await assert.rejects(stat(`${good}.v1.bak`), { code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
