import "server-only";

import { z } from "zod";

import { apiError, apiErrorFromUnknown } from "@/lib/api/error-response";
import { AppError, isAppError } from "@/lib/errors";

/**
 * Agent API Route Handler 의 공통 처리.
 *
 * 🔴 **Route Handler 는 Transport Boundary 다**(CLAUDE.md 5). 여기 있는 것은 HTTP 를
 * 다루는 일뿐이다 — 인증·Parsing·오류 변환. 업무 판단은 Application Service 가 한다.
 *
 * 「의미 없는 BaseService」를 만들지 않는다(스펙 36) — 이 파일에 있는 것은 네 Route 가
 * **똑같이 틀리기 쉬운 자리**(오류를 그대로 흘리는 것)를 한 곳으로 모은 것뿐이다.
 */

/** Idempotency-Key 헤더 이름. 값의 뜻은 `review-ingest-service.ts` 가 정한다. */
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

const IDEMPOTENCY_KEY_MAX = 200;

export function readIdempotencyKey(request: Request): string | null {
  const raw = request.headers.get(IDEMPOTENCY_KEY_HEADER)?.trim() ?? "";
  if (raw === "" || raw.length > IDEMPOTENCY_KEY_MAX) {
    return null;
  }
  return raw;
}

/**
 * 던져진 것을 응답으로 좁힌다.
 *
 * 🔴 **Server 내부 Log 와 Public Error Response 를 구분한다**(CLAUDE.md 19).
 * 원인은 서버 Log 에 남기고, 밖으로는 `INTERNAL_ERROR` 한 줄만 나간다.
 */
export async function runAgentRoute(
  handler: () => Promise<Response>,
): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (!isAppError(error)) {
      console.error("[agent-api] 처리하지 못한 오류", error);
    }
    return apiErrorFromUnknown(error);
  }
}

/**
 * 본문을 JSON 으로 읽는다.
 *
 * 깨진 JSON 은 **우리 잘못이 아니라 요청 잘못**이다 — 500 이 아니라 `VALIDATION_ERROR` 다.
 *
 * @throws AppError `VALIDATION_ERROR`
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "요청 본문이 올바른 JSON 이 아니다.");
  }
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
