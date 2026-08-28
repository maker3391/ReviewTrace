import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

/**
 * 화면 안의 한 영역.
 *
 * 🔴 **Card 로 감싸지 않는다**(CLAUDE.md 16). 영역 구분은 **제목의 굵기와 아래 divider**
 * 로 한다 — Card 를 쓰면 페이지에 상자가 여럿 떠 있는 느낌이 되고, 한 업무 화면으로
 * 이어지지 않는다.
 *
 * ```
 * Needs Attention                                    전체 보기
 * ──────────────────────────────────────────────────────────
 * HIGH   SMIL   Transaction Boundary
 * ```
 *
 * `description` 은 **없어도 읽히면 넘기지 않는다.** 설명을 습관적으로 붙이지 않는다.
 */
export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: { label: string; href: Route };
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col">
      <header className="flex items-baseline justify-between gap-3 border-b border-border pb-1.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {description !== undefined && (
            <span className="text-[11px] text-muted-foreground">
              {description}
            </span>
          )}
        </div>
        {action !== undefined && (
          <Link
            href={action.href}
            className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {action.label}
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

/**
 * 데이터가 없는 영역.
 *
 * 🔴 **Illustration 도 마케팅 문구도 두지 않는다**(CLAUDE.md 16). 한 줄이면 된다 —
 * 다만 「고장난 화면」과 구분되게 **왜 비어 있는지**는 말한다.
 */
export function SectionEmpty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-xs text-muted-foreground">{children}</p>;
}
