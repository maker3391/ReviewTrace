"use client";

import { useEffect, useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  applyTheme,
  THEMES,
  writeThemeCookie,
  type Theme,
} from "@/lib/ui/theme";
import { cn } from "@/lib/utils";

/**
 * 테마 전환.
 *
 * Client Component 인 이유는 하나다 — **누르는 즉시 화면이 바뀌어야 한다.** 서버 왕복을
 * 기다리면 색이 한 박자 늦게 따라온다. 조회한 데이터는 하나도 달라지지 않으므로
 * `router.refresh()` 를 부르지 않는다(언어 전환과 다른 점이다).
 *
 * 🔴 **첫 상태는 서버가 준다.** 쿠키를 클라이언트에서 읽어 `useEffect` 로 맞추면
 * 새로고침마다 밝은 화면이 한 번 번쩍인다 — `lib/ui/theme.ts` 머리말 참고.
 *
 * 🔴 **문구는 prop 으로 받는다.** 사전 전체를 넘기면 화면이 쓰지도 않는 문구까지
 * RSC payload 로 나간다(CLAUDE.md 11).
 */
export function ThemeToggle({
  theme: initialTheme,
  labels,
}: {
  /** 🔴 서버가 쿠키에서 읽어 넘긴 첫 상태. */
  theme: Theme;
  labels: {
    theme: string;
    light: string;
    dark: string;
    system: string;
  };
}) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  /**
   * `system` 을 고른 사람만 OS 를 따라간다.
   *
   * 🔴 **첫 페인트는 여기서 맞추지 않는다.** 그 일은 `<body>` 맨 앞의 동기 스크립트가
   * 이미 끝냈다(`SYSTEM_THEME_SCRIPT`). 이 Effect 가 맡는 것은 **보고 있는 동안 OS 설정이
   * 바뀌는 경우**뿐이다 — 없으면 「시스템」이 새로고침해야만 듣는 말이 된다.
   */
  useEffect(() => {
    if (theme !== "system") {
      return;
    }

    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      applyTheme("system");
    };

    query.addEventListener("change", sync);
    return () => {
      query.removeEventListener("change", sync);
    };
  }, [theme]);

  function select(next: Theme) {
    setTheme(next);
    applyTheme(next);
    // 다음 요청부터는 서버가 이 값으로 그린다 — 새로고침해도 깜빡이지 않는다.
    writeThemeCookie(next);
  }

  const Icon = ICONS[theme];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={labels.theme}
          className="text-muted-foreground hover:text-foreground"
        >
          <Icon aria-hidden className="size-[18px]" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {labels.theme}
        </DropdownMenuLabel>
        {THEMES.map((option) => {
          const OptionIcon = ICONS[option];

          return (
            <DropdownMenuItem
              key={option}
              onSelect={() => {
                select(option);
              }}
            >
              <OptionIcon aria-hidden className="size-3.5" />
              <span className="flex-1">{labels[option]}</span>
              <Check
                aria-hidden
                className={cn(
                  "size-3.5",
                  option === theme ? "opacity-100" : "opacity-0",
                )}
              />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 고른 값이 아이콘만으로 읽혀야 한다 — 해·달·화면. */
const ICONS = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} as const;
