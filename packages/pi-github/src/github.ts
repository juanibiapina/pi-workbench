import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type PullRequestState = "open" | "closed" | "merged";
export type CheckState = "pending" | "success" | "failure" | "skipped";

export interface PullRequest {
  number: number;
  url: string;
  title: string | null;
  state: PullRequestState | null;
}

export interface PullRequestView {
  repository: string;
  branch: string;
  headSha: string;
  pullRequest: PullRequest;
}

export interface Checks {
  sha: string;
  state: "pending" | "success" | "failure" | "none";
  updatedAt: string;
  runs: Array<{ name: string; state: CheckState; url: string }>;
}

export interface GitHub {
  findPullRequest(repository: string, branch: string): Promise<PullRequestView | null>;
  viewPullRequest(url: string): Promise<PullRequestView>;
  readChecks(repository: string, sha: string): Promise<Checks>;
}

export function parsePullRequestUrl(url: string): { repository: string; number: number } {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)\/pull\/([1-9][0-9]*)$/.exec(url);
  if (!match) throw new Error(`Invalid GitHub PR URL: ${url}`);
  return { repository: match[1]!, number: Number(match[2]) };
}

export function parseRemoteUrl(url: string): string | null {
  const match = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]+\/[A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match ? match[1]! : null;
}

export function summarize(sha: string, runs: Checks["runs"], updatedAt: string): Checks {
  const state = runs.some((run) => run.state === "failure") ? "failure"
    : runs.some((run) => run.state === "pending") ? "pending"
    : runs.length ? "success" : "none";
  return { sha, state, updatedAt, runs };
}

type GhPullRequest = { number: number; url: string; title: string; state: string; headRefName: string; headRefOid: string };
const fields = "number,url,title,state,headRefName,headRefOid";

function view(repository: string, item: GhPullRequest): PullRequestView {
  return {
    repository, branch: item.headRefName, headSha: item.headRefOid,
    pullRequest: { number: item.number, url: item.url, title: item.title, state: item.state.toLowerCase() as PullRequestState },
  };
}

function runState(status: string, conclusion: string | null): CheckState {
  if (status !== "completed") return "pending";
  if (conclusion === "success" || conclusion === "neutral") return "success";
  if (conclusion === "skipped") return "skipped";
  return "failure";
}

export function createGhAdapter(pi: ExtensionAPI): GitHub {
  const gh = async (args: string[]): Promise<unknown> => {
    const result = await pi.exec("gh", args, { timeout: 30_000 });
    if (result.code !== 0) throw new Error(result.stderr.trim() || `gh ${args[0]} failed`);
    return JSON.parse(result.stdout);
  };
  return {
    async findPullRequest(repository, branch) {
      const items = await gh(["pr", "list", "--repo", repository, "--head", branch, "--state", "all", "--json", fields, "--limit", "1"]) as GhPullRequest[];
      return items[0] ? view(repository, items[0]) : null;
    },
    async viewPullRequest(url) {
      const { repository } = parsePullRequestUrl(url);
      return view(repository, await gh(["pr", "view", url, "--json", fields]) as GhPullRequest);
    },
    async readChecks(repository, sha) {
      const [checkRuns, status] = await Promise.all([
        gh(["api", `repos/${repository}/commits/${sha}/check-runs?per_page=100`]) as Promise<{ check_runs: Array<{ name: string; status: string; conclusion: string | null; html_url: string }> }>,
        gh(["api", `repos/${repository}/commits/${sha}/status`]) as Promise<{ statuses: Array<{ context: string; state: string; target_url: string | null }> }>,
      ]);
      const runs: Checks["runs"] = [
        ...checkRuns.check_runs.map((run) => ({ name: run.name, state: runState(run.status, run.conclusion), url: run.html_url })),
        ...status.statuses.map((item) => ({
          name: item.context, url: item.target_url ?? "",
          state: (item.state === "success" ? "success" : item.state === "pending" ? "pending" : "failure") as CheckState,
        })),
      ];
      return summarize(sha, runs, new Date().toISOString());
    },
  };
}
