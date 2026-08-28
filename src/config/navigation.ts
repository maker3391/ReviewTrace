import type { Route } from "next";
import type { LucideIcon } from "lucide-react";
import {
  Bug,
  FolderGit2,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  Settings,
} from "lucide-react";

import { workspacePath } from "@/config/routes";

/**
 * 메뉴 키 ↔ 사이드바 항목 ↔ 라우트 대응표.
 *
 * 🔴 **한 파일에 둔다.** 여러 곳에 흩으면 「사이드바에는 있는데 라우트가 없는」 항목이 생긴다(CLAUDE.md 11).
 *
 * 모든 항목은 **Workspace 안의 Section** 이다 — 주소는 `/w/{slug}/{section}` 이라 항목 자체는
 * slug 를 모른다. 그래서 `href` 를 상수로 두지 않고 `sectionHref(slug, item)` 로 만든다.
 * 그래야 Workspace 를 전환할 때 **보고 있던 Section 이 유지된다**.
 */
export type MenuKey =
  | "DASHBOARD"
  | "REVIEWS"
  | "ISSUES"
  | "REPOSITORIES"
  | "KNOWLEDGE"
  | "SETTINGS";

export interface NavigationItem {
  key: MenuKey;
  label: string;
  /** 주소의 마지막 조각. `/w/{slug}/{section}` */
  section: string;
  icon: LucideIcon;
  /**
   * 화면이 실제로 있는가.
   *
   * `false` 인 항목은 링크로 만들지 않는다 — 눌러서 404 를 만나게 두지 않는다.
   */
  ready: boolean;
}

export const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  {
    key: "DASHBOARD",
    label: "Dashboard",
    section: "dashboard",
    icon: LayoutDashboard,
    ready: true,
  },
  {
    key: "ISSUES",
    label: "Issues",
    section: "issues",
    icon: Bug,
    ready: true,
  },
  {
    key: "REVIEWS",
    label: "Reviews",
    section: "reviews",
    icon: ListChecks,
    ready: false,
  },
  {
    key: "REPOSITORIES",
    label: "Repositories",
    section: "repositories",
    icon: FolderGit2,
    ready: false,
  },
  {
    key: "KNOWLEDGE",
    label: "Knowledge",
    section: "knowledge",
    icon: Lightbulb,
    ready: false,
  },
  {
    key: "SETTINGS",
    label: "Settings",
    section: "settings",
    icon: Settings,
    ready: true,
  },
] as const;

/** Workspace 를 바꿔도 보고 있던 Section 을 유지하기 위한 기본 Section. */
export const DEFAULT_SECTION = "dashboard";

/**
 * `/w/{slug}/{section}` 주소를 만든다.
 *
 * `typedRoutes` 는 존재하는 Route 만 통과시키지만 slug 는 **실행 시점에야 정해지는 값**이라
 * 타입으로 증명할 수 없다. 대신 Section 은 위 표에 있는 것만 쓰이고, 그 표의 `ready` 가
 * 실제 화면이 있음을 보증한다. 단언은 **이 한 곳에만** 둔다.
 */
export function sectionHref(slug: string, section: string): Route {
  return workspacePath(slug, section) as Route;
}

/**
 * 현재 경로가 어느 Section 인가.
 *
 * Workspace Switcher 가 「같은 자리로 이동」하기 위해 쓴다. 화면이 없는 Section 이면
 * 안전한 기본값(`dashboard`)으로 떨어뜨린다 — 전환했더니 404 가 되는 것을 막는다.
 */
export function currentSection(pathname: string): string {
  // ["", "w", "{slug}", "{section}", ...]
  const section = pathname.split("/")[3] ?? "";
  const known = NAVIGATION_ITEMS.find(
    (item) => item.section === section && item.ready,
  );
  return known?.section ?? DEFAULT_SECTION;
}
