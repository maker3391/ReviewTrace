import type { Route } from "next";
import type { LucideIcon } from "lucide-react";
import { Bug, FolderGit2, LayoutDashboard, Lightbulb } from "lucide-react";

/**
 * 메뉴 키 ↔ 사이드바 항목 ↔ 라우트 대응표.
 *
 * 🔴 **한 파일에 둔다.** 여러 곳에 흩으면 「사이드바에는 있는데 라우트가 없는」 항목이 생긴다(CLAUDE.md 11).
 *
 * 【향후】 인증이 붙으면 항목마다 필요한 권한을 여기에 함께 적고,
 * 서버가 요청마다 그 표로 차단한다. 화면의 비활성 처리는 편의일 뿐 경계가 아니다.
 */
export type MenuKey = "DASHBOARD" | "ISSUES" | "REPOSITORIES" | "KNOWLEDGE";

interface NavigationItemBase {
  key: MenuKey;
  label: string;
  icon: LucideIcon;
}

/**
 * 화면이 있는 항목만 `href` 를 갖는다.
 *
 * `ready: false` 에 주소를 적어 두면 눌러서 404 를 만나게 된다.
 * 타입으로 그 자리를 아예 없앤다 — typedRoutes 가 존재하는 Route 만 통과시킨다.
 */
export type NavigationItem =
  | (NavigationItemBase & { ready: true; href: Route })
  | (NavigationItemBase & { ready: false });

export const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  {
    key: "DASHBOARD",
    label: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
    ready: true,
  },
  {
    key: "ISSUES",
    label: "Issues",
    href: "/issues",
    icon: Bug,
    ready: true,
  },
  {
    key: "REPOSITORIES",
    label: "Repositories",
    icon: FolderGit2,
    ready: false,
  },
  {
    key: "KNOWLEDGE",
    label: "Knowledge",
    icon: Lightbulb,
    ready: false,
  },
] as const;
