import { describe, expect, it } from "vitest";

import { NAVIGATION_ITEMS, sectionHref } from "@/config/navigation";
import {
  isPublicPath,
  LOGIN_PATH,
  readWorkspaceSlugFromPath,
} from "@/config/routes";

/**
 * 🔴 이 시험이 지키는 것은 **「목록에 없으면 보호」** 라는 기본값이다.
 * 그것이 뒤집히면 새 화면을 만들 때마다 조용히 공개된다.
 */
describe("isPublicPath", () => {
  it("로그인 화면은 공개다 — 막으면 무한 리다이렉트가 된다", () => {
    expect(isPublicPath(LOGIN_PATH)).toBe(true);
    expect(isPublicPath("/login/")).toBe(true);
  });

  it("Auth.js Endpoint 는 공개다 — 막으면 로그인이 시작되지 않는다", () => {
    expect(isPublicPath("/api/auth/signin")).toBe(true);
    expect(isPublicPath("/api/auth/callback/github")).toBe(true);
  });

  it("초대 링크는 아직 회원이 아닌 사람도 열 수 있어야 한다", () => {
    expect(isPublicPath("/invite/abc")).toBe(true);
  });

  it("Agent API 는 세션이 아니라 API Key 로 인증한다 — 로그인 화면으로 돌려보내지 않는다", () => {
    expect(isPublicPath("/api/v1/reviews")).toBe(true);
  });

  it("Workspace 화면은 전부 보호다", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/w/acme/issues")).toBe(false);
    expect(isPublicPath("/w/acme/settings")).toBe(false);
  });

  it("목록에 없는 경로는 보호다 — 새 화면이 조용히 공개되지 않는다", () => {
    expect(isPublicPath("/anything-new")).toBe(false);
    expect(isPublicPath("/w")).toBe(false);
  });

  it("접두사가 겹치기만 한 경로를 공개로 착각하지 않는다", () => {
    // `/invite` 로 시작하지만 다른 경로다.
    expect(isPublicPath("/invitep")).toBe(false);
    expect(isPublicPath("/api/authorize")).toBe(false);
    expect(isPublicPath("/loginx")).toBe(false);
  });
});

describe("navigation 과 routes 는 갈라지지 않는다", () => {
  it("사이드바가 링크로 거는 Section 은 전부 보호 경로다", () => {
    const readyItems = NAVIGATION_ITEMS.filter((item) => item.ready);

    expect(readyItems.length).toBeGreaterThan(0);
    for (const item of readyItems) {
      expect(isPublicPath(sectionHref("acme", item.section))).toBe(false);
    }
  });

  it("Section 이름이 중복되지 않는다 — 같은 주소를 두 메뉴가 가리키면 활성 표시가 갈린다", () => {
    const sections = NAVIGATION_ITEMS.map((item) => item.section);
    expect(new Set(sections).size).toBe(sections.length);
  });
});

describe("readWorkspaceSlugFromPath", () => {
  it("Workspace 경로에서 slug 를 읽는다", () => {
    expect(readWorkspaceSlugFromPath("/w/acme/issues")).toBe("acme");
    expect(readWorkspaceSlugFromPath("/w/acme")).toBe("acme");
  });

  it("Workspace 경로가 아니면 null 이다", () => {
    expect(readWorkspaceSlugFromPath("/login")).toBeNull();
    expect(readWorkspaceSlugFromPath("/")).toBeNull();
    expect(readWorkspaceSlugFromPath("/w")).toBeNull();
    expect(readWorkspaceSlugFromPath("/warehouse/acme")).toBeNull();
  });
});
