import { unstable_rethrow } from "next/navigation";
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
 *
 * 🔴 **Next.js 의 흐름 제어는 예외로 온다. 그것까지 뭉개면 안 된다.**
 * `redirect()`·`notFound()` 는 값을 돌려주지 않고 특수 예외를 던져 라우터에게 다음 일을
 * 시킨다. Server Action 이 `try { requireUser() } catch { return actionFromError(e) }` 로
 * 감싸면 그 예외가 여기까지 와서 **`INTERNAL_ERROR` 한 줄로 바뀐다** — 화면은 이동하지도
 * 404 를 그리지도 못하고 「요청을 처리하지 못했습니다」만 띄운다. 로그인하지 않은 사람이
 * 초대를 수락할 때 실제로 그랬다.
 *
 * `unstable_rethrow` 는 그 내부 예외만 골라 다시 던진다(Next.js 16 `next/navigation`).
 * **부르는 자리마다 기억하게 두지 않고 여기 한 곳에 둔다** — Server Action 의 catch 는
 * 전부 이 함수를 지나므로, 새 Action 을 만드는 사람이 잊어도 같은 보증을 받는다.
 */
export function actionFromError<T = never>(error: unknown): ActionResult<T> {
  unstable_rethrow(error);
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
