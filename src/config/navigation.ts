import type { Route } from "next";

import { projectPath, workspacePath } from "@/config/routes";

/**
 * 메뉴 키 ↔ 사이드바 항목 ↔ 라우트 대응표.
 *
 * 🔴 **한 파일에 둔다.** 여러 곳에 흩으면 「사이드바에는 있는데 라우트가 없는」 항목이 생긴다(CLAUDE.md 11).
 *
 * ## 두 층을 섞지 않는다
 *
 * ```
 * Workspace 항목   /w/{workspaceSlug}/{section}                  Tenant 안에서 무엇을 보는가
 * Project 항목     /w/{workspaceSlug}/p/{projectSlug}/{section}  그 안의 업무 단위에서 무엇을 보는가
 * ```
 *
 * 🔴 **Workspace 전환은 Tenant 변경이고 Project 전환은 Context 변경이다**(스펙 4).
 * 한 목록에 뭉치면 Project 를 고른 것이 Tenant 를 바꾼 것처럼 보인다.
 *
 * 🔴 **항목에 Icon 을 두지 않는다**(CLAUDE.md 16). 다섯 글자짜리 낱말 앞의 아이콘은
 * 정보를 더하지 않고 시선만 나눈다. 계층은 그룹과 divider 로 드러낸다.
 *
 * 🔴 **항목에 «이름»도 두지 않는다.** 화면에 그려지는 낱말은 언어마다 달라지므로
 * 사전(`config/messages/*.ts`)의 `nav` 가 **키로** 갖는다 — 이 파일은 Proxy·시험도 읽는
 * 순수 대응표라 언어를 알아야 할 이유가 없다. 메뉴를 하나 더하면 사전 쪽에서
 * typecheck 가 깨져, 이름 없는 항목이 조용히 생기지 않는다.
 */

export type WorkspaceMenuKey =
  | "DASHBOARD"
  | "PROJECTS"
  | "WIKI"
  | "MEMBERS"
  | "SETTINGS";

export type ProjectMenuKey =
  | "OVERVIEW"
  | "REVIEWS"
  | "ISSUES"
  | "WIKI"
  | "REPOSITORIES"
  | "SETTINGS";

export interface NavigationItem<Key extends string> {
  key: Key;
  /** 주소의 마지막 조각. Project 의 `OVERVIEW` 만 빈 문자열이다 — 그것이 Project 자신이다. */
  section: string;
}

/**
 * Workspace 층의 상단 메뉴.
 *
 * Members·Settings 는 매일 보는 것이 아니라 아래(`WORKSPACE_FOOTER_ITEMS`)로 내린다 —
 * 모든 메뉴를 같은 시각적 강도로 두지 않는다(CLAUDE.md 16).
 */
export const WORKSPACE_ITEMS: readonly NavigationItem<WorkspaceMenuKey>[] = [
  { key: "DASHBOARD", section: "dashboard" },
  { key: "PROJECTS", section: "projects" },
  { key: "WIKI", section: "wiki" },
] as const;

export const WORKSPACE_FOOTER_ITEMS: readonly NavigationItem<WorkspaceMenuKey>[] =
  [
    { key: "MEMBERS", section: "members" },
    { key: "SETTINGS", section: "settings" },
  ] as const;

/** Project 층의 메뉴. Project 를 고른 뒤에만 그린다. */
export const PROJECT_ITEMS: readonly NavigationItem<ProjectMenuKey>[] = [
  { key: "OVERVIEW", section: "" },
  { key: "REVIEWS", section: "reviews" },
  { key: "ISSUES", section: "issues" },
  { key: "WIKI", section: "wiki" },
  { key: "REPOSITORIES", section: "repositories" },
  { key: "SETTINGS", section: "settings" },
] as const;

/** Workspace 를 바꿔도 보고 있던 Section 을 유지하기 위한 기본 Section. */
export const DEFAULT_SECTION = "dashboard";

/** 사이드바가 링크로 거는 Workspace Section 전체. 시험이 라우트와 맞대어 본다. */
export const ALL_WORKSPACE_ITEMS: readonly NavigationItem<WorkspaceMenuKey>[] = [
  ...WORKSPACE_ITEMS,
  ...WORKSPACE_FOOTER_ITEMS,
];

/**
 * `/w/{slug}/{section}` 주소를 만든다.
 *
 * `typedRoutes` 는 존재하는 Route 만 통과시키지만 slug 는 **실행 시점에야 정해지는 값**이라
 * 타입으로 증명할 수 없다. 대신 Section 은 위 표에 있는 것만 쓰인다.
 * 단언은 **이 파일에만** 둔다.
 */
export function sectionHref(slug: string, section: string): Route {
  return workspacePath(slug, section) as Route;
}

/** `/w/{workspaceSlug}/p/{projectSlug}/{section}` 주소를 만든다. */
export function projectSectionHref(
  workspaceSlug: string,
  projectSlug: string,
  section: string,
): Route {
  return projectPath(workspaceSlug, projectSlug, section) as Route;
}

/**
 * 현재 경로가 어느 Workspace Section 인가.
 *
 * Workspace Switcher 가 「같은 자리로 이동」하기 위해 쓴다.
 *
 * 🔴 **Project 경로에서는 Dashboard 로 떨어진다.** `/w/a/p/smil/issues` 에서 Workspace 를
 * 바꾸면 `/w/b/p/smil/issues` 로 갈 수 없다 — Project slug 는 Workspace 안에서만 유효해
 * 상대 Workspace 에 같은 이름의 Project 가 있다는 보장이 없다. 없는 곳으로 보내 404 를
 * 만나게 하는 대신 그 Workspace 의 Dashboard 로 보낸다.
 */
export function currentSection(pathname: string): string {
  // ["", "w", "{slug}", "{section}", ...]
  const section = pathname.split("/")[3] ?? "";
  const known = ALL_WORKSPACE_ITEMS.find((item) => item.section === section);
  return known?.section ?? DEFAULT_SECTION;
}
