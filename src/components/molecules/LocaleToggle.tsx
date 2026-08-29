"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Check, Languages } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCALES, writeLocaleCookie, type Locale } from "@/config/i18n";
import { cn } from "@/lib/utils";

/**
 * 언어 전환.
 *
 * 🔴 **테마와 다르다 — 문구는 서버가 그린 것이다.** 조회 화면이 전부 Server Component 라
 * (CLAUDE.md 8) 브라우저에는 이미 그려진 글자만 있다. 쿠키를 쓴 뒤 `router.refresh()` 로
 * **서버가 다시 그리게** 한다 — 사전을 브라우저로 내려 글자를 갈아 끼우지 않는다.
 *
 * `router.refresh()` 는 전체 새로고침이 아니라 지금 화면의 Server Component 만 다시
 * 그린다. 스크롤과 열려 있던 상태가 그대로 남는다.
 */
export function LocaleToggle({
  locale: currentLocale,
  labels,
}: {
  /** 🔴 서버가 쿠키에서 읽어 넘긴 첫 상태. */
  locale: Locale;
  labels: {
    language: string;
    ko: string;
    en: string;
  };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function select(next: Locale) {
    if (next === currentLocale) {
      return;
    }

    writeLocaleCookie(next);
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={labels.language}
          disabled={isPending}
          className="text-muted-foreground hover:text-foreground"
        >
          <Languages aria-hidden className="size-[18px]" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {labels.language}
        </DropdownMenuLabel>
        {LOCALES.map((option) => (
          <DropdownMenuItem
            key={option}
            onSelect={() => {
              select(option);
            }}
          >
            <span className="flex-1">{labels[option]}</span>
            <Check
              aria-hidden
              className={cn(
                "size-3.5",
                option === currentLocale ? "opacity-100" : "opacity-0",
              )}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
