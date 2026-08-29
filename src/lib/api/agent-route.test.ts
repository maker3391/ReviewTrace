import { describe, expect, it } from "vitest";

import {
  IDEMPOTENCY_KEY_HEADER,
  readIdempotencyKey,
} from "@/lib/api/agent-route";
import { isAppError } from "@/lib/errors";

/**
 * `Idempotency-Key` 를 읽는 자리.
 *
 * 🔴 **「헤더가 없다」와 「헤더가 규칙에 안 맞는다」는 다른 말이다.**
 * 없으면 Dedup 을 요청하지 않은 것이라 `null` 이 맞다. 하지만 상한을 넘은 값을 같은
 * `null` 로 접으면, Agent 는 열쇠를 보냈다고 믿는데 서버는 Dedup 없이 저장한다 —
 * 재전송하면 **ReviewSession 이 하나 더 생기고** 아무 신호도 나지 않는다.
 *
 * ## 되돌림 확인
 *
 * `agent-route.ts` 에서 긴 열쇠를 `null` 로 돌려주도록 되돌리면 아래
 * 「너무 긴 열쇠를 조용히 버리지 않는다」가 **실패한다.**
 */

function requestWithKey(value: string): Request {
  return new Request("https://example.test/api/v1/reviews", {
    method: "POST",
    headers: { [IDEMPOTENCY_KEY_HEADER]: value },
  });
}

describe("readIdempotencyKey", () => {
  it("헤더가 없으면 Dedup 을 요청하지 않은 것이다", () => {
    const request = new Request("https://example.test/api/v1/reviews", {
      method: "POST",
    });

    expect(readIdempotencyKey(request)).toBeNull();
  });

  it("빈 값과 공백뿐인 값도 없는 것으로 본다", () => {
    expect(readIdempotencyKey(requestWithKey(""))).toBeNull();
    expect(readIdempotencyKey(requestWithKey("   "))).toBeNull();
  });

  it("앞뒤 공백을 떼고 그대로 쓴다", () => {
    expect(readIdempotencyKey(requestWithKey("  run-42  "))).toBe("run-42");
  });

  it("상한 길이는 통과한다", () => {
    const exact = "k".repeat(200);

    expect(readIdempotencyKey(requestWithKey(exact))).toBe(exact);
  });

  it("🔴 너무 긴 열쇠를 조용히 버리지 않는다", () => {
    const tooLong = "k".repeat(201);

    // 되돌리면 여기서 null 이 돌아온다 — Dedup 없이 저장되고 재전송이 중복을 만든다.
    expect(() => readIdempotencyKey(requestWithKey(tooLong))).toThrow();
  });

  it("거절은 VALIDATION_ERROR 이고 받은 값을 되돌려 담지 않는다", () => {
    const secretish = "s".repeat(300);

    try {
      readIdempotencyKey(requestWithKey(secretish));
      throw new Error("거절되지 않았다");
    } catch (error) {
      expect(isAppError(error)).toBe(true);
      expect(isAppError(error) && error.code).toBe("VALIDATION_ERROR");
      expect(isAppError(error) && error.message).not.toContain(secretish);
    }
  });
});
