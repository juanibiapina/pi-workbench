import assert from "node:assert/strict";
import { writeFile, rm, symlink, rename, realpath } from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";
import { browserFixture } from "./plan-browser-fixture.ts";
import { startPlanBrowser } from "../packages/pi-plans/src/browser-server.ts";
import type { PlanDocument, MessageResult } from "../packages/pi-plans/src/browser-contract.ts";

test("plan links open after Pi closes and reflect Markdown edits", async () => {
  const f = await browserFixture();
  try {
    const doc = await (await f.request(f.endpoint)).json() as PlanDocument;
    assert.equal("recipient" in doc, false);
    assert.equal(doc.path, await realpath(f.file));
    await f.socket.close();
    const closed = await (await f.request(f.endpoint)).json() as PlanDocument;
    assert.equal(closed.markdown, doc.markdown);
    await writeFile(f.file, "# Revised plan\n");
    const edited = await (await f.request(f.endpoint)).json() as PlanDocument;
    assert.equal(edited.markdown, "# Revised plan\n");
    await assert.rejects(startPlanBrowser({ port: Number(new URL(f.browser.origin).port), roots: [], dataDir: f.root, assetsDir: path.join(f.root, "assets") }), { code: "EADDRINUSE" });
  } finally { await f.close(); }
});

test("custom session locations require a configured root after live status disappears", async () => {
  const f = await browserFixture();
  const browser = await startPlanBrowser({ port: 0, roots: [], dataDir: f.root, assetsDir: path.join(f.root, "assets") });
  try {
    assert.equal((await fetch(`${browser.origin}${f.endpoint}`)).status, 200);
    await rm(path.join(f.root, "status", "session-a.json"));
    assert.equal((await fetch(`${browser.origin}${f.endpoint}`)).status, 404);
    assert.equal((await f.request(f.endpoint)).status, 200);
  } finally { await browser.close(); await f.close(); }
});

test("implementation messages reach the owning idle session unchanged without comments", async () => {
  const f = await browserFixture();
  try {
    for (const message of ["Implement", "  Implement steps 1 and 2.\nKeep step 3 for later.  "]) {
      const response = await f.request(`${f.endpoint}/messages`, { message });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json() as MessageResult, { delivery: "immediate" });
      assert.deepEqual(f.messages.at(-1), { sessionId: "session-a", message, options: undefined });
    }
    assert.equal(f.messages.length, 2);
  } finally { await f.close(); }
});

test("each submission queues one unchanged message for the owning busy session", async () => {
  const f = await browserFixture();
  try {
    f.work();
    const message = "Review of plan: Delivery plan\nPlan ID: " + f.id + "\nMarkdown: " + f.file + "\n\n1. Selected text:\nall plans\nComment:\nComment 1\n\n2. Selected text:\n(Whole plan)\nComment:\nComment 2\n";
    for (let count = 1; count <= 2; count++) {
      const response = await f.request(`${f.endpoint}/messages`, { message });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json() as MessageResult, { delivery: "followUp" });
      assert.equal(f.messages.length, count);
      assert.deepEqual(f.messages.at(-1), { sessionId: "session-a", message, options: { deliverAs: "followUp" } });
    }
  } finally { await f.close(); }
});

test("invalid message bodies are rejected without delivering to Pi", async () => {
  const f = await browserFixture();
  try {
    for (const body of [{}, { message: "" }, { message: " \n\t" }, { message: 42 }, { message: null }, [], "Implement"]) {
      assert.equal((await f.request(`${f.endpoint}/messages`, body)).status, 400);
    }
    assert.equal((await f.request(`${f.endpoint}/reviews`, { comments: [] })).status, 404);
    assert.equal(f.messages.length, 0);
  } finally { await f.close(); }
});

test("messages submit after Markdown changes and deleted plans remain unavailable", async () => {
  const f = await browserFixture();
  try {
    await f.request(f.endpoint);
    await writeFile(f.file, "Changed");
    const response = await f.request(`${f.endpoint}/messages`, { message: "Implement" });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as MessageResult).delivery, "immediate");
    assert.equal(f.messages.length, 1);
    await rm(f.file);
    assert.equal((await f.request(`${f.endpoint}/messages`, { message: "Implement" })).status, 404);
    assert.equal(f.messages.length, 1);
  } finally { await f.close(); }
});

test("browser accepts large Markdown and messages within existing socket limits", async () => {
  const f = await browserFixture();
  try {
    const markdown = "# Large plan\n" + "Plan text.\n".repeat(30000);
    await writeFile(f.file, markdown);
    const document = await (await f.request(f.endpoint)).json() as PlanDocument;
    assert.equal(document.markdown, markdown);
    const message = "q".repeat(65000) + "\n" + "c".repeat(17000);
    const response = await f.request(`${f.endpoint}/messages`, { message, padding: "p".repeat(512 * 1024) });
    assert.equal(response.status, 200);
    assert.equal(f.messages[0]!.message, message);
    const oversized = await f.request(`${f.endpoint}/messages`, { message: "x".repeat(256 * 1024 + 1) });
    assert.equal(oversized.status, 502);
    assert.match((await oversized.json() as { error: string }).error, /message exceeds 262144 bytes/);
    assert.equal(f.messages.length, 1);
  } finally { await f.close(); }
});

test("messages fail when the owning session is unavailable or the socket switches sessions", async () => {
  const f = await browserFixture();
  try {
    f.switchSession();
    const response = await f.request(`${f.endpoint}/messages`, { message: "Implement" });
    assert.equal(response.status, 502);
    assert.match((await response.json() as { error: string }).error, /owning Pi session is no longer active/);
    await rm(path.join(f.root, "status", "session-a.json"));
    const unavailable = await f.request(`${f.endpoint}/messages`, { message: "Implement" });
    assert.equal(unavailable.status, 409);
    assert.match((await unavailable.json() as { error: string }).error, /Resume the owning Pi session/);
    assert.equal(f.messages.length, 0);
  } finally { await f.close(); }
});

test("plans open directly without browser authorization and linked attachments remain readable", async () => {
  const f = await browserFixture();
  try {
    const response = await f.request(f.endpoint);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal((await f.request("/")).status, 404);
    assert.equal((await f.request("/api/plans")).status, 404);
    assert.equal((await f.request("/api/auth", {})).status, 404);
    assert.equal((await f.request("/api/session")).status, 404);
    await writeFile(f.sessionFile, "# Linked plan");
    await rm(f.file); await symlink(f.sessionFile, f.file);
    assert.equal((await (await f.request(f.endpoint)).json() as PlanDocument).markdown, "# Linked plan");
    const directory = path.dirname(f.file);
    await rename(directory, `${directory}.linked`);
    await symlink(`${directory}.linked`, directory, "dir");
    assert.equal((await (await f.request(f.endpoint)).json() as PlanDocument).markdown, "# Linked plan");
  } finally { await f.close(); }
});
