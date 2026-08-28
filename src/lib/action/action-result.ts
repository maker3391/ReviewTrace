import { z } from "zod";

import { AppError, toPublicError, type ErrorCode, type PublicError } from "@/lib/errors";

/**
 * Server Action 의 반환 계약.
 *
 * 🔴 Server Action 의 실패를 예외로 던지지 않는다. 프로덕션 빌드에서는 Server Action 의
 * 예외가 **메시지가 지워진 채** 클라이언트에 도착해, 화면이 「무슨 이유로」 실패했는지
 * 보여 줄 수 없다(CLAUDE.md 8).
 *
 * Server Action 은 Transport 다 — 업무 판단은 Application Layer 가 하고,
 * 이 타입은 그 결과를 화면이 읽을 수 있는 형태로 옮기기만 한다.
 */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: PublicError; fieldErrors?: Record<string, string[]> };

export function actionOk(): ActionResult;
export function actionOk<T>(data: T): ActionResult<T>;
export function actionOk<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data };
}

export function actionFail<T = never>(
  code: ErrorCode,
  message?: string,
): ActionResult<T> {
  return { ok: false, error: toPublicError(new AppError(code, message)) };
}

/**
 * 던져진 오류를 ActionResult 로 옮긴다.
 *
 * 알 수 없는 오류는 `INTERNAL_ERROR` 로 뭉개진다 — 원본 message 를 화면에 흘리지 않는다.
 */
export function actionFromError<T = never>(error: unknown): ActionResult<T> {
  return { ok: false, error: toPublicError(error) };
}

/**
 * Zod 검증 실패를 필드별 오류로 옮긴다.
 *
 * React Hook Form 은 필드 단위 오류를 그대로 붙일 수 있어야 한다.
 * 값이 아니라 **메시지만** 담는다 — 입력값을 되돌려 로그·상태에 남기지 않는다.
 */
export function actionValidationFailed<T = never>(
  error: z.ZodError,
  message = "입력값이 올바르지 않습니다.",
): ActionResult<T> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    // 중첩 필드는 `parent.child` 로 평탄화한다 — RHF 가 그 이름으로 오류를 붙인다.
    const field = issue.path.map(String).join(".");
    if (field === "") {
      continue;
    }
    const messages = fieldErrors[field];
    if (messages === undefined) {
      fieldErrors[field] = [issue.message];
    } else {
      messages.push(issue.message);
    }
  }

  return {
    ok: false,
    error: { code: "VALIDATION_ERROR", message },
    fieldErrors,
  };
}
