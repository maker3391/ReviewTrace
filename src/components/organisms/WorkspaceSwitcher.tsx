"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  CreateWorkspaceDialog,
  type CreateWorkspaceLabels,
} from "@/features/workspaces/components/CreateWorkspaceDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { currentSection, sectionHref } from "@/config/navigation";
import { cn } from "@/lib/utils";

/**
 * Workspace Switcher.
 *
 * 🔴 **전환은 Route 변경이지 재로그인이 아니다**(스펙 12). 세션은 그대로 두고 주소의
 * Workspace Context 만 바꾼다 — 그래서 그냥 `<Link>` 다. 세션을 다시 만들거나 서버에
 * 「현재 Workspace」를 저장하지 않는다.
 *
 * **보고 있던 Section 을 유지한다.** Issues 에서 전환하면 상대 Workspace 의 Issues 로 간다.
 * 화면이 없는 Section 이면 `currentSection` 이 Dashboard 로 떨어뜨린다.
 *
 * 🔴 목록은 **서버가 소속을 확인해 넘긴 것**이다. 이 Component 는 그것을 그리기만 한다 —
 * 여기서 목록을 만들거나 늘리지 않는다.
 */
export interface SwitcherWorkspace {
  slug: string;
  name: string;
  isPersonal: boolean;
}

export function WorkspaceSwitcher({
  currentSlug,
  workspaces,
  collapsed = false,
  labels,
}: {
  currentSlug: string;
  workspaces: readonly SwitcherWorkspace[];
  /** 접힌 사이드바에서는 아바타만 남는다 — 이름을 좁은 폭에 욱여넣지 않는다. */
  collapsed?: boolean;
  /** 🔴 이 Component 가 실제로 그리는 낱말만 받는다. */
  labels: {
    workspaceLabel: string;
    personal: string;
    createWorkspace: string;
    dialog: CreateWorkspaceLabels;
  };
}) {
  const pathname = usePathname();
  const section = currentSection(pathname);
  const current = workspaces.find((item) => item.slug === currentSlug);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="lg"
          /*
 🔴 접힐 때 **폭·정렬·padding 을 바꾸지 않는다.**

 `px-0 justify-center` 로 바꾸면 남아 있는 gap 과 `size-3.5` 가 서로 밀어
 아바타가 눌리고 잘린다. 대신 padding 을 고정하고 `overflow-hidden` 이
 넘치는 것을 자르게 둔다 — 아바타는 `shrink-0` 이라 항상 24px 정사각이다.

 접힌 폭 계산: nav px-2(8) + button px-2(8) + 아바타 24 = 40 = w-14 안쪽 폭.
 메뉴 Icon 의 왼쪽 offset 과도 같아 접고 펼칠 때 좌우로 튀지 않는다.
 */
          /*
 🔴 **`hover:bg-card` 였다 — 그것이 hover 를 «없앴다».** tailwind-merge 가
 outline variant 의 `hover:bg-muted` 를 같은 속성이라고 걷어내는데, 남은 값이
 바탕색(`bg-card`)과 같아 밝은 테마에서는 아무 변화도 일어나지 않았다.
 Tenant 를 바꾸는 자리인데 눌러도 되는 곳인지 알 수 없었다.

 🔴 **새 색을 만들지 않는다** — 사이드바가 이미 쓰는 `sidebar-accent` 다
 (접기 버튼·NavLink 와 같은 톤). 두 테마 모두 같은 토큰으로 잠가,
 outline variant 의 `dark:hover:bg-input/50` 이 dark 에서만 다른 색으로
 갈라지는 것도 함께 막는다.
 */
          className="h-11 w-full justify-start gap-2 overflow-hidden border-sidebar-border bg-card px-2 font-medium hover:bg-sidebar-accent/60 dark:hover:bg-sidebar-accent/60"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {/*
 Workspace 이니셜. 🔴 Badge 가 아니라 «신원 표시»다 — Tenant 를 바꾸는 자리라
 이름만 있는 것보다 눈에 먼저 잡힌다.
 */}
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[11px] font-semibold text-primary">
              {(current?.name ?? currentSlug).trim().charAt(0).toUpperCase()}
            </span>
            {/*
 🔴 이름과 화살표는 «폭이 아니라 opacity» 로 사라진다. 폭을 줄이면 글자가
 접혀 보인다 — 사이드바의 overflow 가 자르게 두고 먼저 흐려지게 한다.
 */}
            <span
              className={cn(
                "truncate whitespace-nowrap text-[13px] transition-opacity ease-out motion-reduce:transition-none",
                // 🔴 좁은 폭에서는 아이콘 폭만 남는다 — 이름은 고른 상태와 무관하게 사라진다.
                "max-md:pointer-events-none max-md:opacity-0",
                collapsed
                  ? "pointer-events-none opacity-0 duration-100"
                  : "opacity-100 duration-150 delay-150",
              )}
            >
              {current?.name ?? currentSlug}
            </span>
          </span>
          <ChevronsUpDown
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 opacity-50 transition-opacity ease-out motion-reduce:transition-none",
              "max-md:opacity-0",
              collapsed ? "opacity-0 duration-100" : "duration-150 delay-150",
            )}
          />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {labels.workspaceLabel}
        </DropdownMenuLabel>

        {workspaces.map((item) => {
          const active = item.slug === currentSlug;

          return (
            <DropdownMenuItem key={item.slug} asChild>
              <Link href={sectionHref(item.slug, section)}>
                <Check
                  aria-hidden
                  className={cn(
                    "size-3.5",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="truncate">{item.name}</span>
                {item.isPersonal && (
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {labels.personal}
                  </span>
                )}
              </Link>
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator />
        {/*
 🔴 Dialog 를 DropdownMenuItem 안에 두지 않는다 — 메뉴가 닫히면서 Dialog 도 함께
 사라진다. 메뉴 밖의 항목으로 두고 Trigger 만 메뉴 폭에 맞춘다.
 */}
        <div className="px-1 py-0.5">
          <CreateWorkspaceDialog
            labels={labels.dialog}
            trigger={
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start font-normal"
              >
                {labels.createWorkspace}
              </Button>
            }
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
