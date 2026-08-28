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
