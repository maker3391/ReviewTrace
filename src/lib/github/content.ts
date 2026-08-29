import "server-only";

import { githubEnv } from "@/lib/env";

/**
 * GitHub 에서 **한 Commit 시점의 파일 줄 범위**를 읽는다(스펙 15).
 *
 * 🔴 **Integration Boundary 다**(CLAUDE.md 15). Core Domain 이 GitHub API 모델에
 * 종속되지 않도록, 밖으로 나가는 것은 「글자 또는 못 읽은 이유」뿐이다.
 *
 * 🔴 **Repository 전체를 복제하지 않는다.** 받는 것은 파일 하나이고 돌려주는 것은
 * Issue 가 가리키는 줄 범위뿐이다.
 *
 * 🔴 **실패를 던지지 않는다.** Evidence 확인은 부가 기능이다 — GitHub 이 죽었다고
 * Review 기록이 거절되면 Agent 는 자기가 무엇을 잘못했는지 알 수 없다.
 */

/** 못 읽은 이유. 화면·Agent 에게는 이 낱말만 나간다 — 응답 본문을 그대로 흘리지 않는다. */
export type GithubReadFailure =
  | "NOT_CONFIGURED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "TOO_LARGE"
  | "OUT_OF_RANGE"
  | "PRIVATE"
  | "UNREACHABLE";

export type GithubReadResult =
  | {
      ok: true;
      text: string;
      /**
       * 줄 범위 없이 파일 전체를 읽어 온 것인가.
       *
       * 🔴 **비교 방법이 달라진다.** 줄 범위가 있으면 「그 줄이 이것과 같은가」이고,
       * 없으면 「이 파일 안에 이 조각이 있는가」다. 이 값을 안 들고 다니면 부르는 쪽이
       * 조각과 파일 전체를 맞대 보고 **언제나 다르다고 판정한다.**
       */
      whole: boolean;
    }
  | { ok: false; reason: GithubReadFailure };

/**
 * 한 번의 확인에 허용하는 시간.
 *
 * Evidence 확인은 요청을 **붙잡아 두면 안 되는** 일이다. GitHub 이 느리면 확인을
 * 포기하고 `UNVERIFIED` 로 남기는 편이, Agent 를 기다리게 하는 것보다 낫다.
 */
const TIMEOUT_MS = 4_000;

/** 파일 하나의 상한. 이보다 크면 줄 범위를 잘라 내기 전에 포기한다. */
const MAX_FILE_BYTES = 1_000_000;

/**
 * 이 저장소가 **공개**인가.
 *
 * ## 🔴 왜 이 확인이 필요한가 — 이것이 없으면 Tenant 경계가 뚫린다
 *
 * `GITHUB_API_TOKEN` 은 **서버 하나가 들고 있는 값**이다. Repository 는 Agent 가 보낸
 * `owner/name` 으로 만들어질 뿐, 그 저장소를 정말 소유하는지 우리가 확인하지 않는다.
 * 그래서 이 확인이 없으면:
 *
 * ```
 * Workspace A 의 API Key
 *   -> repository = { owner: "남의회사", name: "private" }   (아무나 적을 수 있다)
 *   -> evidence = { commitSha, filePath, snapshot: null }
 *   -> 서버가 **전역 Token 으로** 그 private 파일을 읽어 snapshot 에 저장
 *   -> GET /issues/{id} 가 A 에게 그 코드를 돌려준다
 * ```
 *
 * 저장소를 Workspace 에 등록했다는 사실은 **GitHub 접근 권한의 근거가 아니다**
 * (CLAUDE.md 11 · 19). 그래서 읽기 전에 공개 여부를 먼저 묻고, private 이면 보지 않는다.
 * private 저장소의 Evidence 는 Agent 가 보낸 snapshot 그대로 `UNAVAILABLE` 로 남는다 —
 * 확인하지 못한 것을 확인한 것처럼 적지 않는다.
 */
export async function isPublicRepository(
  owner: string,
  name: string,
): Promise<boolean> {
  const env = githubEnv();
  const url =
    `${env.GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

  try {
    const response = await fetch(url, {
      headers: apiHeaders("application/vnd.github+json"),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) {
      return false;
    }

    const body: unknown = await response.json();
    // 🔴 `!== true` 가 아니라 `=== false` 다. 필드가 없으면 공개라고 단정하지 않는다.
    return (
      typeof body === "object" &&
      body !== null &&
      (body as { private?: unknown }).private === false
    );
  } catch {
    return false;
  }
}

export interface GithubFileRef {
  owner: string;
  name: string;
  commitSha: string;
  filePath: string;
}

/**
 * 파일을 읽어 줄 범위를 잘라 돌려준다.
 *
 * 🔴 **줄 번호가 없으면 잘라 낼 것이 없다.** 그때는 파일 전체를 `whole: true` 와 함께
 * 돌려준다 — 부르는 쪽이 「같은가」가 아니라 「들어 있는가」로 판정해야 하기 때문이다.
 * 이것을 알리지 않으면 조각과 파일 전체를 맞대 보고 **언제나 다르다고 판정한다.**
 */
export async function readGithubLines(
  ref: GithubFileRef,
  lines: { startLine: number | null; endLine: number | null },
): Promise<GithubReadResult> {
  const file = await readGithubFile(ref);
  if (!file.ok) {
    return file;
  }

  if (lines.startLine === null) {
    return { ok: true, text: file.text, whole: true };
  }

  /**
   * 🔴 파일 밖을 가리키는 줄 범위를 **성공으로 돌려주지 않는다.**
   *
   * 10줄짜리 파일에 `startLine: 100` 을 보내면 그 자리에 아무것도 없다. 그것을 성공으로
   * 넘기면 **존재하지 않는 코드 위치가 `VERIFIED` 로 적힌다** — 화면은 「GitHub 에서
   * 확인했다」고 말하는데 그 자리에는 아무것도 없다.
   *
   * 🔴 **잘라 낸 글자가 비었는지로 재지 않는다.** 파일에 **실제로 있는 빈 줄**도 잘라
   * 내면 빈 문자열이라, 그렇게 재면 멀쩡한 근거가 「범위 밖」으로 찍힌다.
   * 경계는 글자가 아니라 **줄 수**로 잰다.
   */
  const lineCount = file.text.split("\n").length;
  if (lines.startLine > lineCount) {
    return { ok: false, reason: "OUT_OF_RANGE" };
  }

  return {
    ok: true,
    text: sliceLines(file.text, lines.startLine, lines.endLine),
    whole: false,
  };
}

/** 줄 범위를 자른다. 범위를 벗어나면 있는 만큼만 — 없는 줄을 지어내지 않는다. */
export function sliceLines(
  text: string,
  startLine: number | null,
  endLine: number | null,
): string {
  if (startLine === null) {
    return text;
  }

  const all = text.split("\n");
  const from = Math.max(0, startLine - 1);
  const to = endLine === null ? startLine : endLine;

  return all.slice(from, Math.max(from, to)).join("\n");
}

/** 파일 하나를 통째로 읽는다. 자르는 일은 부르는 쪽이 한다. */
type FileRead = { ok: true; text: string } | { ok: false; reason: GithubReadFailure };

async function readGithubFile(ref: GithubFileRef): Promise<FileRead> {
  const env = githubEnv();

  const path = encodeGithubPath(ref.filePath);
  if (path === null) {
    // 가리킨 자리와 확인할 자리가 달라지는 경로다 — 보지 않는다.
    return { ok: false, reason: "NOT_FOUND" };
  }

  // Contents API 는 Private 저장소에 대해 Token 이 없으면 404 를 준다 —
  // 「없다」와 「못 본다」를 GitHub 이 이미 합쳐 주므로 존재 여부가 새지 않는다.
  const url =
    `${env.GITHUB_API_URL}/repos/${encodeURIComponent(ref.owner)}/` +
    `${encodeURIComponent(ref.name)}/contents/${path}` +
    `?ref=${encodeURIComponent(ref.commitSha)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: apiHeaders("application/vnd.github.raw+json"),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    // 🔴 원인을 밖으로 흘리지 않는다 — 주소·Token 이 message 에 섞여 나올 수 있다.
    return { ok: false, reason: "UNREACHABLE" };
  }

  if (response.status === 404) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (response.status === 403 || response.status === 429) {
    // GitHub 은 한도 초과도 403 으로 준다. 남은 횟수로 둘을 가른다.
    const remaining = response.headers.get("x-ratelimit-remaining");
    return {
      ok: false,
      reason: remaining === "0" ? "RATE_LIMITED" : "FORBIDDEN",
    };
  }
  if (!response.ok) {
    return { ok: false, reason: "UNREACHABLE" };
  }

  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_FILE_BYTES) {
    return { ok: false, reason: "TOO_LARGE" };
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    return { ok: false, reason: "UNREACHABLE" };
  }

  if (text.length > MAX_FILE_BYTES) {
    return { ok: false, reason: "TOO_LARGE" };
  }

  return { ok: true, text };
}

/** 🔴 Token 은 헤더에만 담는다. URL·로그·오류 message 어디에도 넣지 않는다. */
function apiHeaders(accept: string): Record<string, string> {
  const env = githubEnv();
  const headers: Record<string, string> = {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ReviewTrace",
  };

  if (env.GITHUB_API_TOKEN !== undefined) {
    headers.Authorization = `Bearer ${env.GITHUB_API_TOKEN}`;
  }

  return headers;
}

/**
 * 경로를 Segment 단위로 인코딩한다. 정규 경로가 아니면 `null` 이다.
 *
 * 🔴 `encodeURIComponent(path)` 를 통째로 걸면 `/` 까지 `%2F` 가 돼 경로가 아니게 된다.
 *
 * 🔴 **`.` · `..` 를 조용히 걷어내지 않는다.** 걷어내면 `a/../b.ts` 를 보낸 근거가
 * GitHub 의 `a/b.ts` 와 맞대어져 `VERIFIED` 가 되는데 **저장된 경로는 여전히
 * `a/../b.ts`** 다 — 화면이 가리키는 자리와 확인한 자리가 다르다. 그런 경로는
 * 인코딩할 것이 아니라 **확인하지 못한 것**이다.
 */
export function encodeGithubPath(filePath: string): string | null {
  const segments = filePath.split("/");

  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    return null;
  }

  return segments.map(encodeURIComponent).join("/");
}
