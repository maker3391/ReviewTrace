import { describe, expect, it } from "vitest";

import { isUniqueViolation } from "@/db/unique-violation";

/**
 * unique 위반 판정.
 *
 * 🔴 **이 시험의 핵심은 「감싸인 오류」다.** `pg` 는 SQLSTATE 를 `DatabaseError.code` 에
 * 담지만 우리에게 그것이 그대로 오지 않는다 — Drizzle 이 질의 오류를 전부
 * `DrizzleQueryError` 로 감싸고 원본을 `cause` 에 넣는다
 * (`drizzle-orm/pg-core/session.js` 의 `queryWithCache`).
 *
 * 맨 바깥만 보면 `code` 가 `undefined` 라 **진짜 unique 위반이 「아니다」로 판정되고**,
 * 정상 사용자가 이미 쓰이는 slug 를 넣었을 때 「같은 이름이 있습니다」 대신 **500** 을 본다.
 * 무엇이든 `CONFLICT` 로 접던 예전보다 나쁜 과차단이다.
 *
 * ## 되돌림 확인
 *
 * `unique-violation.ts` 를 맨 바깥의 `code` 만 보도록 되돌리면
 * 「Drizzle 이 감싼 것을 알아본다」와 「두 겹 감싸도 알아본다」가 **실패한다.**
 */

/** `pg` 의 `DatabaseError` 모양. SQLSTATE 는 `code` 에 있다. */
function pgUniqueViolation(): Error {
  const error = new Error(
    'duplicate key value violates unique constraint "projects_workspace_slug_unique"',
  );
  Object.assign(error, { code: "23505" });
  return error;
}

/** Drizzle 의 `DrizzleQueryError` 모양. 원본을 `cause` 에 넣고 `code` 는 갖지 않는다. */
function drizzleWrapped(cause: unknown): Error {
  const error = new Error("Failed query: update projects set ...\nparams: ...");
  Object.assign(error, { query: "update projects ...", params: [], cause });
  return error;
}

describe("isUniqueViolation", () => {
  it("드라이버 오류를 그대로 받으면 알아본다", () => {
    expect(isUniqueViolation(pgUniqueViolation())).toBe(true);
  });

  it("🔴 Drizzle 이 감싼 것을 알아본다", () => {
    // 되돌리면 여기서 false 가 되어 모든 slug 충돌이 500 으로 나간다.
    expect(isUniqueViolation(drizzleWrapped(pgUniqueViolation()))).toBe(true);
  });

  it("🔴 두 겹 감싸도 알아본다", () => {
    expect(
      isUniqueViolation(drizzleWrapped(drizzleWrapped(pgUniqueViolation()))),
    ).toBe(true);
  });

  it("다른 SQLSTATE 는 unique 위반이 아니다", () => {
    const notNull = new Error("null value in column violates not-null");
    Object.assign(notNull, { code: "23502" });

    expect(isUniqueViolation(notNull)).toBe(false);
    expect(isUniqueViolation(drizzleWrapped(notNull))).toBe(false);
  });

  it("접속 끊김처럼 code 가 없는 오류는 unique 위반이 아니다", () => {
    expect(isUniqueViolation(new Error("Connection terminated"))).toBe(false);
    expect(isUniqueViolation(drizzleWrapped(new Error("timeout")))).toBe(false);
  });

  it("오류가 아닌 값에도 터지지 않는다", () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
    expect(isUniqueViolation(23505)).toBe(false);
  });

  it("cause 가 자기 자신을 가리켜도 멈춘다", () => {
    const looping = new Error("loop");
    Object.assign(looping, { cause: looping });

    expect(isUniqueViolation(looping)).toBe(false);
  });

  it("사슬이 아주 길어도 멈춘다", () => {
    let nested: unknown = pgUniqueViolation();
    for (let i = 0; i < 50; i += 1) {
      nested = drizzleWrapped(nested);
    }

    // 상한을 넘으면 찾지 못하고 멈춘다 — 무한히 파고들지 않는 것이 요점이다.
    expect(isUniqueViolation(nested)).toBe(false);
  });
});
