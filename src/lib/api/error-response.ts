import {
  ERROR_CODES,
  machineMessage,
  toPublicError,
  type ErrorCode,
} from "@/lib/errors";

/**
 * Public Agent API 의 Error Contract.
 *
 * ```json
 * { "error": { "code": "VALIDATION_ERROR", "message": "Invalid review payload" } }
 * ```
 *
 * 🔴 **Stack Trace · SQL · Secret · 내부 경로를 내보내지 않는다**(스펙 39).
 * 밖으로 나가는 것은 안정적인 `code` 와 사람이 읽는 `message` 뿐이다.
 *
 * 이 파일은 순수 함수만 둔다 — Database 도 `server-only` 도 끌고 오지 않으므로
 * 테스트가 Route Handler 없이 형태를 검증할 수 있다.
 */

/** Error Code ↔ HTTP Status. 🔴 이 대응은 **한 곳**이다 — Route 마다 숫자를 적지 않는다. */
const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

/** 계약이 요구하는 Error Code 가 전부 Status 를 갖는지 테스트가 확인한다. */
export const API_ERROR_CODES = ERROR_CODES;

export function statusForErrorCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string };
}

/**
 * 오류 본문 하나.
 *
 * 기본 메시지 표를 여기서 다시 갖지 않는다 — `lib/errors.ts` 가 이미 갖고 있고,
 * 두 곳에 적으면 갈라진다.
 *
 * 🔴 **`message` 는 «기계가 읽는» 고정 문구다.** Route 가 「어느 자리가 틀렸는지」처럼
 * Agent 가 자기 요청을 고치는 데 필요한 말을 넘길 수 있다 — 화면 언어를 따르지 않는다.
 * 사람이 보는 문구는 이 길로 나가지 않는다(`lib/format/app-error.ts`).
 */
export function apiErrorBody(code: ErrorCode, message?: string): ApiErrorBody {
  return { error: { code, message: message ?? machineMessage(code) } };
}

/** 밖으로 나가는 오류 응답 하나. Route Handler 는 이것만 돌려준다. */
export function apiError(code: ErrorCode, message?: string): Response {
  return Response.json(apiErrorBody(code, message), {
    status: statusForErrorCode(code),
  });
}

/**
 * 무엇이 던져졌든 응답으로 좁힌다.
 *
 * 🔴 알 수 없는 오류의 `message` 를 흘리지 않는다 — Driver 가 접속 문자열이나 쿼리를
 * message 에 담아 던지는 경우가 있다. 그 판단은 `toPublicError` 한 곳이 한다.
 */
export function apiErrorFromUnknown(error: unknown): Response {
  const publicError = toPublicError(error);
  return Response.json(
    { error: publicError },
    { status: statusForErrorCode(publicError.code) },
  );
}
