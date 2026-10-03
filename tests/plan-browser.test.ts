import assert from "node:assert/strict";
import { writeFile, rm, symlink, rename } from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";
import { browserFixture } from "./plan-browser-fixture.ts";
import { startPlanBrowser } from "../packages/pi-plans/src/browser-server.ts";
import { sendSocketRequest } from "../packages/pi-socket/src/socket-server.ts";
import type { PlanDocument, ReviewResult } from "../packages/pi-plans/src/browser-contract.ts";

test("plan links open after Pi closes and reflect Markdown edits", async () => {
  const f = await browserFixture();
  try {
    const doc = await (await f.request(f.endpoint)).json() as PlanDocument;
    assert.equal("recipient" in doc, false);
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

test("each submission sends its comments as one message to the owning busy session", async () => {
  const f = await browserFixture();
  try {
    f.work();
    const review = { comments: [1, 2, 3].map(n => ({ id: `c${n}`, quote: "all plans", text: `Comment ${n}` })) };
    const response = await f.request(`${f.endpoint}/reviews`, review);
    assert.equal(response.status, 200);
    assert.equal((await response.json() as ReviewResult).delivery, "followUp");
    assert.equal(f.messages.length, 1);
    assert.equal(f.messages[0]!.sessionId, "session-a");
    assert.deepEqual(f.messages[0]!.options, { deliverAs: "followUp" });
    assert.match(String(f.messages[0]!.message), /Comment 1[\s\S]*Comment 2[\s\S]*Comment 3/);
    assert.equal((await f.request(`${f.endpoint}/reviews`, review)).status, 200);
    assert.equal(f.messages.length, 2);
  } finally { await f.close(); }
});

test("reviews submit after Markdown changes and deleted plans remain unavailable", async () => {
  const f = await browserFixture();
  try {
    await f.request(f.endpoint);
    const review = { comments: [{ id: "c1", quote: "all plans", text: "Explain this" }] };
    await writeFile(f.file, "Changed");
    const response = await f.request(`${f.endpoint}/reviews`, review);
    assert.equal(response.status, 200);
    assert.equal((await response.json() as ReviewResult).delivery, "immediate");
    assert.equal(f.messages.length, 1);
    assert.match(String(f.messages[0]!.message), /all plans[\s\S]*Explain this/);
    await rm(f.file);
    assert.equal((await f.request(`${f.endpoint}/reviews`, review)).status, 404);
    assert.equal(f.messages.length, 1);
  } finally { await f.close(); }
});

test("browser accepts large Markdown and comments within existing socket limits", async () => {
  const f = await browserFixture();
  try {
    const markdown = "# Large plan\n" + "Plan text.\n".repeat(30000);
    await writeFile(f.file, markdown);
    const document = await (await f.request(f.endpoint)).json() as PlanDocument;
    assert.equal(document.markdown, markdown);
    const quote = "q".repeat(65000);
    const text = "c".repeat(17000);
    const comments = Array.from({ length: 101 }, (_, index) => ({ id: `c${index}`, quote: index ? "quote" : quote, text: index ? "Comment" : text }));
    const response = await f.request(`${f.endpoint}/reviews`, { comments, padding: "p".repeat(512 * 1024) });
    assert.equal(response.status, 200);
    assert.equal(f.messages.length, 1);
    const message = String(f.messages[0]!.message);
    assert.ok(Buffer.byteLength(message) < 256 * 1024);
    assert.ok(message.includes(quote));
    assert.ok(message.includes(text));
    assert.ok(message.includes("101. Selected text:"));
    const oversized = await f.request(`${f.endpoint}/reviews`, { comments: [{ id: "oversized", quote: "", text: "x".repeat(256 * 1024) }] });
    assert.equal(oversized.status, 502);
    assert.match((await oversized.json() as { error: string }).error, /message exceeds 262144 bytes/);
    assert.equal(f.messages.length, 1);
  } finally { await f.close(); }
});

test("socket guards reject a switched session", async () => {
  const f = await browserFixture();
  try {
    const expected = { expectedSessionId: "session-a" };
    const request = { type: "send_user_message", message: "Review", ...expected };
    assert.equal((await sendSocketRequest(f.socket.socketPath, request)).ok, true);
    assert.equal(f.messages.length, 1);
    f.switchSession();
    const response = await sendSocketRequest(f.socket.socketPath, request);
    assert.deepEqual(response.error, { code: "session_mismatch", message: "The owning Pi session is no longer active on this socket" });
    assert.equal(f.messages.length, 1);
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
