import type { PushEvent } from "@juanibiapina/pi-git";
import { parsePullRequestUrl, parseRemoteUrl, type Checks, type GitHub, type PullRequest } from "./github.ts";

export interface Build {
  repository: string;
  branch: string;
  sha: string;
  pushedAt: string;
  source: PushEvent["source"];
  checks: Checks | null;
}

export interface GithubSession {
  builds: Build[];
  pullRequests: PullRequest[];
}

export interface BuildFailure {
  build: Build;
  pullRequest: PullRequest | null;
}

export interface SessionData {
  read(): Promise<unknown>;
  update(change: (current: unknown) => unknown): Promise<unknown>;
}

export interface Tracker {
  recordPush(push: PushEvent): Promise<void>;
  trackPullRequest(url: string): Promise<PullRequest>;
  untrackPullRequest(url: string): Promise<void>;
  refresh(): Promise<void>;
  touch(): void;
  stop(): void;
}

export function normalize(current: unknown): GithubSession {
  if (current === undefined || current === null) return { builds: [], pullRequests: [] };
  const data = current as { builds?: unknown; pullRequests?: unknown; branches?: unknown };
  if (Array.isArray(data.builds)) {
    return { builds: data.builds as Build[], pullRequests: Array.isArray(data.pullRequests) ? data.pullRequests as PullRequest[] : [] };
  }
  if (Array.isArray(data.pullRequests) && data.pullRequests.every((url) => typeof url === "string")) {
    return {
      builds: [],
      pullRequests: data.pullRequests.map((url: string) => {
        const { repository, number } = parsePullRequestUrl(url);
        return { repository, number, url, branch: null, title: null, state: null };
      }),
    };
  }
  if (Array.isArray(data.branches)) return { builds: [], pullRequests: [] };
  throw new Error("Invalid saved GitHub data");
}

const NEW_PUSH_MS = 5 * 60_000;

const onBranch = (item: { repository: string; branch: string | null }, repository: string, branch: string) =>
  item.repository === repository && item.branch === branch;
const pullRequestOf = (data: GithubSession, build: Build) =>
  data.pullRequests.find((pr) => onBranch(pr, build.repository, build.branch)) ?? null;
const finished = (checks: Checks | null) => !!checks && checks.state !== "pending" && checks.state !== "none";

export function createTracker(options: {
  github: GitHub;
  session: SessionData;
  pollIntervalMs?: number;
  idleTimeoutMs?: number;
  now?: () => number;
  onBuildFailure?: (failure: BuildFailure) => void;
}): Tracker {
  const { github, session, onBuildFailure } = options;
  const pollIntervalMs = options.pollIntervalMs ?? 60_000;
  const idleTimeoutMs = options.idleTimeoutMs ?? 10 * 60_000;
  const now = options.now ?? Date.now;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sleeping = false;
  let lastActivity = now();

  const watched = (data: GithubSession) => (build: Build) => build.checks?.state === "pending" ||
    (Date.now() - Date.parse(build.pushedAt) < NEW_PUSH_MS && (!finished(build.checks) || !pullRequestOf(data, build)));
  const write = async (change: (data: GithubSession) => GithubSession): Promise<GithubSession> => {
    if (stopped) throw new Error("GitHub tracking stopped");
    const next = normalize(await session.update((current) => change(normalize(current))));
    if (next.builds.some(watched(next))) arm();
    return next;
  };
  const background = (operation: Promise<unknown>) => { operation.catch(() => undefined); };

  const savePullRequest = (found: PullRequest, url = found.url) => write((data) => {
    let placed = false;
    const pullRequests = data.pullRequests.flatMap((pr) => {
      if (pr.url !== url && pr.url !== found.url) return [pr];
      if (placed) return [];
      placed = true;
      return [found];
    });
    if (!placed) {
      if (!found.branch || !data.builds.some((build) => onBranch(build, found.repository, found.branch!))) return data;
      pullRequests.push(found);
    }
    return { ...data, pullRequests };
  });

  const writeChecks = async (repository: string, branch: string, checks: Checks) => {
    let failed = false;
    const next = await write((data) => {
      const target = data.builds.find((build) => onBranch(build, repository, branch));
      failed = false;
      if (!target || target.sha !== checks.sha) return data;
      failed = checks.state === "failure" && target.checks?.state !== "failure";
      return { ...data, builds: data.builds.map((build) => build === target ? { ...build, checks } : build) };
    });
    if (!failed || !onBuildFailure) return;
    const build = next.builds.find((item) => onBranch(item, repository, branch));
    if (!build) return;
    try { onBuildFailure({ build, pullRequest: pullRequestOf(next, build) }); } catch {}
  };

  const checkBuild = async (build: Build) => {
    try { await writeChecks(build.repository, build.branch, await github.readChecks(build.repository, build.sha)); } catch {}
  };
  const findPullRequest = async (build: Build) => {
    try {
      const found = await github.findPullRequest(build.repository, build.branch);
      if (found) await savePullRequest(found);
    } catch {}
  };

  const poll = async () => {
    if (stopped) return;
    const data = normalize(await session.read());
    const pending = data.builds.filter(watched(data));
    await Promise.all(pending.flatMap((build) => [
      ...(finished(build.checks) ? [] : [checkBuild(build)]),
      ...(pullRequestOf(data, build) ? [] : [findPullRequest(build)]),
    ]));
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
      const { branch, after: sha } = push;
      await write((data) => {
        const existing = data.builds.find((build) => onBranch(build, repository, branch));
        const build: Build = {
          repository, branch, sha, pushedAt: new Date(push.pushedAt).toISOString(), source: push.source,
          checks: existing?.sha === sha ? existing.checks : null,
        };
        return { ...data, builds: existing ? data.builds.map((item) => item === existing ? build : item) : [...data.builds, build] };
      });
      const [found, checks] = await Promise.allSettled([github.findPullRequest(repository, branch), github.readChecks(repository, sha)]);
      if (found.status === "fulfilled" && found.value) await savePullRequest(found.value);
      if (checks.status === "fulfilled") await writeChecks(repository, branch, checks.value);
    },
    async trackPullRequest(url) {
      const { repository, number } = parsePullRequestUrl(url);
      const initial: PullRequest = { repository, number, url, branch: null, title: null, state: null };
      await write((data) => data.pullRequests.some((pr) => pr.url === url) ? data : { ...data, pullRequests: [...data.pullRequests, initial] });
      let saved = url;
      try {
        const found = await github.viewPullRequest(url);
        await savePullRequest(found, url);
        saved = found.url;
      } catch {}
      return normalize(await session.read()).pullRequests.find((pr) => pr.url === saved) ?? initial;
    },
    async untrackPullRequest(url) {
      await write((data) => {
        const target = data.pullRequests.find((pr) => pr.url === url);
        if (!target) throw new Error(`PR not found in this session: ${url}`);
        return {
          builds: data.builds.filter((build) => !(target.branch && onBranch(build, target.repository, target.branch))),
          pullRequests: data.pullRequests.filter((pr) => pr !== target),
        };
      });
    },
    async refresh() {
      if (stopped) return;
      const data = normalize(await session.read());
      await Promise.all([
        ...data.pullRequests.map(async (pr) => {
          try { await savePullRequest(await github.viewPullRequest(pr.url), pr.url); } catch {}
        }),
        ...data.builds.map(async (build) => {
          if (!pullRequestOf(data, build)) await findPullRequest(build);
          await checkBuild(build);
        }),
      ]);
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
