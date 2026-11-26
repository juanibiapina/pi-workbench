import { discoverAndLoadExtensions } from '@earendil-works/pi-coding-agent';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const packagePath = process.argv[2];
if (!packagePath) throw new Error('Usage: node --import tsx tests/probe-installed.mjs <installed-package-path>');
const dir = await mkdtemp(path.join(tmpdir(), 'pi-nix-probe-'));
try {
  const loaded = await discoverAndLoadExtensions([packagePath], dir, path.join(dir, 'empty-agent'));
  if (loaded.errors.length) throw new Error(JSON.stringify(loaded.errors));
  const extension = loaded.extensions[0];
  const tools = [...extension.tools.keys()].sort();
  if (tools.join(',') !== 'load_skill,set_session_name') throw new Error(`Unexpected tools: ${tools.join(', ')}`);
  const skillFile = path.join(dir, 'skills', 'probe-skill', 'SKILL.md');
  await mkdir(path.dirname(skillFile), { recursive: true });
  await writeFile(skillFile, '---\nname: probe-skill\ndescription: Probe skill\n---\n\n# Instructions\n');
  const ctx = { cwd: dir, hasUI: false, isIdle: () => true,
    getSystemPrompt: () => `<available_skills><skill><name>probe-skill</name><description>Probe skill</description><location>${skillFile}</location></skill></available_skills>` };
  const skill = await extension.tools.get('load_skill').definition.execute('probe', { source: 'probe-skill' }, undefined, undefined, ctx);
  if (!skill.content[0].text.includes('# Instructions')) throw new Error('Skill content did not load');
  console.log(JSON.stringify({ tools, skill: skill.details.name }));
} finally {
  await rm(dir, { recursive: true, force: true });
}
