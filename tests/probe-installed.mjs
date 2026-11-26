import { discoverAndLoadExtensions } from '@earendil-works/pi-coding-agent';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const packagePath = process.argv[2];
if (!packagePath) throw new Error('Usage: node --import tsx tests/probe-installed.mjs <installed-package-path>');
const dir = await mkdtemp(path.join(tmpdir(), 'pi-nix-probe-'));
try {
  const loaded = await discoverAndLoadExtensions([packagePath], dir, path.join(dir, 'empty-agent'));
  if (loaded.errors.length) throw new Error(JSON.stringify(loaded.errors));
  const tools = [...loaded.extensions[0].tools.keys()];
  if (tools.join(',') !== 'set_session_name') throw new Error(`Unexpected tools: ${tools.join(', ')}`);
  console.log(JSON.stringify({ tools }));
} finally {
  await rm(dir, { recursive: true, force: true });
}
