import type { PushEvent } from "@juanibiapina/pi-git";
import { parsePullRequestUrl, parseRemoteUrl, type Checks, type GitHub, type PullRequest, type PullRequestView } from "./github.ts";

export interface TrackedBranch {
  repository: string;
  branch: string | null;
  head: { sha: string; pushedAt: string; source: PushEvent["source"] } | null;
  pullRequest: PullRequest | null;
  checks: Checks | null;
}

export interface GithubSession {
  branches: TrackedBranch[];
}

export interface SessionData {
  read(): Promise<unknown>;
  update(change: (current: unknown) => unknown): Promise<unknown>;
}

export interface Tracker {
  recordPush(push: PushEvent): Promise<void>;
  trackPullRequest(url: string): Promise<TrackedBranch>;
  untrackPullRequest(url: string): Promise<void>;
  refresh(): Promise<void>;
  touch(): void;
  stop(): void;
}

export function normalize(current: unknown): GithubSession {
  if (current === undefined || current === null) return { branches: [] };
  const data = current as { branches?: unknown; pullRequests?: unknown };
  if (Array.isArray(data.branches)) return { branches: data.branches as TrackedBranch[] };
  if (Array.isArray(data.pullRequests) && data.pullRequests.every((url) => typeof url === "string")) {
    return {
      branches: data.pullRequests.map((url: string) => {
        const { repository, number } = parsePullRequestUrl(url);
        return { repository, branch: null, head: null, pullRequest: { number, url, title: null, state: null }, checks: null };
      }),
    };
  }
  throw new Error("Invalid saved GitHub data");
}

type Key = { repository: string; branch: string | null; url?: string };
const NEW_PUSH_MS = 5 * 60_000;

const keyOf = (entry: TrackedBranch): Key => ({ repository: entry.repository, branch: entry.branch, url: entry.pullRequest?.url });
const matches = (entry: TrackedBranch, key: Key) => key.branch !== null
  ? entry.repository === key.repository && entry.branch === key.branch
  : entry.pullRequest?.url === key.url;

export function createTracker(options: {
  github: GitHub;
  session: SessionData;
  pollIntervalMs?: number;
  idleTimeoutMs?: number;
  now?: () => number;
}): Tracker {
  const { github, session } = options;
  const pollIntervalMs = options.pollIntervalMs ?? 60_000;
  const idleTimeoutMs = options.idleTimeoutMs ?? 10 * 60_000;
  const now = options.now ?? Date.now;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sleeping = false;
  let lastActivity = now();

  const waiting = (entry: TrackedBranch) => entry.checks?.state === "pending" ||
    (!!entry.head && (!entry.checks || entry.checks.state === "none") && Date.now() - Date.parse(entry.head.pushedAt) < NEW_PUSH_MS);
  const write = async (change: (data: GithubSession) => GithubSession): Promise<GithubSession> => {
    if (stopped) throw new Error("GitHub tracking stopped");
    const next = normalize(await session.update((current) => change(normalize(current))));
    if (next.branches.some(waiting)) arm();
    return next;
  };
  const patch = (key: Key, change: (entry: TrackedBranch) => TrackedBranch) => write((data) => ({
    branches: data.branches.map((entry) => matches(entry, key) ? change(entry) : entry),
  }));
  const background = (operation: Promise<unknown>) => { operation.catch(() => undefined); };

  const applyView = (key: Key, found: PullRequestView) => write((data) => {
    const target = data.branches.find((entry) => matches(entry, key));
    if (!target) return data;
    const rest = data.branches.filter((entry) => entry !== target);
    const twin = rest.find((entry) => entry.repository === found.repository && entry.branch === found.branch);
    const merged: TrackedBranch = { ...(twin ?? target), repository: found.repository, branch: found.branch, pullRequest: found.pullRequest };
    return { branches: [...rest.filter((entry) => entry !== twin), merged] };
  });
  const applyChecks = (key: Key, checks: Checks) => patch(key, (entry) => ({ ...entry, checks }));

  const resolve = async (entry: TrackedBranch): Promise<void> => {
    let key = keyOf(entry);
    let sha = entry.head?.sha ?? null;
    try {
      const found = entry.pullRequest
        ? await github.viewPullRequest(entry.pullRequest.url)
        : entry.branch ? await github.findPullRequest(entry.repository, entry.branch) : null;
      if (found) {
        await applyView(key, found);
        key = { repository: found.repository, branch: found.branch };
        sha = found.headSha;
      }
    } catch {}
    if (!sha) return;
    try { await applyChecks(key, await github.readChecks(key.repository, sha)); } catch {}
  };

  const poll = async () => {
    if (stopped) return;
    const data = normalize(await session.read());
    const pending = data.branches.filter(waiting);
    await Promise.all(pending.map(async (entry) => {
      const sha = entry.checks?.sha ?? entry.head!.sha;
      try {
        const checks = await github.readChecks(entry.repository, sha);
        await patch(keyOf(entry), (current) => (current.checks?.sha ?? current.head?.sha) === sha ? { ...current, checks } : current);
      } catch {}
    }));
    if (pending.length) arm();
  };
  function arm() {
    if (stopped || timer || sleeping) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (now() - lastActivity > idleTimeoutMs) { sleeping = true; return; }
      background(poll());
    }, pollIntervalMs);
    timer.unref?.();
  }

  return {
    async recordPush(push) {
      const repository = parseRemoteUrl(push.remoteUrl);
      if (!repository || stopped) return;
      const key: Key = { repository, branch: push.branch };
      const head = { sha: push.after, pushedAt: new Date(push.pushedAt).toISOString(), source: push.source };
      await write((data) => data.branches.some((entry) => matches(entry, key))
        ? { branches: data.branches.map((entry) => matches(entry, key) ? { ...entry, head, checks: entry.checks?.sha === head.sha ? entry.checks : null } : entry) }
        : { branches: [...data.branches, { repository, branch: push.branch, head, pullRequest: null, checks: null }] });
      const [found, checks] = await Promise.allSettled([github.findPullRequest(repository, push.branch), github.readChecks(repository, push.after)]);
      if (found.status === "fulfilled") {
        if (found.value) await applyView(key, found.value);
        else await patch(key, (entry) => ({ ...entry, pullRequest: null }));
      }
      if (checks.status === "fulfilled") await patch(key, (entry) => entry.head?.sha === push.after ? { ...entry, checks: checks.value } : entry);
    },
    async trackPullRequest(url) {
      const { repository, number } = parsePullRequestUrl(url);
      let key: Key = { repository, branch: null, url };
      const saved = await write((data) => data.branches.some((entry) => entry.pullRequest?.url === url) ? data
        : { branches: [...data.branches, { repository, branch: null, head: null, pullRequest: { number, url, title: null, state: null }, checks: null }] });
      const existing = saved.branches.find((entry) => entry.pullRequest?.url === url)!;
      key = keyOf(existing);
      try {
        const found = await github.viewPullRequest(url);
        await applyView(key, found);
        key = { repository: found.repository, branch: found.branch };
        await applyChecks(key, await github.readChecks(found.repository, found.headSha));
      } catch {}
      const data = normalize(await session.read());
      return data.branches.find((entry) => entry.pullRequest?.url === url) ?? existing;
    },
    async untrackPullRequest(url) {
      await write((data) => {
        if (!data.branches.some((entry) => entry.pullRequest?.url === url)) throw new Error(`PR not found in this session: ${url}`);
        return { branches: data.branches.filter((entry) => entry.pullRequest?.url !== url) };
      });
    },
    async refresh() {
      if (stopped) return;
      const data = normalize(await session.read());
      await Promise.all(data.branches.map(resolve));
    },
    touch() {
      lastActivity = now();
      if (!sleeping) return;
      sleeping = false;
      background(poll());
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}
