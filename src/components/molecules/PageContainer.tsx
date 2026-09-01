import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * 화면 하나가 차지하는 폭.
 *
 * 🔴 **화면마다 `max-w-*` 를 손으로 적지 않는다.** 값이 흩어지면 한 화면만 넓히는 순간
 * 나머지와 어긋나고, 어느 것이 의도이고 어느 것이 복붙인지 알 수 없게 된다.
 * **폭은 「이 화면이 무엇을 보여 주는가」로 정해지지, 파일마다 정해지지 않는다.**
 *
 * ## 세 결이 있다
 *
 * ```
 * wide 데이터를 «넓게 펴 놓고 비교»하는 화면 Dashboard · 목록 · Table 이 있는 상세
 * default 구조는 있지만 표가 주인공이 아닌 화면 Members · Settings
 * reading 사람이 «읽고 쓰는» 화면 Wiki 본문 · Wiki 편집
 * ```
 *
 * 🔴 **길어진 사용자 데이터를 「폭을 늘려서」 담으려 하지 마라.** Issue 제목 · Repository
 * 이름 · Pattern Key · Branch 는 얼마든지 길어질 수 있어서, 그것을 담으려고 페이지를 늘리면
 * 끝이 없다. 긴 값은 **열 안에서 잘라야 한다**(`components/ui/table.tsx` 의 `FLEX_CELL`,
 * `features/issues/components/issue-table-columns.ts`). 폭은 **화면의 성격**이 정하지
 * 데이터의 길이가 정하지 않는다.
 *
 * 그래서 한때 상한을 1760px 까지 열어 두었다가 되돌렸다 — 1920 화면에서 좌우 여백이 거의
 * 사라져 **제품 화면이 아니라 관리자용 DB 뷰어처럼** 보였다.
 */
export type PageWidth = "wide" | "default" | "reading";

/**
 * 🔴 **값의 근거를 여기 한 곳에 적는다.** 임의의 px 이 아니라 Tailwind 의 기존 단계를 쓴다 —
 * 화면마다 다른 숫자를 지어내면 그때부터 다시 갈라진다.
 *
 * - `wide` **`max-w-7xl` 1280px** — 예전 값(`max-w-6xl` 1152px)에서 **한 단계만** 올렸다.
 * 1152px 이 문제였던 이유는 「좁아서」가 아니라 **그 폭 안에서 열이 잘못 잡혀 있었기**
 * 때문이라, 폭은 한 단계면 충분하다. 1920 에서 좌우로 각 200px 가까이 남아
 * **화면 끝까지 퍼지지 않는다.** 1440 은 애초에 이 상한에 닿지 않아 그대로다
 * - `default` **`max-w-5xl` 1024px** — 폼과 2단 정의 목록의 화면. 여기서 `wide` 와
 * 비슷한 값을 주면 두 결을 나눈 의미가 없어진다. 🔴 Members·Settings 는 그동안
 * **상한이 아예 없어** 1920 에서 표가 1616px 로 늘어나 있었다 — 그쪽이 오히려 문제였다
 * - `reading` **`max-w-3xl` 768px** — 본문 글자(14px)로 한 줄 80자 안팎. Markdown 본문과
 * 그 본문을 쓰는 편집 폼이 **같은 폭**이라야 쓰면서 결과를 가늠할 수 있다
 */
const WIDTH: Record<PageWidth, string> = {
  wide: "max-w-7xl",
  default: "max-w-5xl",
  reading: "max-w-3xl",
};

/**
 * 화면 바깥 테두리.
 *
 * 🔴 **넓은 화면일수록 여백이 «더» 필요하다.** `xl` 부터 좌우를 32px 로 넓히는 것은,
 * 상한에 아직 닿지 않은 폭(1440·1600)에서 표가 사이드바와 창 끝에 바싹 붙는 것을 막기
 * 위해서다 — 상한만으로는 그 구간에 여백이 남지 않는다.
 */
export function PageContainer({
  width = "default",
  className,
  children,
}: {
  width?: PageWidth;
  /** 세로 간격 등 화면별 조정. 🔴 `max-w-*` 를 여기로 넘기지 않는다 — 그러면 다시 흩어진다. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-5 px-4 py-5 sm:px-6 sm:py-6 xl:px-8",
        WIDTH[width],
        className,
      )}
    >
      {children}
    </div>
  );
}
