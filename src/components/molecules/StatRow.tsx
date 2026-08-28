import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * KPI 묶음.
 *
 * 🔴 **똑같은 Card 를 넷 늘어놓지 않는다**(CLAUDE.md 16). 대신 **한 장의 표면 안에서
 * 세로선으로 나눈다** — 비교해야 할 숫자들이 한 덩어리로 묶여 눈이 가로로 흐른다.
 *
 * ```
 * ┌──────────┬──────────┬──────────┬──────────┐
 * │ Reviews  │ Issues   │ Resolved │ Open     │
 * │ 184      │ 427      │ 389      │ 38       │
 * │ 최근 30일 │ 최근 30일 │ 최근 30일 │ 현재      │
 * └──────────┴──────────┴──────────┴──────────┘
 * ```
 *
 * 계층은 셋이다 — **Label(작고 흐림) · 값(크고 진함) · Hint(가장 흐림).**
 * 값은 `tabular-nums` 로 자릿수를 맞춰 세로로 읽히게 한다.
 */
export interface Stat {
  label: string;
  /** 🔴 값이 없는 것과 0 은 다르다. 없으면 `—` 다 — 0 으로 그리면 거짓말이 된다. */
  value: number | string | null;
  /** 관찰 구간 등. 없으면 적지 않는다. */
  hint?: string;
  /** 의미가 있을 때만. 장식으로 넣지 않는다. */
  icon?: LucideIcon;
  /**
   * 이 값이 「나쁠수록 큰」 숫자인가.
   *
   * Open Issue 처럼 쌓이면 안 되는 값만 표시를 달리한다 — 🔴 색을 의미에만 쓴다.
   */
  tone?: "default" | "attention";
}

export function StatRow({ stats }: { stats: readonly Stat[] }) {
  return (
    <dl className="grid grid-cols-2 divide-x divide-y divide-border/70 overflow-hidden rounded-xl border border-border/80 bg-card shadow-[0_1px_2px_0_oklch(0_0_0/0.04)] sm:grid-cols-4 sm:divide-y-0">
      {stats.map((stat) => {
        const Icon = stat.icon;
        const attention = stat.tone === "attention" && stat.value !== 0;

        return (
          <div key={stat.label} className="flex flex-col gap-1 px-5 py-4">
            <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {Icon !== undefined && <Icon aria-hidden className="size-3.5" />}
              {stat.label}
            </dt>
            {/*
              🔴 **숫자와 «숫자가 아닌 값»을 같은 크기로 그리지 않는다.**

              날짜("2026-08-28")를 지표 숫자와 같은 26px 로 키우면, 비교할 값이 아닌 것이
              가장 크게 보여 KPI 줄의 균형이 깨진다. 실제 Repository 상세에서 그렇게 보였다.
              숫자는 크게, 그 밖의 값은 한 단계 작게 — 계층은 «무엇인가»를 따른다.
            */}
            <dd
              className={cn(
                "font-semibold leading-none tracking-tight tabular-nums",
                typeof stat.value === "number"
                  ? "text-[26px]"
                  : "text-lg break-words",
                attention ? "text-destructive" : "text-foreground",
              )}
            >
              {stat.value === null ? (
                <span className="text-muted-foreground/60">—</span>
              ) : (
                stat.value
              )}
            </dd>
            {stat.hint !== undefined && (
              <span className="text-[11px] text-muted-foreground/80">
                {stat.hint}
              </span>
            )}
          </div>
        );
      })}
    </dl>
  );
}
