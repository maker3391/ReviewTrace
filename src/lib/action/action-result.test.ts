import { notFound, redirect } from "next/navigation";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  actionFail,
  actionFromError,
  actionOk,
  actionValidationFailed,
} from "@/lib/action/action-result";
import { AppError } from "@/lib/errors";

/** 던져진 것을 그대로 잡아 온다 — Server Action 의 `try/catch` 와 같은 모양이다. */
function thrownBy(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("아무것도 던져지지 않았다");
}

describe("ActionResult", () => {
  it("성공은 데이터를 그대로 담는다", () => {
    const result = actionOk({ id: "abc" });

    expect(result.ok).toBe(true);
    expect(result.ok && result.data).toEqual({ id: "abc" });
  });

  it("실패는 code 와 message 로만 나간다", () => {
    const result = actionFail("FORBIDDEN");

    expect(result).toEqual({
      ok: false,
      error: { code: "FORBIDDEN", message: "권한이 없습니다." },
    });
  });

  it("AppError 는 code 를 유지한다", () => {
    const result = actionFromError(
      new AppError("NOT_FOUND", "Issue 를 찾을 수 없습니다."),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toEqual({
      code: "NOT_FOUND",
      message: "Issue 를 찾을 수 없습니다.",
    });
  });

  it("🔴 알 수 없는 오류의 message 를 밖으로 흘리지 않는다", () => {
    const leaky = new Error(
      'connection to server at "10.0.0.5" failed: password authentication failed',
    );

    const result = actionFromError(leaky);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toEqual({
      code: "INTERNAL_ERROR",
      message: "요청을 처리하지 못했습니다.",
    });
  });

  /**
   * 🔴 Next.js 의 흐름 제어(`redirect`·`notFound`)는 «예외»로 온다.
   *
   * Server Action 이 `try { requireUser() } catch { return actionFromError(e) }` 로 감싸면
   * 그 예외가 `INTERNAL_ERROR` 로 바뀌어, 화면은 로그인으로 이동하지도 404 를 그리지도
   * 못하고 「요청을 처리하지 못했습니다」만 띄운다. 로그아웃 상태로 초대를 수락할 때
   * 실제로 그랬다.
   *
   * ## 되돌림 확인
   *
   * `action-result.ts` 의 `unstable_rethrow(error)` 한 줄을 지우면 아래 두 시험이
   * **실패한다** — `toThrow` 가 아니라 `{ok:false, INTERNAL_ERROR}` 가 돌아온다.
   */
  it("🔴 redirect 를 삼키지 않고 다시 던진다", () => {
    const error = thrownBy(() => {
      redirect("/login");
    });

    expect(() => actionFromError(error)).toThrow();
  });

  it("🔴 notFound 를 삼키지 않고 다시 던진다", () => {
    const error = thrownBy(() => {
      notFound();
    });

    expect(() => actionFromError(error)).toThrow();
  });

  it("Zod 실패를 필드별 메시지로 옮긴다", () => {
    const schema = z.object({
      title: z.string().min(1, "제목은 필수입니다."),
      severity: z.enum(["HIGH", "LOW"]),
    });
    const parsed = schema.safeParse({ title: "", severity: "NOPE" });

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      return;
    }

    const result = actionValidationFailed(parsed.error);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("VALIDATION_ERROR");
    expect(result.ok === false && result.fieldErrors?.title).toEqual([
      "제목은 필수입니다.",
    ]);
    expect(result.ok === false && result.fieldErrors?.severity).toHaveLength(1);
  });
});
