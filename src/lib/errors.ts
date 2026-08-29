/**
 * 애플리케이션 오류 계약.
 *
 * 사용자·Agent 에게 나가는 것은 안정적인 `code` 와 사람이 읽는 `message` 뿐이다.
 * Stack Trace · SQL · Database Error · Secret · 내부 경로는 절대 밖으로 내보내지 않는다(CLAUDE.md 19).
 */

export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** 외부(화면·API)로 나가도 되는 오류 표현. 이 형태 밖의 것을 내보내지 않는다. */
export interface PublicError {
  code: ErrorCode;
  message: string;
}

const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  VALIDATION_ERROR: "입력값이 올바르지 않습니다.",
  UNAUTHORIZED: "인증이 필요합니다.",
  FORBIDDEN: "권한이 없습니다.",
  NOT_FOUND: "대상을 찾을 수 없습니다.",
  CONFLICT: "이미 처리된 요청입니다.",
  INTERNAL_ERROR: "요청을 처리하지 못했습니다.",
};

/**
 * 의도적으로 던지는 업무 오류.
 *
 * `cause` 에는 원인(DB 오류 등)을 붙여도 되지만 **밖으로 나가지 않는다** —
 * `toPublicError` 가 `code`/`message` 만 추린다.
 */
export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? DEFAULT_MESSAGE[code], options);
    this.name = "AppError";
    this.code = code;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * 무엇이 던져졌든 밖으로 내보낼 수 있는 형태로 좁힌다.
 *
 * 🔴 알 수 없는 오류의 `message` 를 그대로 흘리지 않는다 — Driver 가 접속 문자열이나
 * 쿼리를 message 에 담아 던지는 경우가 있다.
 */
export function toPublicError(error: unknown): PublicError {
  if (isAppError(error)) {
    return { code: error.code, message: error.message };
  }

  return {
    code: "INTERNAL_ERROR",
    message: DEFAULT_MESSAGE.INTERNAL_ERROR,
  };
}

/**
 * 로그에 남겨도 되는 형태로 오류를 좁힌다.
 *
 * 🔴 **`console.error(..., error)` 로 오류 객체를 그대로 넘기면 바인딩된 값이 로그에 남는다.**
 * Drizzle 은 질의 실패를 `DrizzleQueryError` 로 감싸면서 `message` 에
 * `params: <바인딩된 값 전부>` 를 붙인다(`drizzle-orm/errors.js` 의 생성자).
 * 그 값에는 **API Key 의 SHA-256 Hash** 와 **Agent 가 보낸 Payload 원문**이 들어 있다.
 *
 * `api-key-token.ts` 는 **「원문·Hash 를 Log·응답·오류 메시지에 담지 않는다」**고 못 박아 뒀는데,
 * 인증 조회(`where key_hash = $1`)가 접속 끊김·timeout 으로 실패하는 순간 그 Hash 가
 * 그대로 로그로 나갔다.
 *
 * 그래서 **값이 실릴 수 있는 자리를 통째로 버린다** — 남기는 것은
 * 오류 종류 · SQL 의 «틀»(값은 `$1` 자리표시자로만 있다) · SQLSTATE 다.
 * 이 셋이면 무엇이 왜 실패했는지 좇을 수 있고, 사용자 값은 하나도 남지 않는다.
 *
 * 🔴 **`params` 를 「가려서」 남기지 않는다.** 어느 칸이 비밀인지 이 함수는 알 수 없다.
 */
const LOG_QUERY_MAX = 200;
const LOG_CAUSE_MAX_DEPTH = 5;

function hasBoundParams(value: object): boolean {
  return Array.isArray((value as { params?: unknown }).params);
}

export function describeErrorForLog(error: unknown): string {
  // 우리가 만든 메시지라 그대로 남겨도 된다.
  if (isAppError(error)) {
    return `AppError(${error.code}): ${error.message}`;
  }

  if (typeof error !== "object" || error === null) {
    return `non-error thrown: ${typeof error}`;
  }

  const parts: string[] = [];
  const name = (error as { name?: unknown }).name;
  parts.push(typeof name === "string" && name !== "" ? name : "Error");

  if (hasBoundParams(error)) {
    // 🔴 `message` 를 쓰지 않는다 — 거기에 params 가 붙어 있다.
    const query = (error as { query?: unknown }).query;
    if (typeof query === "string") {
      parts.push(`query=${query.slice(0, LOG_QUERY_MAX)}`);
    }
    parts.push("params=[redacted]");
  } else {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") {
      parts.push(message);
    }
  }

  // SQLSTATE 는 값이 아니라 분류라 남긴다. 감싸인 안쪽까지 따라간다.
  let current: unknown = error;
  for (let depth = 0; depth <= LOG_CAUSE_MAX_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null) {
      break;
    }
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && code !== "") {
      parts.push(`sqlstate=${code}`);
      break;
    }
    if (!("cause" in current)) {
      break;
    }
    const next = (current as { cause?: unknown }).cause;
    if (next === current) {
      break;
    }
    current = next;
  }

  return parts.join(" | ");
}
