import { execFile } from "node:child_process";
import * as path from "node:path";

export interface GitPush {
  repository: string;
  remote: string;
  remoteUrl: string;
  branch: string;
  before: string | null;
  after: string;
  pushedAt: number;
}

export interface PushDetector {
  check(): Promise<GitPush[]>;
}

type Git = (args: string[]) => Promise<string>;

function runner(cwd: string): Git {
  return (args) => new Promise((resolve, reject) => {
    execFile("git", args, { cwd, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

async function readRefs(git: Git): Promise<Map<string, string>> {
  const output = await git(["for-each-ref", "--format=%(refname) %(objectname)", "refs/remotes"]);
  const refs = new Map<string, string>();
  for (const line of output.split("\n")) {
    const [ref, sha] = line.split(" ");
    if (ref && sha && !ref.endsWith("/HEAD")) refs.set(ref, sha);
  }
  return refs;
}

type ReflogEntry = { sha: string; time: number; subject: string };

async function readReflog(git: Git, ref: string): Promise<ReflogEntry[]> {
  const output = await git(["reflog", "show", "--date=unix", "--format=%H%x09%gd%x09%gs", "-n", "100", ref, "--"]);
  return output.split("\n").filter(Boolean).map((line) => {
    const [sha, selector, ...subject] = line.split("\t");
    const time = Number(/@\{(\d+)\}$/.exec(selector ?? "")?.[1] ?? 0) * 1000;
    return { sha: sha!, time, subject: subject.join("\t") };
  });
}

export async function createPushDetector(options: { cwd: string }): Promise<PushDetector> {
  const git = runner(options.cwd);
  let repository: string;
  let known: Map<string, string>;
  try {
    repository = path.resolve(options.cwd, (await git(["rev-parse", "--show-toplevel"])).trim());
    known = await readRefs(git);
  } catch {
    return { check: async () => [] };
  }
  const scan = async (): Promise<GitPush[]> => {
    let current: Map<string, string>;
    try { current = await readRefs(git); } catch { return []; }
    const changed = [...current].filter(([ref, sha]) => known.get(ref) !== sha);
    const previous = known;
    known = current;
    if (!changed.length) return [];
    const remotes = (await git(["remote"]).catch(() => "")).split("\n").filter(Boolean).sort((a, b) => b.length - a.length);
    const urls = new Map<string, string>();
    const pushes: GitPush[] = [];
    for (const [ref, sha] of changed) {
      const name = ref.slice("refs/remotes/".length);
      const remote = remotes.find((candidate) => name.startsWith(`${candidate}/`));
      if (!remote) continue;
      const entries = await readReflog(git, ref).catch(() => []);
      const prior = previous.get(ref) ?? null;
      const fresh: ReflogEntry[] = [];
      for (const entry of entries) {
        if (prior !== null && entry.sha === prior) break;
        fresh.push(entry);
      }
      if (!fresh.length || fresh[0]!.sha !== sha) continue;
      if (!urls.has(remote)) urls.set(remote, (await git(["remote", "get-url", remote]).catch(() => "")).trim());
      for (let index = fresh.length - 1; index >= 0; index--) {
        const entry = fresh[index]!;
        if (entry.subject !== "update by push") continue;
        pushes.push({
          repository, remote, remoteUrl: urls.get(remote)!, branch: name.slice(remote.length + 1),
          before: fresh[index + 1]?.sha ?? prior, after: entry.sha, pushedAt: entry.time,
        });
      }
    }
    return pushes.sort((a, b) => a.pushedAt - b.pushedAt);
  };
  let queue: Promise<unknown> = Promise.resolve();
  return {
    check() {
      const result = queue.then(scan, scan);
      queue = result.catch(() => undefined);
      return result;
    },
  };
}

export async function currentBranch(cwd: string): Promise<string | null> {
  try { return (await runner(cwd)(["symbolic-ref", "--quiet", "--short", "HEAD"])).trim() || null; } catch { return null; }
}
