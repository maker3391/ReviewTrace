import { describe, expect, it } from "vitest";

import { AppError, describeErrorForLog, toPublicError } from "@/lib/errors";

/**
 * 로그로 나가는 문자열에 **바인딩된 값이 섞이지 않는가**.
 *
 * 🔴 Drizzle 은 질의 실패를 `DrizzleQueryError` 로 감싸며 `message` 에
 * `params: <바인딩된 값 전부>` 를 붙인다. 아래 `drizzleQueryError` 는 실제 라이브러리가
 * 만드는 모양을 그대로 흉내 낸 것이다(`drizzle-orm/errors.js` 생성자를 직접 돌려 확인했다).
 *
 * 인증 조회는 `where key_hash = $1` 로 **API Key 의 SHA-256 Hash** 를 바인딩하고,
 * 근거 확인 UPDATE 는 **코드 Snapshot** 을 바인딩한다. 오류 객체를 `console.error` 에
 * 그대로 넘기면 그 값들이 서버 로그에 남는다 — `api-key-token.ts` 가
 * 「원문·Hash 를 Log 에 담지 않는다」고 못 박은 자리다.
 *
 * ## 되돌림 확인
 *
 * `errors.ts` 의 `hasBoundParams` 분기를 지워 `message` 를 그대로 쓰게 되돌리면
 * 아래 「Hash 가 로그 문자열에 남지 않는다」와 「Payload 가 남지 않는다」가 **실패한다.**
 */

const KEY_HASH = "a3f1".repeat(16);

/** 실제 `DrizzleQueryError` 와 같은 모양: message 에 params 가 붙고, 원본은 cause 에 있다. */
function drizzleQueryError(query: string, params: unknown[], cause: unknown): Error {
  const error = new Error(`Failed query: ${query}\nparams: ${params}`);
  Object.assign(error, { query, params, cause });
  return error;
}

function pgError(code: string, message: string): Error {
  const error = new Error(message);
  Object.assign(error, { code });
  return error;
}

describe("describeErrorForLog", () => {
  it("🔴 API Key Hash 가 로그 문자열에 남지 않는다", () => {
    const error = drizzleQueryError(
      "select id, workspace_id from api_keys where key_hash = $1 limit $2",
      [KEY_HASH, 1],
      pgError("57P01", "terminating connection due to administrator command"),
    );

    const line = describeErrorForLog(error);

    // 되돌리면 여기서 Hash 가 그대로 들어온다.
    expect(line).not.toContain(KEY_HASH);
    expect(error.message).toContain(KEY_HASH); // 원본에는 분명히 들어 있다
  });

  it("🔴 Agent 가 보낸 Payload 와 코드 Snapshot 이 로그에 남지 않는다", () => {
    const snapshot = "const SECRET_TOKEN = 'ghp_do_not_log_me';";
    const error = drizzleQueryError(
      "update issue_code_evidences set snapshot = $1 where id = $2",
      [snapshot, "evi-1"],
      pgError("23502", "null value in column violates not-null constraint"),
    );

    const line = describeErrorForLog(error);

    expect(line).not.toContain("ghp_do_not_log_me");
    expect(line).not.toContain(snapshot);
  });

  it("좇을 수 있게 SQL 의 틀과 SQLSTATE 는 남긴다", () => {
    const error = drizzleQueryError(
      "select id from api_keys where key_hash = $1",
      [KEY_HASH],
      pgError("23505", "duplicate key value"),
    );

    const line = describeErrorForLog(error);

    expect(line).toContain("key_hash = $1"); // 값이 아니라 자리표시자다
    expect(line).toContain("sqlstate=23505");
    expect(line).toContain("params=[redacted]");
  });

  it("우리가 만든 AppError 는 code 와 reason 을 그대로 남긴다", () => {
    const line = describeErrorForLog(new AppError("PROJECT_SLUG_TAKEN"));

    expect(line).toBe("AppError(CONFLICT): PROJECT_SLUG_TAKEN");
  });

  /**
   * 🔴 `meta` 에는 사용자 값(`slug`)이 들어 있다. 로그에 남기지 않는다 —
   * `reason` 은 우리가 고른 내부 이름이라 남겨도 되지만 값은 다른 이야기다.
   */
  it("🔴 AppError 의 meta 에 담긴 사용자 값은 로그에 남지 않는다", () => {
    const line = describeErrorForLog(
      new AppError("PROJECT_SLUG_RESERVED", { meta: { slug: "new" } }),
    );

    expect(line).toBe("AppError(VALIDATION_ERROR): PROJECT_SLUG_RESERVED");
  });

  it("평범한 오류는 메시지를 남긴다 — 값이 붙어 있지 않다", () => {
    expect(describeErrorForLog(new Error("Connection terminated"))).toContain(
      "Connection terminated",
    );
  });

  it("오류가 아닌 것이 던져져도 터지지 않는다", () => {
    expect(describeErrorForLog(null)).toContain("non-error");
    expect(describeErrorForLog("boom")).toContain("non-error");
    expect(describeErrorForLog(undefined)).toContain("non-error");
  });

  it("cause 가 순환해도 멈춘다", () => {
    const looping = new Error("loop");
    Object.assign(looping, { cause: looping });

    expect(() => describeErrorForLog(looping)).not.toThrow();
  });

  it("응답으로는 여전히 아무것도 새지 않는다", () => {
    const error = drizzleQueryError(
      "select id from api_keys where key_hash = $1",
      [KEY_HASH],
      pgError("57P01", "terminating connection"),
    );

    expect(toPublicError(error)).toEqual({
      code: "INTERNAL_ERROR",
      message: "요청을 처리하지 못했습니다.",
    });
  });
});
