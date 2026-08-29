import { notFound, redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "@/config/messages/en";
import { ko } from "@/config/messages/ko";
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

/**
 * Server Action 의 실패가 **화면 언어로** 돌아오는가.
 *
 * 여기서 보는 것은 「어느 언어의 사전을 골랐는가」 하나다 — 어떤 문구인가는
 * `lib/format/app-error.test.ts` 가 본다.
 *
 * 🔴 **되돌림 확인(2026-08-29)**: `actionFromError` 가 `localizedPublicError` 대신
 * `toPublicError`(기계 문구)를 쓰도록 되돌리면 「EN 쿠키면 영어로 돌아온다」가 실제로
 * 실패한다 — 직접 돌려 봤고 되돌렸다.
 */

const readLocale = vi.fn();

vi.mock("@/lib/ui/appearance", () => ({
  readLocale: () => readLocale(),
}));

const { actionFail, actionFromError } = await import("@/lib/action/action-error");

const HANGUL = /[가-힣]/;

beforeEach(() => {
  vi.clearAllMocks();
  readLocale.mockResolvedValue("ko");
});

describe("actionFromError", () => {
  it("① KO 쿠키면 한국어로 돌아온다", async () => {
    const result = await actionFromError(new AppError("PROJECT_NOT_FOUND"));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("NOT_FOUND");
    expect(result.ok === false && result.error.message).toBe(
      ko.errors.PROJECT_NOT_FOUND,
    );
  });

  it("② EN 쿠키면 같은 오류가 영어로 돌아온다", async () => {
    readLocale.mockResolvedValue("en");

    const result = await actionFromError(new AppError("PROJECT_NOT_FOUND"));

    expect(result.ok === false && result.error.code).toBe("NOT_FOUND");
    expect(result.ok === false && result.error.message).toBe(
      en.errors.PROJECT_NOT_FOUND,
    );
  });

  /**
   * 🔴 **언어를 못 읽는 것이 실패 처리를 다시 실패시킬 이유는 아니다.**
   * 여기서 던지면 원래 오류가 통째로 사라진다.
   */
  it("쿠키를 읽지 못해도 던지지 않고 기본 언어로 적는다", async () => {
    readLocale.mockRejectedValue(new Error("cookies() 는 요청 밖에서 던진다"));

    const result = await actionFromError(new AppError("PROJECT_NOT_FOUND"));

    expect(result.ok === false && result.error.message).toMatch(HANGUL);
  });

  it("🔴 알 수 없는 오류의 message 를 밖으로 흘리지 않는다", async () => {
    const leaky = new Error(
      'connection to server at "10.0.0.5" failed: password authentication failed',
    );

    const result = await actionFromError(leaky);

    expect(result.ok === false && result.error.code).toBe("INTERNAL_ERROR");
    expect(result.ok === false && result.error.message).not.toContain("10.0.0.5");
    expect(result.ok === false && result.error.message).not.toContain("password");
  });

  /**
   * 🔴 Next.js 의 흐름 제어(`redirect`·`notFound`)는 «예외»로 온다.
   *
   * Server Action 이 `try { requireProject() } catch (e) { return actionFromError(e) }`
   * 로 감싸면 그 예외가 `INTERNAL_ERROR` 로 바뀌어, 화면은 로그인으로 이동하지도 404 를
   * 그리지도 못하고 「요청을 처리하지 못했습니다」만 띄운다. 로그아웃 상태로 초대를
   * 수락할 때, 그리고 `updateIssueStatusAction` 이 남의 Project 를 지목받았을 때 실제로 그랬다.
   *
   * ## 되돌림 확인
   *
   * `action-error.ts` 의 `unstable_rethrow(error)` 한 줄을 지우면 아래 두 시험이
   * **실패한다** — `rejects.toThrow` 가 아니라 `{ok:false, INTERNAL_ERROR}` 가 돌아온다.
   */
  it("🔴 redirect 를 삼키지 않고 다시 던진다", async () => {
    const error = thrownBy(() => {
      redirect("/login");
    });

    await expect(actionFromError(error)).rejects.toThrow();
  });

  it("🔴 notFound 를 삼키지 않고 다시 던진다", async () => {
    const error = thrownBy(() => {
      notFound();
    });

    await expect(actionFromError(error)).rejects.toThrow();
  });
});

describe("actionFail", () => {
  it("의미만 받아 화면 언어로 적는다", async () => {
    readLocale.mockResolvedValue("en");

    const result = await actionFail("MOVE_TARGET_PROJECT_NOT_FOUND");

    expect(result.ok === false && result.error.code).toBe("NOT_FOUND");
    expect(result.ok === false && result.error.message).not.toMatch(HANGUL);
  });

  /**
   * 🔴 **컴파일 시점의 시험이다.** 부르지 않는다 — 돌리는 것이 아니라 `pnpm typecheck`
   * 가 아래 `@ts-expect-error` 를 확인하는 것이 이 시험의 전부다. 표시가 필요 없어지는
   * 순간(= 다시 문구를 넣을 수 있게 되는 순간) typecheck 가 깨진다.
   */
  it("🔴 문구를 넘길 자리가 없다", () => {
    async function neverRun() {
      // @ts-expect-error 두 번째 자리는 객체다 — 한국어 한 줄을 넣을 수 없다.
      await actionFail("PROJECT_NOT_FOUND", "Project 를 찾을 수 없습니다.");
      // @ts-expect-error Transport 등급은 오류의 의미가 아니다.
      await actionFail("NOT_FOUND");
    }

    expect(neverRun).toBeTypeOf("function");
  });
});
