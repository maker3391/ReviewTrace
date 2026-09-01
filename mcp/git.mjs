import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * 지금 작업 중인 Git Repository 를 스스로 알아낸다(스펙 7).
 *
 * ## 🔴 왜 사용자에게 Repository ID 를 묻지 않는가
 *
 * Claude Code 와 Codex 는 **이미 어느 저장소에서 도는지 안다.** 그런데 우리가 UUID 를
 * 요구하면 사용자는 매번 화면에 들어가 값을 복사해야 하고, Agent 는 그 값을 어딘가
 * 적어 둬야 한다 — 그 순간 「한 번 연결하면 끝」이 아니게 된다.
 *
 * 그래서 신원은 **git remote** 에서 나온다. `owner/name` 은 Agent 가 이미 아는 말이고,
 * 서버가 그것을 Workspace 안의 한 행으로 맞춘다(`repository-upsert.ts`).
 *
 * 🔴 **`git` 명령을 Shell 로 부르지 않는다.** `execFile` 이라 경로에 공백이나 따옴표가
 * 있어도 낱말이 갈라지지 않고, 인자가 명령으로 해석되지 않는다.
 */

/** Repository 하나를 읽는 데 허용하는 시간. git 이 멈춰 있어도 Tool 이 멈추지 않는다. */
const TIMEOUT_MS = 5_000;

export class GitError extends Error {}

export async function readRepositoryContext(cwd = process.cwd()) {
  const remote = await git(cwd, ["remote", "get-url", "origin"]);
  if (remote === null) {
    throw new GitError(
      "현재 디렉터리가 Git 저장소가 아니거나 origin remote 가 없다. " +
        "Repository 를 직접 지정하려면 repository 인자에 owner/name 을 넣어라.",
    );
  }

  const parsed = parseRemote(remote);
  if (parsed === null) {
    throw new GitError(
      "origin remote 에서 owner/name 을 읽지 못했다. " +
        "repository 인자에 owner/name 을 직접 넣어라.",
    );
  }

  const [commitSha, branch, defaultBranch, workspaceSlug] = await Promise.all([
    git(cwd, ["rev-parse", "HEAD"]),
    git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
    readDefaultBranch(cwd),
    git(cwd, ["config", "--local", "--get", "reviewtrace.workspace"]),
  ]);

  return {
    provider: parsed.provider,
    owner: parsed.owner,
    name: parsed.name,
    fullName: `${parsed.owner}/${parsed.name}`,
    htmlUrl: parsed.htmlUrl,
    defaultBranch: defaultBranch ?? "main",
    commitSha,
    // Detached HEAD 면 git 이 `HEAD` 를 준다 — 그것은 가지 이름이 아니다.
    branch: branch === "HEAD" ? null : branch,
    workspaceSlug,
  };
}

/**
 * `owner/name` 만 주어졌을 때의 최소 정보.
 *
 * git 을 못 읽는 자리(다른 저장소를 조회만 하는 경우)를 막지 않기 위해 둔다.
 */
export function repositoryFromFullName(fullName) {
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(fullName.trim());
  if (match === null) {
    throw new GitError("repository 는 owner/name 모양이어야 한다.");
  }
  return {
    provider: "GITHUB",
    owner: match[1],
    name: match[2],
    fullName: `${match[1]}/${match[2]}`,
    htmlUrl: null,
    defaultBranch: "main",
    commitSha: null,
    branch: null,
    workspaceSlug: null,
  };
}

/**
 * remote 주소에서 `owner/name` 을 읽는다.
 *
 * 🔴 GitHub 이 아닌 remote 는 **거절한다.** 지금 저장할 수 있는 Provider 가 GitHub 뿐이라
 * (`SCM_PROVIDERS`), GitLab 주소를 GitHub 인 척 저장하면 나중에 Evidence 확인이
 * 조용히 엉뚱한 곳을 본다.
 */
export function parseRemote(remote) {
  const url = remote.trim().replace(/\.git$/, "");

  // git@github.com:owner/name
  const scp = /^[^@]+@([^:]+):(.+)$/.exec(url);
  /**
   * 🔴 **host 를 소문자로 맞춘 뒤 비교한다.**
   *
   * DNS 는 대소문자를 가리지 않아 `git@GitHub.com:acme/app` 은 정상적인 origin 이다.
   * URL 형태는 `new URL()` 이 알아서 소문자로 만들지만 SCP 형태(`git@host:path`)는
   * 정규식이 적힌 그대로 잡아 낸다 — 맞추지 않으면 **멀쩡한 저장소가 거절된다.**
   */
  const host = (scp !== null ? scp[1] : hostOf(url))?.toLowerCase() ?? null;
  const pathPart = scp !== null ? scp[2] : pathOf(url);

  if (host === null || pathPart === null) {
    return null;
  }
  /**
   * 🔴 **정확히 `github.com` 만 받는다.**
   *
   * `endsWith("github.com")` 이면 `notgithub.com` 이 통과한다. 그런데 하위 도메인
   * (`ghe.github.com` 같은 GitHub Enterprise)을 받는 것도 **지금은 틀리다** —
   * 우리는 host 를 저장하지 않고, Evidence 확인은 서버 설정의 `GITHUB_API_URL`
   * (기본값 public GitHub)을 본다. 즉 Enterprise 저장소의 근거가 **public GitHub 의
   * 같은 이름 저장소**와 대조돼 `VERIFIED` 까지 될 수 있다.
   *
   * host 를 Repository 모델에 싣기 전까지는 받지 않는 것이 정직하다.
   */
  if (host !== "github.com") {
    return null;
  }

  const segments = pathPart.split("/").filter((s) => s !== "");
  if (segments.length < 2) {
    return null;
  }

  const owner = segments[segments.length - 2];
  const name = segments[segments.length - 1];

  return {
    provider: "GITHUB",
    owner,
    name,
    htmlUrl: `https://${host}/${owner}/${name}`,
  };
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

async function readDefaultBranch(cwd) {
  const ref = await git(cwd, [
    "symbolic-ref",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (ref === null) {
    return null;
  }
  // `origin/main` -> `main`
  const slash = ref.indexOf("/");
  return slash === -1 ? ref : ref.slice(slash + 1);
}

/** 실패는 `null` 이다 — git 이 없거나 저장소가 아닌 것은 오류가 아니라 사실이다. */
async function git(cwd, args) {
  try {
    const { stdout } = await run("git", args, {
      cwd,
      timeout: TIMEOUT_MS,
      windowsHide: true,
      encoding: "utf8",
    });
    const value = stdout.trim();
    return value === "" ? null : value;
  } catch {
    return null;
  }
}
