"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  WorkspaceSwitcher,
  type SwitcherWorkspace,
} from "@/components/organisms/WorkspaceSwitcher";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NAVIGATION_ITEMS, sectionHref } from "@/config/navigation";
import { cn } from "@/lib/utils";

/**
 * 좌측 내비게이션.
 *
 * Client Component 인 이유는 하나다 — 현재 경로에 따라 활성 항목이 달라진다.
 * 항목 목록 자체는 `config/navigation.ts` 한 곳에서 온다(CLAUDE.md 11).
 *
 * 모든 링크는 현재 Workspace 안의 Section 이다(`/w/{slug}/{section}`).
 */
export function AppSidebar({
  currentSlug,
  workspaces,
}: {
  currentSlug: string;
  workspaces: readonly SwitcherWorkspace[];
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="주요 메뉴"
      className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-border bg-sidebar p-2"
    >
      <div className="mb-2">
        <WorkspaceSwitcher currentSlug={currentSlug} workspaces={workspaces} />
      </div>

      {NAVIGATION_ITEMS.map((item) => {
        const Icon = item.icon;

        if (!item.ready) {
          // 아직 화면이 없는 항목은 링크로 만들지 않는다 — 눌러서 404 를 만나게 두지 않는다.
          return (
            <Tooltip key={item.key}>
              <TooltipTrigger asChild>
                <span
                  aria-disabled
                  className="flex cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground/50"
                >
                  <Icon aria-hidden className="size-4" />
                  {item.label}
                </span>
              </TooltipTrigger>
              <TooltipContent side="right">아직 구현되지 않았다</TooltipContent>
            </Tooltip>
          );
        }

        const href = sectionHref(currentSlug, item.section);
        const active = pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={item.key}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
              active
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <Icon aria-hidden className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
