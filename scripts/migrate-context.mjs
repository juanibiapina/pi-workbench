import { fileURLToPath } from 'node:url';
import { copyFile, mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../packages/pi-session-context/src/store.ts';

const isMissing = (error) => error?.code === 'ENOENT';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sidecars(root) {
  const found = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && entry.name.endsWith('.context.json')) found.push(file);
    }
  }
  await visit(await realpath(root));
  return found.sort();
}

async function liveFiles(statusDir) {
  const active = new Set();
  let entries;
  try { entries = await readdir(statusDir, { withFileTypes: true }); }
  catch (error) { if (isMissing(error)) return active; throw error; }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    let value;
    try { value = JSON.parse(await readFile(path.join(statusDir, entry.name), 'utf8')); }
    catch { continue; }
    if (!Number.isInteger(value.pid) || value.pid <= 0 || typeof value.sessionFile !== 'string') continue;
    try { process.kill(value.pid, 0); }
    catch (error) { if (error.code === 'ESRCH') continue; if (error.code !== 'EPERM') throw error; }
    try { active.add(`${await realpath(value.sessionFile)}.context.json`); }
    catch (error) { if (!isMissing(error)) throw error; }
  }
  return active;
}

export async function migrateContexts(root, statusDir, apply = false) {
  const store = new Store();
  const candidates = [];
  // Validate all sidecars before changing any. A malformed file remains available for repair.
  for (const file of await sidecars(root)) {
    const original = await readFile(file, 'utf8');
    let value;
    try { value = JSON.parse(original); }
    catch { throw new Error(`Invalid JSON in ${file}`); }
    if (value?.version === 2) continue;
    if (value?.version !== 1 || typeof value.sessionId !== 'string') throw new Error(`Unknown Pi session context: ${file}`);
    const temporaryDir = await mkdtemp(path.join(tmpdir(), 'pi-context-check-'));
    try {
      const copied = path.join(temporaryDir, path.basename(file));
      await copyFile(file, copied);
      await store.readSession(copied, value.sessionId);
    } catch (error) { throw new Error(`Cannot migrate ${file}: ${String(error)}`); }
    finally { await rm(temporaryDir, { recursive: true, force: true }); }
    const info = await stat(file);
    candidates.push({ file, sessionId: value.sessionId, size: info.size, mtimeMs: info.mtimeMs });
  }
  const active = await liveFiles(statusDir);
  const result = { validated: candidates.length, migrated: 0, active: [], changed: [] };
  for (const candidate of candidates) {
    if (active.has(candidate.file)) { result.active.push(candidate.file); continue; }
    if (!apply) continue;
    const info = await stat(candidate.file);
    if (info.size !== candidate.size || info.mtimeMs !== candidate.mtimeMs) {
      result.changed.push(candidate.file);
      continue;
    }
    await store.readSession(candidate.file, candidate.sessionId);
    result.migrated++;
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const follow = args.includes('--follow');
  if (follow && !apply) throw new Error('--follow requires --apply');
  const option = (flag, fallback) => {
    const index = args.indexOf(flag);
    return index === -1 ? fallback : args[index + 1] ?? (() => { throw new Error(`Missing ${flag} value`); })();
  };
  const root = option('--root', path.join(homedir(), '.pi/agent/sessions'));
  const statusDir = option('--status-dir', path.join(homedir(), '.local/share/pi/status'));
  for (;;) {
    const result = await migrateContexts(root, statusDir, apply);
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...result }));
    if (!follow || (!result.active.length && !result.changed.length)) return;
    await sleep(30000);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
