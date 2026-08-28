"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import {
  BookText,
  Boxes,
  Bug,
  FolderGit2,
  LayoutDashboard,
  ListChecks,
  Settings,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";

import {
  WorkspaceSwitcher,
  type SwitcherWorkspace,
} from "@/components/organisms/WorkspaceSwitcher";
import {
  PROJECT_ITEMS,
  projectSectionHref,
  sectionHref,
  WORKSPACE_FOOTER_ITEMS,
  WORKSPACE_ITEMS,
} from "@/config/navigation";
import { readProjectSlugFromPath } from "@/config/routes";
import { cn } from "@/lib/utils";

/**
 * 좌측 내비게이션.
 *
 * Client Component 인 이유는 하나다 — 현재 경로에 따라 활성 항목이 달라진다.
 * 항목 목록 자체는 `config/navigation.ts` 한 곳에서 온다(CLAUDE.md 11).
 *
 * ## 세 계층이 눈으로 갈려야 한다
 *
 * ```
 * [ CodeApex ▼ ]     Workspace Switcher — Tenant
 * Dashboard / Projects / Knowledge
 * ──────────
 * PROJECT            머리글 (지금 어느 Project 안인가)
 * SMIL
 *   Overview / Reviews / Issues / Knowledge / Repositories / Settings
 * ──────────
 * Members / Settings 가끔 여는 것
 * ```
 *
 * 🔴 **모든 메뉴를 같은 강도로 그리지 않는다.** 활성 항목은 **배경 + 굵기 + Icon 색** 셋으로
 * 드러내되 **강한 색을 넓게 깔지 않는다** — 옅은 브랜드 톤이면 충분하다(CLAUDE.md 16).
 *
 * 🔴 **Sidebar 안에 Badge·Card 를 두지 않는다.** 구분은 그룹·머리글·divider 로 한다.
 */

/**
 * 메뉴 키 ↔ Icon.
 *
 * 🔴 Icon 은 `config/navigation.ts` 가 아니라 **여기** 있다. 그 파일은 Proxy·시험도 읽는
 * 순수 대응표라, React 전용 의존(`lucide-react`)을 끌어들이면 안 된다.
 */
const WORKSPACE_ICONS: Record<string, LucideIcon> = {
  DASHBOARD: LayoutDashboard,
  PROJECTS: Boxes,
  KNOWLEDGE: BookText,
  MEMBERS: Users,
  SETTINGS: Settings,
};

const PROJECT_ICONS: Record<string, LucideIcon> = {
  OVERVIEW: LayoutDashboard,
  REVIEWS: ListChecks,
  ISSUES: Bug,
  KNOWLEDGE: BookText,
  REPOSITORIES: FolderGit2,
  SETTINGS: SlidersHorizontal,
};

export function AppSidebar({
  currentSlug,
  workspaces,
  projects,
}: {
  currentSlug: string;
  workspaces: readonly SwitcherWorkspace[];
  /**
   * 이 Workspace 의 Project 목록.
   *
   * 🔴 **서버가 소속을 확인해 넘긴 것이다.** 이 Component 는 그중 «지금 주소가 가리키는
   * 것»을 고를 뿐, 목록을 만들거나 늘리지 않는다(CLAUDE.md 11).
   */
  projects: readonly { slug: string; name: string }[];
}) {
  const pathname = usePathname();

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

  return (
    <nav
      aria-label="주요 메뉴"
      className="flex w-60 shrink-0 flex-col gap-1 border-r border-sidebar-border bg-sidebar px-3 py-3"
    >
      <div className="mb-2">
        <WorkspaceSwitcher currentSlug={currentSlug} workspaces={workspaces} />
      </div>

      <ul className="flex flex-col gap-0.5">
        {WORKSPACE_ITEMS.map((item) => (
          <NavLink
            key={item.key}
            href={sectionHref(currentSlug, item.section)}
            label={item.label}
            icon={WORKSPACE_ICONS[item.key]}
            pathname={pathname}
          />
        ))}
      </ul>

      {currentProject !== null && (
        <>
          <Divider />
          {/*
            Project 이름은 «머리글»이다 — 링크 목록의 한 줄로 두면 Overview 와 구분되지 않는다.
            위의 작은 라벨이 「지금 Project Context 안에 있다」를 말한다.
          */}
          <div className="px-2 pb-1.5 pt-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Project
            </p>
            <p className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
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
                label={item.label}
                icon={PROJECT_ICONS[item.key]}
                pathname={pathname}
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
            label={item.label}
            icon={WORKSPACE_ICONS[item.key]}
            pathname={pathname}
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
 * 항목 한 줄.
 *
 * 활성 판정은 **접두 일치**가 기본이다 — `/issues/123` 에서도 Issues 가 켜져야 한다.
 * 다만 Project Overview 는 그 Project 의 모든 주소의 접두라서 `exact` 로 잠근다.
 *
 * 활성 표시는 셋이 함께 움직인다 — 배경 · 글자 굵기 · Icon 색. 하나만 바꾸면 약하고,
 * 색을 진하게 깔면 사이드바가 먼저 눈에 들어온다.
 */
function NavLink({
  href,
  label,
  icon: Icon,
  pathname,
  exact = false,
  muted = false,
}: {
  href: Route;
  label: string;
  icon?: LucideIcon;
  pathname: string;
  exact?: boolean;
  muted?: boolean;
}) {
  const active = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors duration-150",
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
              "size-4 shrink-0 transition-colors",
              active
                ? "text-sidebar-primary"
                : "text-muted-foreground/70 group-hover:text-muted-foreground",
            )}
          />
        )}
        <span className="truncate">{label}</span>
      </Link>
    </li>
  );
}
