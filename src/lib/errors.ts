/**
 * 애플리케이션 오류 계약.
 *
 * ## 🔴 Application 은 오류의 «의미»만 안다
 *
 * ```text
 * Application  ──AppError(reason · meta)──▶  경계  ──▶  사람이 읽는 문구 / 기계가 읽는 문구
 * ```
 *
 * 오류를 던지는 자리는 **무엇이 잘못됐는가**만 말한다(`PROJECT_SLUG_TAKEN`). 그것을
 * 무슨 말로 적을지는 경계가 정한다 — 사람이 보는 화면이면 그 사람의 언어로
 * (`lib/format/app-error.ts`), Agent API 면 언어와 무관한 고정 문구로(`toPublicError`).
 *
 * 🔴 **이 파일은 아무것도 import 하지 않는다.** 사전(`config/messages`)도, 쿠키도, React 도
 * 알지 못한다 — 알게 되는 순간 Application 이 화면의 말을 갖게 되고, 실제로 그랬을 때
 * EN 화면에 한국어가 그대로 떴다. 의존 방향은 **Presentation -> Application** 한쪽뿐이고,
 * 그 방향은 `src/lib/format/app-error.test.ts` 가 지킨다.
 *
 * ## 🔴 `code` 와 `reason` 은 다른 것이다
 *
 * | | 무엇 | 쓰이는 곳 |
 * |---|---|---|
 * | `code` | Transport 등급 — `NOT_FOUND` · `CONFLICT` | HTTP Status · 공개 Error Contract(CLAUDE.md 13) |
 * | `reason` | 그 오류가 «무슨» 오류인가 | 화면 문구를 고르는 열쇠 |
 *
 * 🔴 **reason 이 늘어도 Status 는 바뀌지 않는다.** reason 마다 code 를 한 번 적어 두고
 * (`REASON_CODE`) Status 는 언제나 code 가 정한다(`lib/api/error-response.ts`).
 *
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

/**
 * 오류의 «의미» ↔ Transport 등급.
 *
 * 🔴 **여기 없는 오류는 던질 수 없다.** 이름을 하나 더하면 두 사전(`config/messages/ko·en`)이
 * 곧바로 typecheck 로 깨진다 — 「문구가 빠진 오류」가 조용히 생기지 않는다.
 *
 * 🔴 **의미가 다르면 합치지 않는다.** 예를 들어 「마지막 OWNER 라 역할을 못 바꾼다」와
 * 「마지막 OWNER 라 계정을 못 지운다」는 사용자가 다음에 할 일이 다르다.
 * 반대로 **같은 말을 하는 자리는 한 이름으로 모은다** — 초대가 없다·만료됐다·이미 쓰였다는
 * 셋 다 `INVITATION_UNUSABLE` 이다. 🔴 구분해 주면 그것만으로 「그 Token 은 실재한다」가
 * 새어 나간다(CLAUDE.md 13).
 */
const REASON_CODE = {
  /**
   * 우리가 예상하지 못한 것. 불변식이 깨졌거나(넣었는데 돌아온 행이 없다) 원인을 모른다.
   * 🔴 사용자에게는 한 줄만 나가고 원인은 `cause` 로 서버 Log 에만 남는다.
   */
  UNEXPECTED: "INTERNAL_ERROR",
  /** 대상이 없다. 🔴 남의 것이어서 못 찾는 경우도 여기다 — `FORBIDDEN` 과 구분하지 않는다. */
  RESOURCE_NOT_FOUND: "NOT_FOUND",

  /**
   * Agent API 인증 실패.
   * 🔴 형식 오류·없는 키·폐기·만료를 구분하지 않는다(CLAUDE.md 12).
   */
  AGENT_UNAUTHORIZED: "UNAUTHORIZED",
  /** 🔴 Agent 가 읽는다. 본문이 JSON 이 아니면 500 이 아니라 400 이다. */
  AGENT_BODY_NOT_JSON: "VALIDATION_ERROR",
  /** PostgreSQL `text` 가 받지 못하는 문자(NUL · 짝 없는 Surrogate)가 본문에 들어 있다. */
  AGENT_BODY_UNSTORABLE_TEXT: "VALIDATION_ERROR",
  /**
   * `Idempotency-Key` 가 상한을 넘었다.
   * 🔴 **조용히 버리지 않는다** — 버리면 Agent 는 Dedup 이 걸린 줄 알고 재전송해
   * ReviewSession 을 하나 더 만든다(`lib/api/agent-route.ts`).
   */
  AGENT_IDEMPOTENCY_KEY_TOO_LONG: "VALIDATION_ERROR",

  API_KEY_NAME_INVALID: "VALIDATION_ERROR",

  /** 🔴 `slug` 가 문장에 들어간다 — 무엇을 고쳐야 하는지 알려면 그 값이 필요하다. */
  PROJECT_SLUG_RESERVED: "VALIDATION_ERROR",
  PROJECT_SLUG_TAKEN: "CONFLICT",
  /** 이름에서 유도한 slug 가 전부 막혔다 — slug 를 직접 정하면 된다. */
  PROJECT_NAME_TAKEN: "CONFLICT",
  PROJECT_NOT_FOUND: "NOT_FOUND",
  /** 🔴 「옮기려는 Project 가 없다」는 「옮길 Repository 가 없다」와 다른 말이다. */
  MOVE_TARGET_PROJECT_NOT_FOUND: "NOT_FOUND",
  REPOSITORY_NOT_FOUND: "NOT_FOUND",

  KNOWLEDGE_PAGE_SLUG_RESERVED: "VALIDATION_ERROR",
  KNOWLEDGE_PAGE_SLUG_TAKEN: "CONFLICT",
  KNOWLEDGE_PAGE_NOT_FOUND: "NOT_FOUND",

  /** 없다·만료됐다·이미 쓰였다를 구분하지 않는다. */
  INVITATION_UNUSABLE: "NOT_FOUND",
  INVITATION_NOT_CANCELABLE: "NOT_FOUND",
  INVITATION_ALREADY_PENDING: "CONFLICT",

  WORKSPACE_MEMBER_ALREADY: "CONFLICT",
  WORKSPACE_MEMBER_NOT_FOUND: "NOT_FOUND",
  WORKSPACE_NAME_REQUIRED: "VALIDATION_ERROR",
  /** 그 이름으로 쓸 수 있는 주소를 만들지 못했다. */
  WORKSPACE_NAME_UNUSABLE: "CONFLICT",
  /** 역할을 바꾸려는데 그 사람이 마지막 OWNER 다. */
  WORKSPACE_LAST_OWNER: "CONFLICT",
  PERSONAL_WORKSPACE_ROLE_FIXED: "CONFLICT",

  ACCOUNT_NOT_FOUND: "NOT_FOUND",
  /** 계정을 지우려는데 다른 멤버가 있는 Workspace 의 마지막 OWNER 다. */
  ACCOUNT_LAST_OWNER: "CONFLICT",
  /** 계정 삭제 중 Workspace 주소를 비우지 못했다 — 다시 시도하면 된다. */
  WORKSPACE_SLUG_RELEASE_FAILED: "CONFLICT",
} as const satisfies Record<string, ErrorCode>;

export type AppErrorReason = keyof typeof REASON_CODE;

/** 사전이 모든 오류를 덮는지 시험이 실제 목록으로 다시 확인한다. */
export const APP_ERROR_REASONS = Object.keys(REASON_CODE) as readonly AppErrorReason[];

export function errorCodeForReason(reason: AppErrorReason): ErrorCode {
  return REASON_CODE[reason];
}

/**
 * 문장에 끼워 넣어야 하는 값.
 *
 * 🔴 **문자열을 Application 에서 만들지 않는다.** 「'new' 는 쓸 수 없습니다」의 `'new'`
 * 만 여기 담고, 문장은 사전이 만든다 — 그러지 않으면 그 문장이 한 언어에 묶인다.
 *
 * 🔴 **Secret · Token · 내부 식별자를 담지 않는다**(CLAUDE.md 19). 여기 있는 것은
 * 지금까지도 사용자 화면에 그대로 떠 있던 값뿐이다.
 *
 * 값이 필요 없는 오류는 여기 **없다** — 없는 것이 곧 「meta 를 넘기면 타입 오류」다.
 */
export interface AppErrorMetaMap {
  PROJECT_SLUG_RESERVED: { slug: string };
  KNOWLEDGE_PAGE_SLUG_RESERVED: { slug: string };
}

export type AppErrorMeta = AppErrorMetaMap[keyof AppErrorMetaMap];

/**
 * 사전이 채워야 하는 자리.
 *
 * 🔴 **문구가 아니라 «문구를 내놓아야 한다는 요구»다.** 여기에는 한국어도 영어도 없다 —
 * 실제 낱말은 `config/messages/ko.ts` · `en.ts` 가 갖는다(`Record<ValidationRule, string>`
 * 과 같은 방식이다).
 *
 * 🔴 **오류를 하나 더하면 두 사전이 곧바로 typecheck 로 깨진다.** 「code 는 있는데 번역이
 * 없다」가 조용히 지나가지 않는다 — 값이 필요한 오류는 그 값을 받는 **함수**여야 하므로,
 * 문자열을 적어 두면 그것도 타입 오류다.
 */
export type AppErrorMessages = {
  [R in AppErrorReason]: R extends keyof AppErrorMetaMap
    ? (meta: AppErrorMetaMap[R]) => string
    : string;
};

/**
 * `new AppError(...)` 가 받는 것.
 *
 * 🔴 **값이 필요한 오류는 값 없이 만들 수 없고, 필요 없는 오류에는 값을 넘길 수 없다.**
 * 두 번째 자리는 언제나 객체라 **`new AppError("한국어 문구")` 는 컴파일되지 않는다** —
 * 옛 방식이 조용히 되살아날 자리를 타입이 막는다.
 */
export type AppErrorArgs<R extends AppErrorReason> = R extends keyof AppErrorMetaMap
  ? [reason: R, options: { meta: AppErrorMetaMap[R]; cause?: unknown }]
  : [reason: R, options?: { cause?: unknown }];

/**
 * 의도적으로 던지는 업무 오류.
 *
 * `cause` 에는 원인(DB 오류 등)을 붙여도 되지만 **밖으로 나가지 않는다.**
 * `Error.message` 는 사람이 읽는 문구가 아니라 **`reason` 그대로**다 — 서버 Log 와
 * Stack Trace 에 찍히는 자리라, 화면 문구를 넣으면 로그가 언어를 따라 흔들리고
 * meta 에 담긴 값이 로그로 새어 나간다.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly reason: AppErrorReason;
  readonly meta: AppErrorMeta | undefined;

  constructor(...args: AppErrorArgs<AppErrorReason>) {
    const [reason, options] = args as [
      AppErrorReason,
      { meta?: AppErrorMeta; cause?: unknown } | undefined,
    ];

    super(reason, { cause: options?.cause });
    this.name = "AppError";
    this.reason = reason;
    this.code = REASON_CODE[reason];
    this.meta = options?.meta;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * 🔴 **기계가 읽는 문구.** 화면 언어를 따르지 않는다.
 *
 * Agent API 는 사람이 아니라 Claude · Codex · Custom Agent 가 읽는 계약이다(CLAUDE.md 13).
 * 쿠키에 무엇이 들어 있든 응답은 같아야 하므로 **이 표는 언어를 인자로 받지 않는다** —
 * 받을 수 없게 만들어 두는 것이 「locale 이 API 를 바꾸지 않는다」의 실제 보증이다.
 */
const MACHINE_MESSAGE: Record<ErrorCode, string> = {
  VALIDATION_ERROR: "입력값이 올바르지 않습니다.",
  UNAUTHORIZED: "인증이 필요합니다.",
  FORBIDDEN: "권한이 없습니다.",
  NOT_FOUND: "대상을 찾을 수 없습니다.",
  CONFLICT: "이미 처리된 요청입니다.",
  INTERNAL_ERROR: "요청을 처리하지 못했습니다.",
};

/**
 * code 기본값보다 **정확히 말해야 Agent 가 자기 요청을 고칠 수 있는** 자리.
 *
 * 🔴 여기 있는 것은 Agent Transport 가 던지는 오류뿐이다. 화면에서 나는 오류의 문구를
 * 여기 적지 않는다 — 그것은 사전이 갖는다.
 */
const MACHINE_REASON_MESSAGE: Partial<Record<AppErrorReason, string>> = {
  AGENT_BODY_NOT_JSON: "요청 본문이 올바른 JSON 이 아니다.",
  AGENT_BODY_UNSTORABLE_TEXT:
    "요청 본문에 저장할 수 없는 문자가 들어 있다 (NUL · 짝 없는 Surrogate).",
  // 🔴 받은 값을 되돌려 담지 않는다. 길이 규칙만 알린다.
  AGENT_IDEMPOTENCY_KEY_TOO_LONG: "Idempotency-Key 는 200자를 넘을 수 없다.",
};

/**
 * 무엇이 던져졌든 **Agent API 로** 내보낼 수 있는 형태로 좁힌다.
 *
 * 🔴 알 수 없는 오류의 `message` 를 그대로 흘리지 않는다 — Driver 가 접속 문자열이나
 * 쿼리를 message 에 담아 던지는 경우가 있다.
 *
 * 🔴 **`AppError.message`(= reason) 도 그대로 내보내지 않는다.** 내부 이름이라 계약이
 * 아니고, 그것이 응답에 실리면 다음에 이름을 다듬는 순간 Agent 쪽이 깨진다.
 *
 * 화면에 그릴 문구가 필요하면 이 함수가 아니라 `lib/format/app-error.ts` 다.
 */
export function toPublicError(error: unknown): PublicError {
  if (!isAppError(error)) {
    return { code: "INTERNAL_ERROR", message: MACHINE_MESSAGE.INTERNAL_ERROR };
  }

  return {
    code: error.code,
    message: MACHINE_REASON_MESSAGE[error.reason] ?? MACHINE_MESSAGE[error.code],
  };
}

/** Agent API 가 code 만 알고 문구를 맡길 때. 🔴 화면에서 쓰지 않는다. */
export function machineMessage(code: ErrorCode): string {
  return MACHINE_MESSAGE[code];
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
  /*
    우리가 만든 것이라 그대로 남겨도 된다. 🔴 **`reason` 을 적고 `meta` 는 적지 않는다** —
    `reason` 은 우리가 고른 내부 이름이지만 `meta` 에는 사용자 값(`slug`)이 들어 있다.
    (`AppError.message` 도 `reason` 그대로다. 이 파일 위쪽 클래스 주석의 이유가 그것이다.)
  */
  if (isAppError(error)) {
    return `AppError(${error.code}): ${error.reason}`;
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
