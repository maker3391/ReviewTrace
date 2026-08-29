import { describe, expect, it } from "vitest";

import {
  ALL_WORKSPACE_ITEMS,
  currentSection,
  DEFAULT_SECTION,
  PROJECT_ITEMS,
  projectSectionHref,
  sectionHref,
} from "@/config/navigation";
import {
  isPublicPath,
  LOGIN_PATH,
  projectPath,
  readProjectSlugFromPath,
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
    expect(isPublicPath("/w/acme/dashboard")).toBe(false);
    expect(isPublicPath("/w/acme/settings")).toBe(false);
  });

  it("🔴 Project 화면도 전부 보호다 — 한 층 깊어졌다고 공개가 되지 않는다", () => {
    expect(isPublicPath("/w/acme/p/smil")).toBe(false);
    expect(isPublicPath("/w/acme/p/smil/issues")).toBe(false);
    expect(isPublicPath("/w/acme/p/smil/wiki/rules")).toBe(false);
  });

  /**
   * 🔴 되돌림 확인(2026-08-29): `routes.ts` 의 `PUBLIC_ASSET_PATHS` 를 빼면 아래 두 건이
   * 실제로 실패한다. 직접 빼 보고 되돌렸다.
   *
   * 실물로 확인한 증상이다 — 고치기 전 `curl -o /dev/null -w '%{http_code}'` 가
   * `/logo.png` · `/icon.png` 에 **307 -> /login** 을 돌려줬고, 로그인 화면의 로고 자리가
   * 깨진 이미지였다(`naturalWidth = 0`).
   */
  it("🔴 브랜드 자산은 공개다 — 로그인 화면 자신이 쓰는 파일이다", () => {
    expect(isPublicPath("/logo.png")).toBe(true);
    expect(isPublicPath("/icon.png")).toBe(true);
  });

  it("🔴 확장자가 같다고 공개가 되지 않는다 — 목록에 «적힌 이름»만이다", () => {
    expect(isPublicPath("/secret.png")).toBe(false);
    expect(isPublicPath("/w/acme/logo.png")).toBe(false);
    expect(isPublicPath("/logo.png/../w/acme/dashboard")).toBe(false);
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
  it("사이드바가 링크로 거는 Workspace Section 은 전부 보호 경로다", () => {
    expect(ALL_WORKSPACE_ITEMS.length).toBeGreaterThan(0);

    for (const item of ALL_WORKSPACE_ITEMS) {
      expect(isPublicPath(sectionHref("acme", item.section))).toBe(false);
    }
  });

  it("사이드바가 링크로 거는 Project Section 도 전부 보호 경로다", () => {
    expect(PROJECT_ITEMS.length).toBeGreaterThan(0);

    for (const item of PROJECT_ITEMS) {
      expect(isPublicPath(projectSectionHref("acme", "smil", item.section))).toBe(
        false,
      );
    }
  });

  it("Section 이름이 중복되지 않는다 — 같은 주소를 두 메뉴가 가리키면 활성 표시가 갈린다", () => {
    const workspaceSections = ALL_WORKSPACE_ITEMS.map((item) => item.section);
    expect(new Set(workspaceSections).size).toBe(workspaceSections.length);

    const projectSections = PROJECT_ITEMS.map((item) => item.section);
    expect(new Set(projectSections).size).toBe(projectSections.length);
  });

  it("🔴 Project Overview 만 빈 Section 이다 — 그것이 Project 자신의 주소다", () => {
    const empty = PROJECT_ITEMS.filter((item) => item.section === "");
    expect(empty).toHaveLength(1);
    expect(empty[0]?.key).toBe("OVERVIEW");
    expect(projectPath("acme", "smil", "")).toBe("/w/acme/p/smil");
  });
});

describe("currentSection — Workspace 를 바꿔도 보던 자리를 지킨다", () => {
  it("Workspace Section 은 그대로 유지된다", () => {
    expect(currentSection("/w/acme/projects")).toBe("projects");
    expect(currentSection("/w/acme/members")).toBe("members");
  });

  it("🔴 Project 경로에서는 Dashboard 로 떨어진다 — 상대 Workspace 에 같은 Project 가 없다", () => {
    expect(currentSection("/w/acme/p/smil/issues")).toBe(DEFAULT_SECTION);
    expect(currentSection("/w/acme/p/smil")).toBe(DEFAULT_SECTION);
  });

  it("모르는 Section 도 Dashboard 로 떨어진다 — 전환했더니 404 가 되지 않게", () => {
    expect(currentSection("/w/acme/no-such-section")).toBe(DEFAULT_SECTION);
  });
});

describe("readWorkspaceSlugFromPath", () => {
  it("Workspace 경로에서 slug 를 읽는다", () => {
    expect(readWorkspaceSlugFromPath("/w/acme/dashboard")).toBe("acme");
    expect(readWorkspaceSlugFromPath("/w/acme")).toBe("acme");
  });

  it("Project 경로에서도 Workspace slug 는 그대로 읽힌다", () => {
    expect(readWorkspaceSlugFromPath("/w/acme/p/smil/issues")).toBe("acme");
  });

  it("Workspace 경로가 아니면 null 이다", () => {
    expect(readWorkspaceSlugFromPath("/login")).toBeNull();
    expect(readWorkspaceSlugFromPath("/")).toBeNull();
    expect(readWorkspaceSlugFromPath("/w")).toBeNull();
    expect(readWorkspaceSlugFromPath("/warehouse/acme")).toBeNull();
  });
});

describe("readProjectSlugFromPath", () => {
  it("Project 경로에서 slug 를 읽는다", () => {
    expect(readProjectSlugFromPath("/w/acme/p/smil")).toBe("smil");
    expect(readProjectSlugFromPath("/w/acme/p/smil/issues")).toBe("smil");
    expect(readProjectSlugFromPath("/w/acme/p/smil/")).toBe("smil");
  });

  it("Project 경로가 아니면 null 이다", () => {
    expect(readProjectSlugFromPath("/w/acme/dashboard")).toBeNull();
    expect(readProjectSlugFromPath("/w/acme")).toBeNull();
    expect(readProjectSlugFromPath("/w/acme/p")).toBeNull();
    expect(readProjectSlugFromPath("/login")).toBeNull();
  });

  it("🔴 `p` 자리에 다른 낱말이 오면 Project 가 아니다 — 접두 일치로 착각하지 않는다", () => {
    expect(readProjectSlugFromPath("/w/acme/projects/smil")).toBeNull();
    expect(readProjectSlugFromPath("/w/acme/pages/smil")).toBeNull();
  });
});
