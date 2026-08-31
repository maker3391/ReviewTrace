import { z } from "zod";

import type { PublicError } from "@/lib/errors";

/**
 * Server Action 의 반환 계약.
 *
 * 🔴 Server Action 의 실패를 예외로 던지지 않는다. 프로덕션 빌드에서는 Server Action 의
 * 예외가 **메시지가 지워진 채** 클라이언트에 도착해, 화면이 「무슨 이유로」 실패했는지
 * 보여 줄 수 없다.
 *
 * Server Action 은 Transport 다 — 업무 판단은 Application Layer 가 하고,
 * 이 타입은 그 결과를 화면이 읽을 수 있는 형태로 옮기기만 한다.
 *
 * 🔴 **이 파일은 순수하다.** 실패를 «무슨 말로» 적을지는 화면 언어를 아는 자리
 * (`lib/action/action-error.ts`, 서버 전용)가 정한다 — 여기까지 쿠키가 따라오면
 * 이 타입을 `import type` 하는 Client Component 가 `next/headers` 를 끌고 간다.
 */
export type ActionResult<T = void> =
 | { ok: true; data: T }
 | { ok: false; error: PublicError; fieldErrors?: Record<string, string[]> };

export function actionOk(): ActionResult;
export function actionOk<T>(data: T): ActionResult<T>;
export function actionOk<T>(data?: T): ActionResult<T | undefined> {
 return { ok: true, data };
}

/**
 * Zod 검증 실패를 필드별 오류로 옮긴다.
 *
 * React Hook Form 은 필드 단위 오류를 그대로 붙일 수 있어야 한다.
 * 값이 아니라 **메시지만** 담는다 — 입력값을 되돌려 로그·상태에 남기지 않는다.
 *
 * 🔴 **`message` 에 기본값을 두지 않는다.** 기본값을 두면 그 자리에 한국어 한 줄이 박히고,
 * EN 화면이 그것을 그대로 그린다. 문구는 사전이 갖는 것이라 **부르는 쪽이 화면 언어로
 * 골라서** 넘긴다(`lib/action/parse-action-input.ts`).
 */
export function actionValidationFailed<T = never>(
 error: z.ZodError,
 message: string,
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
