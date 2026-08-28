"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

import {
  WorkspaceSwitcher,
  type SwitcherWorkspace,
} from "@/components/organisms/WorkspaceSwitcher";
import { readProjectSlugFromPath } from "@/config/routes";
import {
  PROJECT_ITEMS,
  projectSectionHref,
  sectionHref,
  WORKSPACE_FOOTER_ITEMS,
  WORKSPACE_ITEMS,
} from "@/config/navigation";
import { cn } from "@/lib/utils";

/**
 * 좌측 내비게이션.
 *
 * Client Component 인 이유는 하나다 — 현재 경로에 따라 활성 항목이 달라진다.
 * 항목 목록 자체는 `config/navigation.ts` 한 곳에서 온다(CLAUDE.md 11).
 *
 * ## 세 계층이 눈으로 갈려야 한다 (CLAUDE.md 16)
 *
 * ```
 * [ CodeApex ▼ ]     Workspace Switcher — Tenant
 * Dashboard / Projects / Knowledge
 * ──────────
 * SMIL               현재 Project — Context
 * Overview / Reviews / Issues / Knowledge / Repositories
 * ──────────
 * Members / Settings 가끔 여는 것
 * ```
 *
 * 🔴 **모든 메뉴를 같은 강도로 그리지 않는다.** Project 이름은 라벨이 아니라 **머리글**이고,
 * 그 아래 항목은 들여쓴다 — 그래야 「지금 어느 Project 안에 있는가」가 읽힌다.
 *
 * 🔴 **Sidebar 안에 Badge·Card·Box 를 두지 않는다.** 구분은 그룹과 divider 로 한다.
 *
 * 🔴 **Icon 을 붙이지 않는다.** 낱말 앞의 아이콘은 정보를 더하지 않고 시선만 나눈다.
 */
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
      className="flex w-52 shrink-0 flex-col border-r border-border bg-sidebar p-2"
    >
      <div className="mb-3">
        <WorkspaceSwitcher currentSlug={currentSlug} workspaces={workspaces} />
      </div>

      <ul className="flex flex-col gap-px">
        {WORKSPACE_ITEMS.map((item) => (
          <NavLink
            key={item.key}
            href={sectionHref(currentSlug, item.section)}
            label={item.label}
            pathname={pathname}
          />
        ))}
      </ul>

      {currentProject !== null && (
        <>
          <Divider />
          {/*
            Project 이름은 «머리글»이다 — 링크 목록의 한 줄로 두면 Overview 와 구분되지 않는다.
          */}
          <p className="truncate px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-foreground">
            {currentProject.name}
          </p>
          <ul className="flex flex-col gap-px">
            {PROJECT_ITEMS.map((item) => (
              <NavLink
                key={item.key}
                href={projectSectionHref(
                  currentSlug,
                  currentProject.slug,
                  item.section,
                )}
                label={item.label}
                pathname={pathname}
                // Overview 는 Project 자신이라 접두 일치로 보면 모든 하위 화면에서 활성이 된다.
                exact={item.section === ""}
              />
            ))}
          </ul>
        </>
      )}

      <Divider className="mt-auto" />

      <ul className="flex flex-col gap-px">
        {WORKSPACE_FOOTER_ITEMS.map((item) => (
          <NavLink
            key={item.key}
            href={sectionHref(currentSlug, item.section)}
            label={item.label}
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
      className={cn("my-3 border-t border-border/70", className)}
    />
  );
}

/**
 * 항목 한 줄.
 *
 * 활성 판정은 **접두 일치**가 기본이다 — `/issues/123` 에서도 Issues 가 켜져야 한다.
 * 다만 Project Overview 는 그 Project 의 모든 주소의 접두라서 `exact` 로 잠근다.
 */
function NavLink({
  href,
  label,
  pathname,
  exact = false,
  muted = false,
}: {
  href: Route;
  label: string;
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
          "block rounded-sm px-2 py-1 text-sm transition-colors",
          active
            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
            : muted
              ? "text-muted-foreground/80 hover:bg-sidebar-accent/50 hover:text-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
        )}
      >
        {label}
      </Link>
    </li>
  );
}
