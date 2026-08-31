import { beforeEach, describe, expect, it, vi } from "vitest";

const { permanentRedirectMock } = vi.hoisted(() => ({
  permanentRedirectMock: vi.fn((path: string): never => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({
  permanentRedirect: permanentRedirectMock,
}));

import LoginRedirectPage from "@/app/(auth)/login/page";

describe("legacy login route", () => {
  beforeEach(() => {
    permanentRedirectMock.mockClear();
  });

  it("중복 Landing을 렌더하지 않고 root로 영구 이동한다", async () => {
    await expect(
      LoginRedirectPage({ searchParams: Promise.resolve({}) } as never),
    ).rejects.toThrow("redirect:/");

    expect(permanentRedirectMock).toHaveBeenCalledOnce();
    expect(permanentRedirectMock).toHaveBeenCalledWith("/");
  });

  it("Auth.js 오류 코드는 root Landing에 안전하게 전달한다", async () => {
    await expect(
      LoginRedirectPage({
        searchParams: Promise.resolve({ error: "OAuth Callback" }),
      } as never),
    ).rejects.toThrow("redirect:/?error=OAuth%20Callback");

    expect(permanentRedirectMock).toHaveBeenCalledWith(
      "/?error=OAuth%20Callback",
    );
  });
});
