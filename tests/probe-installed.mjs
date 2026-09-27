import { discoverAndLoadExtensions } from '@earendil-works/pi-coding-agent';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { sendSocketRequest } from '../packages/pi-socket/src/socket-server.ts';

const packagePath = process.argv[2];
if (!packagePath) throw new Error('Usage: node --import tsx tests/probe-installed.mjs <installed-package-path>');
const dir = await mkdtemp(path.join(tmpdir(), 'pi-nix-probe-'));
const id = `probe-${process.pid}`;
const savedTmux = process.env.TMUX;
const savedPane = process.env.TMUX_PANE;
delete process.env.TMUX;
delete process.env.TMUX_PANE;
const loaded = await discoverAndLoadExtensions([packagePath], dir, path.join(dir, 'empty-agent'));
if (loaded.errors.length) throw new Error(JSON.stringify(loaded.errors));
loaded.runtime.getSessionName = () => 'Nix probe';
const extension = loaded.extensions[0];
const skillFile = path.join(dir, 'skills', 'probe-skill', 'SKILL.md');
await mkdir(path.dirname(skillFile), { recursive: true });
await writeFile(skillFile, '---\nname: probe-skill\ndescription: Probe skill\n---\n\n# Instructions\n');
const ctx = { cwd: dir, hasUI: false, isIdle: () => true,
  getSystemPrompt: () => `<available_skills><skill><name>probe-skill</name><description>Probe skill</description><location>${skillFile}</location></skill></available_skills>`,
  sessionManager: { getSessionId: () => id, getSessionFile: () => path.join(dir, `${id}.jsonl`) } };
let endpoint;
try {
  for (const handler of extension.handlers.get('session_start') ?? []) await handler({ type: 'session_start' }, ctx);
  const statusFile = path.join(homedir(), '.local/share/pi/status', `${id}.json`);
  const status = JSON.parse(await readFile(statusFile, 'utf8'));
  endpoint = status.extensions['pi-socket']?.data?.socketPath;
  if (status.version !== 2 || !endpoint) throw new Error('Missing provider or socket status');
  const ping = await sendSocketRequest(endpoint, { type: 'ping' });
  if (ping.ok !== true || ping.result?.type !== 'pong') throw new Error('Socket ping failed');
  const saved = await extension.tools.get('save_plan').definition.execute('probe', { title: 'Probe', content: '# Probe\n' }, undefined, undefined, ctx);
  await extension.tools.get('save_pr').definition.execute('probe', { url: 'https://github.com/owner/repo/pull/1' }, undefined, undefined, ctx);
  const loaded = await extension.tools.get('load_skill').definition.execute('probe', { source: 'probe-skill' }, undefined, undefined, ctx);
  if (!loaded.content[0].text.includes('# Instructions')) throw new Error('Skill content did not load');
  const details = await extension.tools.get('get_session_context').definition.execute('probe', {}, undefined, undefined, ctx);
  const entries = details.details.extensions;
  if (entries['pi-plans'].data.plans[0].id !== saved.details.plan.id ||
      entries['pi-github'].data.pullRequests[0] !== 'https://github.com/owner/repo/pull/1' ||
      entries['pi-skills'].data.skills[0] !== 'probe-skill') throw new Error('Contributions were not persisted');
  const context = JSON.parse(await readFile(`${ctx.sessionManager.getSessionFile()}.context.json`, 'utf8'));
  if (context.version !== 2 || Object.keys(context.extensions).length !== 3) throw new Error('Sidecar was not saved');
  console.log(JSON.stringify({ version: status.version, tools: [...extension.tools.keys()], socket: ping.result.type, plan: saved.details.plan.id, pr: entries['pi-github'].data.pullRequests[0], skill: entries['pi-skills'].data.skills[0] }));
} finally {
  for (const handler of extension.handlers.get('session_shutdown') ?? []) await handler({ type: 'session_shutdown' }, ctx);
  if (endpoint) await stat(endpoint).then(() => { throw new Error('Socket remained after shutdown'); }, () => undefined);
  await stat(path.join(homedir(), '.local/share/pi/status', `${id}.json`)).then(() => { throw new Error('Runtime record remained after shutdown'); }, () => undefined);
  await rm(dir, { recursive: true, force: true });
  if (savedTmux !== undefined) process.env.TMUX = savedTmux;
  if (savedPane !== undefined) process.env.TMUX_PANE = savedPane;
}
