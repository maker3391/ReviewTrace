import "server-only";

import { z } from "zod";

import { apiError, apiErrorFromUnknown } from "@/lib/api/error-response";
import { AppError, describeErrorForLog, isAppError } from "@/lib/errors";
import { hasUnstorableText } from "@/lib/validation/db-text";

/**
 * Agent API Route Handler 의 공통 처리.
 *
 * 🔴 **Route Handler 는 Transport Boundary 다**. 여기 있는 것은 HTTP 를
 * 다루는 일뿐이다 — 인증·Parsing·오류 변환. 업무 판단은 Application Service 가 한다.
 *
 * 「의미 없는 BaseService」를 만들지 않는다(스펙 36) — 이 파일에 있는 것은 네 Route 가
 * **똑같이 틀리기 쉬운 자리**(오류를 그대로 흘리는 것)를 한 곳으로 모은 것뿐이다.
 */

/** Idempotency-Key 헤더 이름. 값의 뜻은 `review-ingest-service.ts` 가 정한다. */
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

const IDEMPOTENCY_KEY_MAX = 200;

/**
 * 재전송 판별에 쓸 열쇠를 읽는다. 헤더가 없으면 `null` — Dedup 을 요청하지 않은 것이다.
 *
 * 🔴 **상한을 넘은 열쇠를 «조용히 버리지» 않는다.** 예전에는 `null` 을 돌려줘, Agent 는
 * 열쇠를 보냈다고 믿는데 서버는 Dedup 없이 저장했다 — 그 상태로 재전송하면
 * **ReviewSession 이 하나 더 생긴다.** 오류도 경고도 없어 중복이 쌓이는 것을 알 수 없다.
 * 재시도를 자동으로 하는 Agent 일수록 조용히 늘어난다.
 *
 * 그래서 `400` 으로 거절한다. 깨진 JSON 을 `readJsonBody` 가 거절하는 이유와 같다 —
 * **Agent 가 자기 입력을 고칠 수 있어야 한다.** 조용히 무시하면 고칠 기회가 없다.
 *
 * @throws AppError `VALIDATION_ERROR`
 */
export function readIdempotencyKey(request: Request): string | null {
 const raw = request.headers.get(IDEMPOTENCY_KEY_HEADER)?.trim() ?? "";
 if (raw === "") {
 return null;
 }
 if (raw.length > IDEMPOTENCY_KEY_MAX) {
 // 🔴 받은 값을 응답에 되돌려 담지 않는다. 길이 규칙만 알린다.
 throw new AppError("AGENT_IDEMPOTENCY_KEY_TOO_LONG");
 }
 return raw;
}

/**
 * 던져진 것을 응답으로 좁힌다.
 *
 * 🔴 **Server 내부 Log 와 Public Error Response 를 구분한다**.
 * 원인은 서버 Log 에 남기고, 밖으로는 `INTERNAL_ERROR` 한 줄만 나간다.
 */
export async function runAgentRoute(
 handler: () => Promise<Response>,
): Promise<Response> {
 try {
 return await handler();
 } catch (error) {
 if (!isAppError(error)) {
 // 🔴 오류 객체를 그대로 넘기지 않는다 — Drizzle 이 바인딩된 값(API Key Hash·Payload)을
 // message 에 싣는다(`describeErrorForLog`).
 console.error("[agent-api] 처리하지 못한 오류:", describeErrorForLog(error));
 }
 return apiErrorFromUnknown(error);
 }
}

/**
 * 본문을 JSON 으로 읽는다.
 *
 * 깨진 JSON 은 **우리 잘못이 아니라 요청 잘못**이다 — 500 이 아니라 `VALIDATION_ERROR` 다.
 *
 * 🔴 **「JSON 으로 파싱된다」와 「저장할 수 있다」는 다른 말이다.** `JSON.parse` 는
 * `\u0000` 과 짝 없는 Surrogate 를 순순히 문자열로 만들어 주지만 PostgreSQL `text` 는
 * 그 둘을 받지 못한다. 그대로 흘려 보내면 Zod 를 통과한 뒤 Driver 가 던져 `500` 이 되고,
 * **5xx 를 재시도하도록 만들어진 Agent 가 성공할 수 없는 요청을 영원히 다시 보낸다.**
 * 여기서 거절하면 `400` 이라 Agent 가 자기 입력을 고칠 수 있다(`lib/validation/db-text.ts`).
 *
 * 🔴 **Schema 마다 필드별로 붙이지 않고 본문 하나를 훑는다.** 필드에 붙이면 새 필드를
 * 더할 때마다 잊을 수 있고, 잊은 자리는 조용히 500 으로 돌아온다. 경계에서 한 번 보면
 * 네 Route 가 같은 보증을 공짜로 받는다 — 이 파일이 존재하는 이유 그대로다.
 *
 * @throws AppError `VALIDATION_ERROR`
 */
export async function readJsonBody(request: Request): Promise<unknown> {
 let body: unknown;

 try {
 body = await request.json();
 } catch {
 throw new AppError("AGENT_BODY_NOT_JSON");
 }

 if (hasUnstorableText(body)) {
 // 🔴 어느 값이 문제였는지 되돌려 담지 않는다 — 받은 값을 응답에 싣지 않는다.
 throw new AppError("AGENT_BODY_UNSTORABLE_TEXT");
 }

 return body;
}

/**
 * Zod 실패를 응답으로 바꾼다.
 *
 * 어느 자리가 틀렸는지는 알려 준다 — 그 정보는 **요청자가 보낸 것**이라 내부를 드러내지
 * 않는다. 반대로 값 자체는 담지 않는다(요청에 담긴 값을 되돌려 보내지 않는다).
 */
export function validationErrorResponse(error: z.ZodError): Response {
 const paths = error.issues
.slice(0, 5)
.map((issue) => (issue.path.length === 0 ? "(root)" : issue.path.join(".")));

 return apiError(
 "VALIDATION_ERROR",
 `요청 형식이 올바르지 않다: ${[...new Set(paths)].join(", ")}`,
);
}

/** Path 의 `{issueId}`. UUID 가 아니면 조회조차 하지 않는다 — Driver 가 던지면 500 이 된다. */
export const issueIdSchema = z.uuid();
