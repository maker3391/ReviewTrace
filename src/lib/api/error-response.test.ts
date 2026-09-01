import { describe, expect, it } from "vitest";

import {
  API_ERROR_CODES,
  apiError,
  apiErrorBody,
  apiErrorFromUnknown,
  statusForErrorCode,
} from "@/lib/api/error-response";
import { AppError } from "@/lib/errors";

/**
 * 되돌림 확인(2026-08-28): `apiErrorFromUnknown` 이 알 수 없는 오류의 `message` 를 그대로
 * 담게 되돌리면 「내부 오류 메시지를 밖으로 내보내지 않는다」가 실패한다. 직접 확인했다.
 */
describe("Error Contract", () => {
  it("스펙이 요구하는 Code 가 전부 있다", () => {
    expect([...API_ERROR_CODES]).toEqual([
      "VALIDATION_ERROR",
      "UNAUTHORIZED",
      "FORBIDDEN",
      "NOT_FOUND",
      "CONFLICT",
      "INTERNAL_ERROR",
    ]);
  });

  it("Code 마다 HTTP Status 가 하나씩 대응한다", () => {
    expect(API_ERROR_CODES.map(statusForErrorCode)).toEqual([
      400, 401, 403, 404, 409, 500,
    ]);
  });

  it("본문은 error.code 와 error.message 뿐이다", () => {
    const body = apiErrorBody("VALIDATION_ERROR", "Invalid review payload");

    expect(body).toEqual({
      error: { code: "VALIDATION_ERROR", message: "Invalid review payload" },
    });
    expect(Object.keys(body.error)).toEqual(["code", "message"]);
  });

  it("메시지를 생략하면 기본 문구가 붙는다", () => {
    expect(apiErrorBody("NOT_FOUND").error.message.length).toBeGreaterThan(0);
  });

  it("응답 Status 가 Code 를 따른다", async () => {
    const response = apiError("UNAUTHORIZED");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "UNAUTHORIZED", message: "인증이 필요합니다." },
    });
  });
});

describe("apiErrorFromUnknown", () => {
  /**
   * 🔴 **`reason` 은 응답에 실리지 않는다.** 내부 이름이라 계약이 아니고, 실리면 이름을
   * 다듬는 순간 Agent 쪽이 깨진다 — 밖으로 나가는 것은 `code` 와 고정 문구뿐이다.
   */
  it("AppError 는 code 를 유지하고 message 는 기계 문구다", async () => {
    const response = apiErrorFromUnknown(new AppError("PROJECT_SLUG_TAKEN"));

    expect(response.status).toBe(409);

    const body = (await response.json()) as {
      error: { code: string; message: string };
    };

    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.message).not.toContain("PROJECT_SLUG_TAKEN");
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  it("🔴 알 수 없는 오류의 내부 메시지를 내보내지 않는다", async () => {
    const leaky = new Error(
      'connect ECONNREFUSED postgres://user:secret@127.0.0.1:5432 — select "key_hash" from "api_keys"',
    );

    const response = apiErrorFromUnknown(leaky);
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(500);
    expect(body.error.message).not.toContain("secret");
    expect(body.error.message).not.toContain("postgres://");
    expect(body.error.message).not.toContain("key_hash");
    expect(JSON.stringify(body)).not.toContain("stack");
  });
});
