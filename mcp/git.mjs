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
/** Evidence 대조로 읽는 파일 하나의 상한. 저장소를 통째로 메모리에 올리지 않는다. */
const MAX_FILE_BYTES = 4 * 1024 * 1024;
/**
 * 서버가 «받아들이는» 상한과 같은 값(`MAX_CHANGED_FILES_ACCEPTED`).
 *
 * 🔴 여기서 100 으로 줄이지 않는다. 줄이는 일은 서버가 하고, 서버는 얼마나 줄였는지를
 * 응답(`knowledgePreflight.changedFiles`)에 적어 보낸다 — 두 곳에서 각자 자르면
 * Agent 가 받는 숫자가 어느 단계의 것인지 알 수 없게 된다.
 */
const MAX_CHANGED_FILES = 1_000;
/**
 * 경로 목록 한 번을 담는 버퍼 상한.
 *
 * 🔴 **개수 상한보다 «먼저» 걸리면 안 된다.** 예전 값(1MB)은 경로 2만 개 언저리에서
 * 먼저 터졌고, 그때 결과는 「1000 개로 줄인 목록」이 아니라 **0 개**였다 —
 * `MAX_CHANGED_FILES` 하나로 자른다는 규칙이 조용히 두 개가 돼 있었다.
 * 크게 잡아 두어 실제로 자르는 자리가 개수 상한 한 곳으로 돌아온다.
 */
const MAX_PATH_BYTES = 16 * 1024 * 1024;

export class GitError extends Error {}

export async function readRepositoryContext(cwd = process.cwd(), options = {}) {
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

  /**
   * 🔴 **바뀐 파일 목록은 «필요한 곳에서만» 읽는다.**
   *
   * 이것만 git 을 두세 번 더 부른다. `create_review` 는 그 값이 있어야 Knowledge 후보를
   * 고르지만, `get_issue` 처럼 「지금 저장소가 어디인가」만 알면 되는 자리는 그렇지 않다 —
   * 후보마다 get_issue 를 부르는 흐름에서 그 차이가 프로세스 수십 개가 된다.
   */
  const [commitSha, branch, defaultBranch, workspaceSlug, changed] =
    await Promise.all([
      git(cwd, ["rev-parse", "HEAD"]),
      git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
      readDefaultBranch(cwd),
      git(cwd, ["config", "--local", "--get", "reviewtrace.workspace"]),
      options.includeChangedFiles === false
        ? // 묻지 않은 것도 「바뀐 파일이 없다」가 아니다 — 아래 flag 가 그것을 말한다.
          { paths: [], available: false }
        : readChangedFiles(cwd),
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
    changedFiles: changed.paths,
    /**
     * 🔴 **`changedFiles` 가 비어 있는 것을 「바뀐 파일이 없다」로 읽어도 되는가.**
     *
     * `false` 면 그 빈 목록은 사실이 아니라 **못 읽었거나 묻지 않은 것**이다.
     * 이 칸이 없으면 둘이 같은 값으로 접혀, 읽기 실패가 「깨끗한 working tree」로 둔갑한다.
     */
    changedFilesAvailable: changed.available,
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
    changedFiles: [],
    // 다른 저장소를 이름으로만 가리킨 것이라 working tree 를 «본 적이 없다».
    changedFilesAvailable: false,
  };
}

/**
 * Knowledge relevance에는 diff 내용이 아니라 경로만 필요하다.
 *
 * - working tree가 바뀌었으면 staged·unstaged·untracked 경로
 * - 깨끗하면 현재 HEAD commit이 바꾼 경로
 *
 * 파일명에는 줄바꿈도 들어갈 수 있어 `-z` 출력만 사용한다. merge commit 은 `git diff-tree`
 * 가 아무것도 내지 않으므로 빈 목록이 된다 — 실패가 아니라 알려진 한계다.
 *
 * ## 🔴 못 읽은 것을 「없다」로 돌려주지 않는다
 *
 * 돌려주는 것은 배열이 아니라 `{ paths, available }` 이다. `available: false` 는
 * **읽기가 중간에 끊겼다**는 뜻이고, 그때 `paths` 는 빈 배열이지만 그것은 사실이 아니다.
 *
 * 읽기가 끊긴 실행은 **HEAD commit 경로로 넘어가지 않는다.** 넘어가면 대개 그 조회는
 * 성공하므로, working tree 를 못 읽은 실행이 **직전 commit 의 파일 목록**을 working tree
 * 인 것처럼 돌려준다 — 없는 답을 다른 답으로 메우는 것이 빈손보다 나쁘다.
 *
 * `maxBytes` 는 시험이 실제 `maxBuffer` 초과를 일으키려고 낮춰 부르는 자리다.
 */
export async function readChangedFiles(cwd = process.cwd(), options = {}) {
  const maxBytes = options.maxBytes ?? MAX_PATH_BYTES;
  const [tracked, untracked] = await Promise.all([
    gitPaths(cwd, ["diff", "--name-only", "-z", "HEAD", "--"], maxBytes),
    gitPaths(
      cwd,
      ["ls-files", "--others", "--exclude-standard", "-z"],
      maxBytes,
    ),
  ]);
  if (!tracked.complete || !untracked.complete) {
    return unreadable("working tree");
  }

  const working = uniquePaths([...tracked.paths, ...untracked.paths]);
  if (working.length > 0) {
    return { paths: working.slice(0, MAX_CHANGED_FILES), available: true };
  }

  const committed = await gitPaths(
    cwd,
    [
      "diff-tree",
      "--root",
      "--no-commit-id",
      "--name-only",
      "-r",
      "-z",
      "HEAD",
      "--",
    ],
    maxBytes,
  );
  if (!committed.complete) {
    return unreadable("HEAD commit");
  }

  return {
    paths: uniquePaths(committed.paths).slice(0, MAX_CHANGED_FILES),
    available: true,
  };
}

/**
 * 🔴 **조용히 넘어가지 않는다.** stdout 은 MCP 통신 채널이라 한 줄만 섞여도 Client 가
 * 끊기므로 진단은 stderr 로만 간다. 경로 이름은 담지 않는다 — 못 읽었다는 사실만 적는다.
 */
function unreadable(what) {
  process.stderr.write(
    `[reviewtrace] ${what} 의 바뀐 파일 목록을 읽지 못했다. ` +
      "changedFiles 를 「없음」으로 보내지 않는다.\n",
  );
  return { paths: [], available: false };
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

/**
 * `{ paths, complete }` 를 돌려준다.
 *
 * `complete` 는 **git 이 끝까지 돌고 대답했는가**다. 실패했더라도 git 이 스스로
 * 종료코드를 냈으면(예: commit 이 하나도 없어 `diff HEAD` 가 `128`) 그것은 대답이므로
 * 빈 목록이 사실이다. 반대로 buffer 초과·timeout·git 실행 실패는 **대답이 아니다.**
 */
async function gitPaths(cwd, args, maxBytes = MAX_PATH_BYTES) {
  try {
    const { stdout } = await run("git", args, {
      cwd,
      timeout: TIMEOUT_MS,
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: maxBytes,
    });
    return { paths: parsePaths(stdout), complete: true };
  } catch (error) {
    return { paths: [], complete: gitAnswered(error) };
  }
}

/**
 * git 이 종료코드로 «대답한» 실패인가.
 *
 * - `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` — Node 가 출력 도중 자식을 죽였다. 대답이 아니다
 * - `killed === true` — timeout 으로 죽었다. 대답이 아니다
 * - `ENOENT`·`EACCES` — git 을 실행하지도 못했다. 대답이 아니다
 * - 숫자 code — git 이 돌고 그 값으로 끝났다. 대답이다
 */
function gitAnswered(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    error.killed !== true &&
    typeof error.code === "number"
  );
}

function parsePaths(stdout) {
  return stdout
    .split("\0")
    .map((value) => value.trim().replaceAll("\\", "/"))
    .filter(
      (value) =>
        value !== "" &&
        !value.startsWith("/") &&
        !value.split("/").includes(".."),
    );
}

function uniquePaths(paths) {
  return [...new Set(paths)].sort();
}

/**
 * 이 snapshot 이 **그 commit 에 실제로 있는가**를 로컬 git 으로 확인한다.
 *
 * ## 🔴 왜 client 가 판정하는가
 *
 * 서버는 `commitSha` 하나만 받는다 — 그것이 「이 코드가 있는 commit」인지 「이 작업의
 * 바탕 commit」인지 구분할 방법이 없다. 그런데 개발은 늘 **고친다 → 확인한다 → 커밋한다**
 * 순서라 AFTER 근거는 커밋 전에 만들어지고, 그때 Agent 가 적을 수 있는 SHA 는 HEAD 뿐이다.
 * 그러면 서버의 대조는 **없는 것을 못 찾아** 정직하게 `MISMATCH` 를 적는다 — 정상적인 개발
 * 흐름이 구조적으로 「코드 불일치」가 된다.
 *
 * **working tree 를 가진 쪽은 client 다.** 그래서 여기서 판정해 서버에 사실대로 말한다.
 *
 * ## 🔴 「모르겠다」를 「working tree 다」로 바꾸지 않는다
 *
 * | 확인한 것 | 돌려주는 값 | 뜻 |
 * |---|---|---|
 * | 그 commit 의 그 자리에 이 코드가 있다 | `"COMMITTED"` | 서버가 대조하면 맞는다 |
 * | 그 commit 에는 없고 **working tree 에는 있다** | `"WORKING_TREE"` | 아직 커밋 전이다 |
 * | 그 밖의 모든 경우 | `null` | 판정하지 않는다 — 서버가 대조하게 둔다 |
 *
 * 🔴 마지막 줄이 중요하다. git 을 못 읽었다·파일이 없다·둘 다에 없다 — 전부 `null` 이다.
 * 「확인 못 했으니 커밋 전이겠지」로 넘기면 **진짜 불일치가 조용히 숨는다.**
 *
 * 🔴 **서버와 «같은 규칙»으로 비교한다**(`code-evidence-service.ts` 의 `normalize`):
 * 줄바꿈과 줄 끝 공백만 맞추고 **들여쓰기는 건드리지 않는다.** 여기서만 느슨하게 비교하면
 * client 는 `COMMITTED` 라고 보내는데 서버는 `MISMATCH` 를 적는다.
 */
export async function classifyEvidenceSource(cwd, evidence) {
  const snapshot = evidence?.snapshot;
  if (typeof snapshot !== "string" || snapshot.trim() === "") return null;
  if (typeof evidence.commitSha !== "string" || evidence.commitSha === "")
    return null;
  if (typeof evidence.filePath !== "string" || evidence.filePath === "")
    return null;

  const wanted = normalizeCode(snapshot);
  if (wanted === "") return null;

  const atCommit = await readFileAtCommit(
    cwd,
    evidence.commitSha,
    evidence.filePath,
  );
  if (atCommit !== null && containsSnapshot(atCommit, wanted, evidence)) {
    return "COMMITTED";
  }
  /**
   * 🔴 **`readFileAtCommit` 의 `null` 은 두 가지 다른 사실이다.**
   *
   * - commit 자체를 읽지 못했다 — 다른 저장소의 SHA 이거나 없는 SHA 다
   * - commit 은 유효한데 **그 안에 그 경로가 없다** — 그 시점엔 없던 «새 파일»이다
   *
   * 둘을 같이 두면 새 파일을 만들며 고친 작업의 근거가 index·디스크를 보지도 못하고
   * 돌아가, `sourceState` 없이 나가 서버 기본값 `COMMITTED` 로 저장된다. 그 뒤
   * `verifyCodeEvidence` 가 GitHub 에서 그 경로를 찾지 못해 `UNAVAILABLE` 로 닫으므로,
   * 화면이 「아직 커밋 전」 대신 「확인할 수 없음」을 그린다.
   *
   * 🔴 **commit 을 읽지 못한 쪽의 `null` 은 그대로 둔다.** 다른 저장소의 근거를 건드리지
   * 않는 보증이 거기 있다.
   *
   * 🔴 **「commit 이 있다」가 아니라 「그것이 지금의 바탕이다」를 묻는다.** 오래된 ref 를
   * 받아 주면 이미 커밋된 파일까지 `WORKING_TREE` 가 되어 서버 대조를 건너뛴다.
   */
  if (atCommit === null && !(await isWorkingTreeBase(cwd, evidence.commitSha))) {
    return null;
  }

  /**
   * 🔴 **index 와 작업 파일을 «따로» 본다.**
   *
   * 예전에는 둘을 한 문자열로 이어 붙여 넘겼다. 그것은 파일 전체 `includes` 로만
   * 성립하는 모양이라, 줄 범위를 그대로 적용하면 앞쪽 판본의 길이만큼 뒤쪽 판본의
   * 줄 번호가 밀려 어느 쪽으로도 맞지 않는다. 각각을 «그 자체로 온전한 파일»로 본다.
   */
  const candidates = await readUncommittedFiles(cwd, evidence.filePath);
  if (candidates.length === 0) return null;
  return candidates.some((text) => containsSnapshot(text, wanted, evidence))
    ? "WORKING_TREE"
    : null;
}

/**
 * 줄 범위가 있으면 그 줄과 같은지, 없으면 파일 안에 들어 있는지 — 서버와 같은 질문이다.
 *
 * 🔴 **줄 범위가 있으면 거기서 판정이 끝난다. 파일 전체 `includes` 로 흘러내리지 않는다.**
 * 흘러내리면 조각이 «다른 줄»에 있다는 이유로 `COMMITTED` 가 붙는데, 서버
 * (`decideVerification`)는 그 줄만 읽어 `found === wanted` 로 대조하므로 같은 근거가
 * `MISMATCH` 로 남는다 — 화면은 그것을 「Agent 가 없는 코드를 적었다」로 그린다.
 * **client 가 보증한 것을 server 가 뒤집는 구조를 만들지 않는다.**
 */
function containsSnapshot(fileText, wanted, evidence) {
  const normalized = normalizeCode(fileText);
  if (
    typeof evidence.startLine === "number" &&
    typeof evidence.endLine === "number"
  ) {
    const lines = normalized.split("\n");
    const slice = normalizeCode(
      lines.slice(evidence.startLine - 1, evidence.endLine).join("\n"),
    );
    return slice === wanted;
  }
  return normalized.includes(wanted);
}

/** 🔴 `code-evidence-service.ts` 의 `normalize` 와 같은 규칙이다. 갈라지면 판정이 어긋난다. */
function normalizeCode(text) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\s+$/, "");
}

/**
 * 그 값이 **지금 작업 tree 가 얹혀 있는 그 commit** 인가.
 *
 * 🔴 **「이 저장소의 commit 인가」로는 부족하다.** `rev-parse` 는 full SHA 뿐 아니라
 * short SHA · tag · branch · `HEAD~2` 같은 revision expression 을 전부 받는다. 그래서
 * 「commit 으로 풀리는가」만 물으면 **오래된 ref 를 준 것만으로 이미 커밋된 파일이
 * `WORKING_TREE` 가 되어** 서버의 원본 대조를 통째로 건너뛴다 — 검증 면제 스위치다.
 *
 * `WORKING_TREE` 는 「그 commit 에는 없고 지금 작업 tree 에 있다」는 뜻이고, 여기서
 * 「그 commit」은 **작업의 바탕**이다. 바탕은 언제나 현재 `HEAD` 이므로 둘을 full OID
 * 로 풀어 같은지 본다 — 철자가 아니라 «가리키는 commit» 을 비교한다.
 *
 * `^{commit}` 을 붙여 tag·tree 가 아니라 commit 으로만 풀리게 한다.
 */
async function resolveCommit(cwd, revision) {
  try {
    const { stdout } = await run(
      "git",
      ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`],
      { cwd, timeout: TIMEOUT_MS },
    );
    const oid = stdout.trim();
    return oid === "" ? null : oid;
  } catch {
    return null;
  }
}

async function isWorkingTreeBase(cwd, commitSha) {
  const [supplied, head] = await Promise.all([
    resolveCommit(cwd, commitSha),
    resolveCommit(cwd, "HEAD"),
  ]);
  return supplied !== null && head !== null && supplied === head;
}

async function readFileAtCommit(cwd, commitSha, filePath) {
  try {
    const { stdout } = await run(
      "git",
      ["show", `${commitSha}:${filePath}`],
      { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_FILE_BYTES },
    );
    return stdout;
  } catch {
    return null;
  }
}

/**
 * 아직 커밋되지 않은 판본들. index 에 올라간 것과 디스크의 것을 **각각** 돌려준다.
 *
 * 🔴 **이어 붙이지 않는다.** 줄 번호는 «한 파일 안»에서만 뜻을 가지므로, 두 판본을
 * 합치면 뒤쪽 판본의 줄 번호가 앞쪽 길이만큼 밀려 어느 쪽으로도 맞지 않는다.
 */
async function readUncommittedFiles(cwd, filePath) {
  const texts = [];
  // 🔴 저장소 밖을 읽지 않는다 — git 이 아는 경로만 본다.
  try {
    const { stdout } = await run("git", ["show", `:0:${filePath}`], {
      cwd,
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_FILE_BYTES,
    });
    // index 에 올라간 내용이 있으면 그것도 「아직 커밋 전」이다.
    texts.push(stdout);
  } catch {
    // index 에 없는 파일이다. 디스크의 것만 본다.
  }

  const onDisk = await readOnDisk(cwd, filePath);
  if (onDisk !== null) texts.push(onDisk);
  return texts;
}

async function readOnDisk(cwd, filePath) {
  try {
    const { readFile } = await import("node:fs/promises");
    const { resolve, relative, isAbsolute } = await import("node:path");
    const full = resolve(cwd, filePath);
    // 🔴 `..` 로 저장소 밖을 가리키는 경로를 읽지 않는다.
    const inside = relative(resolve(cwd), full);
    if (inside.startsWith("..") || isAbsolute(inside)) return null;
    const text = await readFile(full, "utf8");
    return text.length > MAX_FILE_BYTES ? null : text;
  } catch {
    return null;
  }
}
