"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CreateWorkspaceDialog } from "@/features/workspaces/components/CreateWorkspaceDialog";
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
}: {
  currentSlug: string;
  workspaces: readonly SwitcherWorkspace[];
}) {
  const pathname = usePathname();
  const section = currentSection(pathname);
  const current = workspaces.find((item) => item.slug === currentSlug);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-between font-medium"
        >
          <span className="truncate">{current?.name ?? currentSlug}</span>
          <ChevronsUpDown aria-hidden className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Workspace
        </DropdownMenuLabel>

        {workspaces.map((item) => {
          const active = item.slug === currentSlug;

          return (
            <DropdownMenuItem key={item.slug} asChild>
              <Link href={sectionHref(item.slug, section)}>
                <Check
                  aria-hidden
                  className={cn("size-3.5", active ? "opacity-100" : "opacity-0")}
                />
                <span className="truncate">{item.name}</span>
                {item.isPersonal && (
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    Personal
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
            trigger={
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start font-normal"
              >
                Workspace 만들기
              </Button>
            }
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
