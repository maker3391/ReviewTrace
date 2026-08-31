"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
 BookText,
 Boxes,
 Bug,
 FolderGit2,
 LayoutDashboard,
 ListChecks,
 PanelLeftClose,
 PanelLeftOpen,
 Settings,
 SlidersHorizontal,
 Users,
 type LucideIcon,
} from "lucide-react";

import {
 WorkspaceSwitcher,
 type SwitcherWorkspace,
} from "@/components/organisms/WorkspaceSwitcher";
import type { CreateWorkspaceLabels } from "@/features/workspaces/components/CreateWorkspaceDialog";
import {
 Tooltip,
 TooltipContent,
 TooltipTrigger,
} from "@/components/ui/tooltip";
import {
 PROJECT_ITEMS,
 projectSectionHref,
 sectionHref,
 WORKSPACE_FOOTER_ITEMS,
 WORKSPACE_ITEMS,
 type ProjectMenuKey,
 type WorkspaceMenuKey,
} from "@/config/navigation";
import { readProjectSlugFromPath } from "@/config/routes";
import { writeSidebarCollapsedCookie } from "@/lib/ui/sidebar-state";
import { cn } from "@/lib/utils";

/**
 * 좌측 내비게이션.
 *
 * Client Component 인 이유는 둘이다 — 현재 경로에 따라 활성 항목이 달라지고, 접고 펼친다.
 * 항목 목록 자체는 `config/navigation.ts` 한 곳에서 온다.
 *
 * ## 세 계층이 눈으로 갈려야 한다
 *
 * ```
 * [ CodeApex ▼ ] Workspace Switcher — Tenant
 * Dashboard / Projects / Wiki
 * ──────────
 * PROJECT 머리글 (지금 어느 Project 안인가)
 * SMIL
 * Overview / Reviews / Issues / Wiki / Repositories / Settings
 * ──────────
 * Members / Settings 가끔 여는 것
 * ```
 *
 * 🔴 **모든 메뉴를 같은 강도로 그리지 않는다.** 활성 항목은 **배경 + 굵기 + Icon 색** 셋으로
 * 드러내되 **강한 색을 넓게 깔지 않는다**.
 *
 * ## 접고 펼칠 때 어색하지 않게 만드는 것
 *
 * 🔴 **글자 폭을 애니메이션하지 않는다.** 글자가 줄어들면 낱말이 접히고 잘려 보인다.
 * 대신 셋을 조합한다:
 *
 * 1. 글자는 **폭을 그대로 둔 채**(`whitespace-nowrap`) 사이드바의 `overflow-hidden` 이 자른다
 * 2. **접을 때는 글자가 먼저 사라진다** — opacity 100ms, 폭은 200ms.
 * 글자가 다 사라진 뒤에 폭이 줄어드니 잘리는 순간이 보이지 않는다
 * 3. **펼칠 때는 순서가 뒤집힌다** — 폭이 먼저 열리고(200ms) 자리가 생긴 뒤 글자가 뜬다
 * (`delay-150`). 좁은 폭에 글자가 먼저 나타나 뭉개지는 일이 없다
 *
 * Icon 은 두 상태에서 **왼쪽 끝에서 같은 거리**에 있다(`nav px-2` + `item px-2`).
 * 그래서 접히고 펼쳐질 때 Icon 이 좌우로 튀지 않는다.
 *
 * ## 좁은 폭
 *
 * 🔴 **`md` 아래에서는 «고른 상태와 무관하게» 아이콘만 남는다**(`w-16`). 390px 화면에서
 * 사이드바가 16rem 을 차지하면 본문이 볼 수 없게 좁아진다. 접기 버튼도 그때는 숨긴다 —
 * 눌러 봐야 폭이 달라지지 않아 「듣지 않는 버튼」이 된다.
 *
 * 🔴 **쿠키 값을 좁은 폭에서 덮어쓰지 않는다.** 여기서 하는 일은 CSS 로 그리는 방식을
 * 바꾸는 것뿐이라, 넓은 화면으로 돌아오면 사용자가 골라 둔 상태 그대로다.
 */

/** 사이드바가 실제로 그리는 낱말. 🔴 사전 전체를 넘기지 않는다. */
export interface SidebarLabels {
 primary: string;
 projectHeading: string;
 expand: string;
 collapse: string;
 workspaceLabel: string;
 personal: string;
 createWorkspace: string;
 /** Switcher 아래에서 열리는 Dialog 의 문구. */
 createWorkspaceDialog: CreateWorkspaceLabels;
 workspace: Record<WorkspaceMenuKey, string>;
 project: Record<ProjectMenuKey, string>;
}

/**
 * 메뉴 키 ↔ Icon.
 *
 * 🔴 Icon 은 `config/navigation.ts` 가 아니라 **여기** 있다. 그 파일은 Proxy·시험도 읽는
 * 순수 대응표라, React 전용 의존(`lucide-react`)을 끌어들이면 안 된다.
 */
const WORKSPACE_ICONS: Record<string, LucideIcon> = {
 DASHBOARD: LayoutDashboard,
 PROJECTS: Boxes,
 WIKI: BookText,
 MEMBERS: Users,
 SETTINGS: Settings,
};

const PROJECT_ICONS: Record<string, LucideIcon> = {
 OVERVIEW: LayoutDashboard,
 REVIEWS: ListChecks,
 ISSUES: Bug,
 WIKI: BookText,
 REPOSITORIES: FolderGit2,
 SETTINGS: SlidersHorizontal,
};

export function AppSidebar({
 currentSlug,
 workspaces,
 projects,
 defaultCollapsed,
 labels,
}: {
 currentSlug: string;
 workspaces: readonly SwitcherWorkspace[];
 /**
 * 이 Workspace 의 Project 목록.
 *
 * 🔴 **서버가 소속을 확인해 넘긴 것이다.** 이 Component 는 그중 «지금 주소가 가리키는
 * 것»을 고를 뿐, 목록을 만들거나 늘리지 않는다.
 */
 projects: readonly { slug: string; name: string }[];
 /** 🔴 서버가 쿠키에서 읽어 넘긴 첫 상태. 이것이 있어야 새로고침 때 깜빡이지 않는다. */
 defaultCollapsed: boolean;
 labels: SidebarLabels;
}) {
 const pathname = usePathname();
 const [collapsed, setCollapsed] = useState(defaultCollapsed);

 /**
 * 주소의 Project slug 를 서버가 준 목록에 맞대어 본다.
 *
 * 없는 slug 를 주소에 적어도 여기서 걸러져 Project 묶음이 그려지지 않는다 —
 * 화면 자체는 `requireProject` 가 404 로 막는다. 여기서는 **이름을 지어내지 않는 것**이 요점이다.
 */
 const currentProjectSlug = readProjectSlugFromPath(pathname);
 const currentProject =
 currentProjectSlug === null
 ? null
 : (projects.find((item) => item.slug === currentProjectSlug) ?? null);

 function toggle() {
 const next = !collapsed;
 setCollapsed(next);
 // 다음 요청부터는 서버가 이 상태로 그린다 — 새로고침해도 깜빡이지 않는다.
 writeSidebarCollapsedCookie(next);
 }

 return (
 <nav
 aria-label={labels.primary}
 data-collapsed={collapsed}
 className={cn(
 "flex shrink-0 flex-col gap-1 overflow-hidden border-r border-sidebar-border bg-sidebar px-2 py-3",
 "transition-[width] duration-200 ease-out motion-reduce:transition-none",
 // 🔴 좁은 폭에서는 고른 상태와 무관하게 아이콘만 남는다.
 "w-16",
 collapsed ? "md:w-[5.5rem]" : "md:w-64",
)}
 >
 {/*
 🔴 접기 버튼은 **Workspace 선택 바 옆**, 두 상태 모두 «같은 줄»에 둔다.

 접힐 때 아래로 내려가면 버튼이 위아래로 튀어 어디를 눌러야 하는지 매번 다시 찾게 된다.
 그래서 접힘 폭을 아바타 하나가 아니라 **아바타 + 버튼이 나란히 들어가는 크기**로 잡았다.

 🔴 폭 계산에 **Switcher 버튼 자신의 좌우 padding 을 빠뜨리면 아바타가 잘린다.**
 처음에 72px 로 잡았다가 실제로 잘렸다. 필요한 것은 전부 더한 값이다:

 nav px-2(16) + [버튼 px-2(16) + 아바타(24)] + gap(4) + 접기 버튼(28) = 88px

 아바타의 왼쪽 offset 은 nav 8 + 버튼 8 = 16 으로, 아래 메뉴 Icon 과 같다 —
 접고 펼칠 때 좌우로 튀지 않는다.
 */}
 <div className="mb-2 flex items-center gap-1">
 <div className="min-w-0 flex-1">
 <WorkspaceSwitcher
 currentSlug={currentSlug}
 workspaces={workspaces}
 collapsed={collapsed}
 labels={{
 workspaceLabel: labels.workspaceLabel,
 personal: labels.personal,
 createWorkspace: labels.createWorkspace,
 dialog: labels.createWorkspaceDialog,
 }}
 />
 </div>
 <CollapseToggle
 collapsed={collapsed}
 onToggle={toggle}
 labels={labels}
 />
 </div>

 <ul className="flex flex-col gap-0.5">
 {WORKSPACE_ITEMS.map((item) => (
 <NavLink
 key={item.key}
 href={sectionHref(currentSlug, item.section)}
 label={labels.workspace[item.key]}
 icon={WORKSPACE_ICONS[item.key]}
 pathname={pathname}
 collapsed={collapsed}
 />
))}
 </ul>

 {currentProject !== null && (
 <>
 <Divider />
 {/*
 Project 이름은 «머리글»이다 — 링크 목록의 한 줄로 두면 Overview 와 구분되지 않는다.
 접히면 자리를 통째로 비운다: 좁은 폭에 이름을 욱여넣으면 잘려 보인다.
 */}
 <div
 className={cn(
 // 🔴 좁은 폭에서는 자리 자체를 두지 않는다 — 아이콘만 남는 폭이다.
 "max-md:hidden",
 "overflow-hidden px-2 transition-[max-height,opacity,padding] duration-200 ease-out motion-reduce:transition-none",
 collapsed
 ? "max-h-0 py-0 opacity-0"
 : "max-h-16 pb-1.5 pt-0.5 opacity-100 delay-100",
)}
 >
 <p className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
 {labels.projectHeading}
 </p>
 <p className="truncate text-[15px] font-semibold tracking-tight text-sidebar-foreground">
 {currentProject.name}
 </p>
 </div>
 <ul className="flex flex-col gap-0.5">
 {PROJECT_ITEMS.map((item) => (
 <NavLink
 key={item.key}
 href={projectSectionHref(
 currentSlug,
 currentProject.slug,
 item.section,
)}
 label={labels.project[item.key]}
 icon={PROJECT_ICONS[item.key]}
 pathname={pathname}
 collapsed={collapsed}
 // Overview 는 Project 자신이라 접두 일치로 보면 모든 하위 화면에서 활성이 된다.
 exact={item.section === ""}
 />
))}
 </ul>
 </>
)}

 <Divider className="mt-auto" />

 <ul className="flex flex-col gap-0.5">
 {WORKSPACE_FOOTER_ITEMS.map((item) => (
 <NavLink
 key={item.key}
 href={sectionHref(currentSlug, item.section)}
 label={labels.workspace[item.key]}
 icon={WORKSPACE_ICONS[item.key]}
 pathname={pathname}
 collapsed={collapsed}
 muted
 />
))}
 </ul>
 </nav>
);
}

function Divider({ className }: { className?: string }) {
 return (
 <div
 aria-hidden
 className={cn("my-2.5 border-t border-sidebar-border/70", className)}
 />
);
}

/**
 * 접기 버튼.
 *
 * 사이드바 맨 아래에 둔다 — 두 상태 모두에서 **같은 자리**라 눌러 놓고 다시 찾기 쉽다.
 * Icon 이 방향을 그대로 말하므로 접힌 상태에서도 글자가 필요 없다.
 */
function CollapseToggle({
 collapsed,
 onToggle,
 labels,
}: {
 collapsed: boolean;
 onToggle: () => void;
 labels: { expand: string; collapse: string };
}) {
 const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
 const label = collapsed ? labels.expand : labels.collapse;

 const button = (
 <button
 type="button"
 onClick={onToggle}
 aria-label={label}
 aria-expanded={!collapsed}
 // 🔴 좁은 폭에서는 숨긴다 — 눌러도 폭이 달라지지 않아 듣지 않는 버튼이 된다.
 className="hidden size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 outline-none hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:ring-3 focus-visible:ring-sidebar-ring/50 md:flex"
 >
 <Icon aria-hidden className="size-[18px] shrink-0" />
 </button>
);

 // 아이콘만 남는 버튼이라 두 상태 모두 이름을 Tooltip 으로 알린다.
 return (
 <Tooltip>
 <TooltipTrigger asChild>{button}</TooltipTrigger>
 <TooltipContent side="right">{label}</TooltipContent>
 </Tooltip>
);
}

/**
 * 항목 한 줄.
 *
 * 활성 판정은 **접두 일치**가 기본이다 — `/issues/123` 에서도 Issues 가 켜져야 한다.
 * 다만 Project Overview 는 그 Project 의 모든 주소의 접두라서 `exact` 로 잠근다.
 *
 * 접힌 상태에서는 Tooltip 이 이름을 대신한다 — Icon 만 남으면 무엇인지 알 수 없다.
 */
function NavLink({
 href,
 label,
 icon: Icon,
 pathname,
 collapsed,
 exact = false,
 muted = false,
}: {
 href: Route;
 label: string;
 icon?: LucideIcon;
 pathname: string;
 collapsed: boolean;
 exact?: boolean;
 muted?: boolean;
}) {
 const active = exact
 ? pathname === href
 : pathname === href || pathname.startsWith(`${href}/`);

 const link = (
 <Link
 href={href}
 aria-current={active ? "page" : undefined}
 className={cn(
 // 🔴 내부 관리도구처럼 촘촘하지 않게 — 아이콘 20px · 글자 15px · 넉넉한 행 높이.
 "group flex items-center gap-3 rounded-lg px-2 py-2 text-[15px] transition-colors duration-150",
 // 🔴 접기 버튼(위)과 «같은» 초점 표시다. 사이드바 안에서 Tab 이 어디에 있는지
 // 행 모양 그대로 드러난다 — 얇은 브라우저 기본 outline 으로 두지 않는다.
 "outline-none focus-visible:ring-3 focus-visible:ring-sidebar-ring/50",
 active
 ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
 : muted
 ? "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
 : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
)}
 >
 {Icon !== undefined && (
 <Icon
 aria-hidden
 className={cn(
 "size-5 shrink-0 transition-colors",
 active
 ? "text-sidebar-primary"
 : "text-muted-foreground/70 group-hover:text-muted-foreground",
)}
 />
)}
 <NavLabel collapsed={collapsed}>{label}</NavLabel>
 </Link>
);

 return (
 <li>
 {collapsed ? (
 <Tooltip>
 <TooltipTrigger asChild>{link}</TooltipTrigger>
 <TooltipContent side="right">{label}</TooltipContent>
 </Tooltip>
) : (
 link
)}
 </li>
);
}

/**
 * 접힐 때 사라지는 글자.
 *
 * 🔴 **폭을 애니메이션하지 않는다.** `whitespace-nowrap` 으로 폭을 고정해 두고 사이드바의
 * `overflow-hidden` 이 자른다 — 낱말이 접히거나 줄바꿈되는 순간이 없다.
 *
 * 🔴 **순서가 핵심이다.**
 * - 접을 때: 글자가 **먼저** 사라진다(100ms, 지연 없음). 폭은 200ms 에 걸쳐 줄어든다
 * - 펼칠 때: 폭이 **먼저** 열리고, 자리가 생긴 뒤 글자가 뜬다(`delay-150`)
 *
 * DOM 에서 지우지 않고 `opacity` 만 내리는 이유는 **접근성** 때문이다 — 링크의 이름이
 * 사라지면 스크린 리더가 「무엇으로 가는 링크인지」 읽을 수 없다.
 */
function NavLabel({
 collapsed,
 children,
}: {
 collapsed: boolean;
 children: React.ReactNode;
}) {
 return (
 <span
 className={cn(
 "min-w-0 flex-1 truncate whitespace-nowrap text-left transition-opacity ease-out motion-reduce:transition-none",
 // 🔴 좁은 폭에서는 고른 상태와 무관하게 사라진다. DOM 에서 지우지는 않는다 —
 // 링크의 이름이 사라지면 스크린 리더가 어디로 가는 링크인지 읽을 수 없다.
 "max-md:pointer-events-none max-md:opacity-0",
 collapsed
 ? "pointer-events-none opacity-0 duration-100"
 : "opacity-100 duration-150 delay-150",
)}
 >
 {children}
 </span>
);
}
