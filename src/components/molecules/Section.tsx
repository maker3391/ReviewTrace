import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * 화면 안의 한 영역.
 *
 * ## 두 가지 결이 있다
 *
 * ```
 * variant="plain" 제목 + 아래 divider. 흐름 안의 소제목
 * variant="raised" 올라온 표면(카드). 목록·요약처럼 «덩어리»로 읽히는 것
 * ```
 *
 * 🔴 **둘 중 하나로 통일하지 않는다.** 전부 카드면 페이지에 상자가 떠다니고, 전부 평면이면
 * 흰 바탕에 회색 선만 이어진다. **덩어리로 읽혀야 하는 것만 올린다**.
 *
 * `description` 은 **없어도 읽히면 넘기지 않는다.** 설명을 습관적으로 붙이지 않는다.
 */
export function Section({
  title,
  description,
  action,
  actions,
  variant = "plain",
  tone = "default",
  emphasis = false,
  bleed = false,
  children,
}: {
  title?: string;
  description?: string;
  action?: { label: string; href: Route };
  /** 버튼처럼 링크가 아닌 것. `action` 과 함께 쓰지 않는다. */
  actions?: ReactNode;
  variant?: "plain" | "raised";
  /**
   * **긴 서술(Markdown 문서)을 담는 영역인가.**
   *
   * 🔴 **새 디자인이 아니라 «층»을 하나 되찾는 스위치다.** 이 영역의 본문은
   * `MarkdownView` 가 그리는 문서이고, 그 문서에는 자기 heading 계단이 있다
   * (`##` 15px · `###` 14px · `####` 12px). 기본 section 제목은 13px 이라
   * **문서 안 heading 이 자기를 담은 section 제목보다 커진다** — 부모와 자식이
   * 뒤집혀 화면이 평평해 보이던 자리다.
   *
   * 그래서 이 tone 은 두 가지만 바꾼다.
   *
   * - 제목을 `text-base`(16px)로 올려 문서의 가장 큰 heading(15px) 위에 세운다
   * - 머리에 옅은 면(`--surface-muted`)을 깔아 **본문과 «다른 층»**임을 보인다
   *
   * 🔴 **크기 1px 차이에 기대지 않는다.** 층을 만드는 것은 면이다 — 제목은 카드
   * 머리의 면 위에 있고 문서 heading 은 카드 본문 위에 있다. 훑는 눈이 먼저 보는
   * 것은 글자 크기가 아니라 그 경계다.
   *
   * 🔴 **eyebrow 라벨을 새로 만들지 않았다.** 재사용할 기존 용어가 없어 영어 낱말을
   * 지어내야 했고, 그것은 화면에 없던 어휘를 더하는 일이다. badge 도 두지 않는다 —
   * 이 자리에 필요한 것은 이름이 아니라 경계다.
   */
  tone?: "default" | "narrative";
  /**
   * 이 화면에서 **먼저 봐야 하는** 영역.
   *
   * 🔴 **다른 디자인을 입히는 스위치가 아니다.** 테두리 · 그림자 · 제목 크기를 **각각 한
   * 단계씩만** 올린다 — 색을 더하지 않고, 배경도 바꾸지 않는다. 여섯 카드가 전부 같은
   * 무게라 스크롤할 때 무엇을 먼저 볼지가 드러나지 않던 자리를 위한 것이다
   * (Project Overview 의 「미해결 이슈」).
   *
   * 🔴 **한 화면에 두 개 이상 쓰지 마라.** 전부 강조하면 아무것도 강조되지 않는다.
   */
  emphasis?: boolean;
  /**
   * 내용이 표(Table)처럼 **가장자리까지 차는** 경우.
   * 안쪽 여백을 지워 표의 첫 칸이 카드 모서리에 맞물리게 한다.
   */
  bleed?: boolean;
  children: ReactNode;
}) {
  const header =
    title === undefined ? null : (
      <header
        className={cn(
          "flex items-start justify-between gap-3",
          variant === "raised"
            ? "border-b border-border/70 px-5 py-3.5"
            : "pb-2",
          // 🔴 서술 영역의 머리만 옅은 면 위에 세운다 — 본문과 층을 가른다.
          variant === "raised" && tone === "narrative" && "bg-surface-muted/40",
        )}
      >
        <div className="min-w-0">
          <h2
            className={cn(
              "font-semibold tracking-tight text-foreground",
              tone === "narrative"
                ? "text-base"
                : emphasis
                  ? "text-sm"
                  : "text-[13px]",
            )}
          >
            {title}
          </h2>
          {description !== undefined && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {action !== undefined && (
          <Link
            href={action.href}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {action.label}
          </Link>
        )}
        {actions}
      </header>
    );

  if (variant === "raised") {
    return (
      <section
        className={cn(
          "overflow-hidden rounded-xl bg-card",
          emphasis
            ? "border border-border shadow-[0_1px_2px_0_oklch(0_0_0/0.05),0_2px_6px_-1px_oklch(0_0_0/0.06)]"
            : "border border-border/80 shadow-[0_1px_2px_0_oklch(0_0_0/0.04),0_1px_3px_0_oklch(0_0_0/0.03)]",
        )}
      >
        {header}
        <div className={cn(bleed ? "" : "px-5 py-4")}>{children}</div>
      </section>
    );
  }

  return (
    <section className="flex flex-col">
      {/* 평면 결에서는 제목 아래 선 하나가 영역을 가른다 — 상자를 만들지 않는다. */}
      {title !== undefined && (
        <div className="border-b border-border">{header}</div>
      )}
      {children}
    </section>
  );
}

/**
 * 데이터가 없는 영역.
 *
 * 🔴 **거대한 Illustration 도 마케팅 문구도 두지 않는다**.
 * 아이콘 하나 · 짧은 제목 · 필요할 때만 한 줄 설명 · 필요할 때만 CTA. 그게 전부다.
 *
 * 다만 「고장난 화면」과 구분되게 **왜 비어 있는지**는 말한다.
 */
export function SectionEmpty({
  icon,
  title,
  children,
  action,
}: {
  /** 의미가 있을 때만. 장식으로 넣지 않는다. */
  icon?: ReactNode;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-9 text-center">
      {icon !== undefined && (
        <div className="flex size-9 items-center justify-center rounded-lg bg-surface-muted text-muted-foreground">
          {icon}
        </div>
      )}
      {title !== undefined && (
        <p className="text-sm font-medium text-foreground">{title}</p>
      )}
      {children !== undefined && (
        <p className="max-w-sm text-xs text-muted-foreground">{children}</p>
      )}
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
}
