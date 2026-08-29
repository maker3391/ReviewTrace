/**
 * 🔴 **`"use client"` 를 걷어냈다 — 그것이 열이 뭉개진 «진짜» 원인이었다.**
 *
 * 이 파일에는 Hook 도 Event Handler 도 없다(shadcn 이 기본으로 붙여 주는 지시어였다).
 * 그런데 `"use client"` 가 붙어 있으면 Next 는 이 모듈의 **모든 export** 를 Client
 * Reference Proxy 로 바꾼다. Component 는 그래도 되지만 **문자열 상수는 그렇지 않다** —
 * Server Component 에서 읽으면 진짜 문자열이 아니라 Proxy 객체가 온다.
 *
 * ```
 * className={FLEX_CELL}        Proxy 가 «prop 으로» 경계를 건너가 Client 에서 풀린다  → 동작함
 * cn(FLEX_CELL, "...")         Server 에서 «지금» 값을 읽는다 → clsx 가 객체를 보고 버린다 → 사라짐
 * ```
 *
 * 그래서 Reviews·Repositories 목록과 Project Dashboard 처럼 `cn(FLEX_CELL, …)` 로 쓴
 * 자리에서는 **`w-full max-w-0` 이 애초에 붙은 적이 없었다.** 오류도 경고도 없이 조용히
 * 빠지고, 좁은 화면에서 그 칸이 45~55px 로 뭉개져서야 드러났다. 컴파일된 chunk 에
 * 「… is on the client. It's not possible to …」가 실제로 들어 있는 것으로 확인했다.
 */

import * as React from "react"

import { cn } from "@/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("bg-surface-muted/60 [&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-border/60 transition-colors last:border-0 hover:bg-accent/40 has-aria-expanded:bg-accent/40 data-[state=selected]:bg-accent/60",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-9 px-3 text-left align-middle text-[11px] font-medium uppercase tracking-wide whitespace-nowrap text-muted-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-3 py-2.5 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * 「남는 폭을 전부 가져가는」 칸.
 *
 * 🔴 **표에서 제목·이름·경로 칸에 `max-w-md` 같은 값을 박지 마라.** 그것은 상한이라,
 * 화면이 아무리 넓어져도 그 칸은 448px 에서 잘린다 — 바깥에 500px 이 남는데 제목만
 * 「…」로 끝나는 화면이 실제로 그렇게 나왔다(`components/molecules/PageContainer.tsx`).
 *
 * ```
 * max-w-0   이 칸의 «내용»이 열을 밀어내지 못하게 한다 — 긴 식별자 하나가 표를 넓히지 않는다
 * w-full    그러고 남은 폭을 이 칸이 가져간다
 * ```
 *
 * 둘을 함께 걸면 **다른 열은 제 폭대로 서고, 남는 자리는 전부 이 칸**이 된다.
 * 안쪽 글자에 `truncate` 를 걸어 두면 그 폭에 맞춰 잘리고, 전문은 `title` 로 확인한다.
 *
 * 열 폭 자체를 머리 행이 정해야 하는 표(Issue 목록)는 이것이 아니라 `table-fixed` 를 쓴다 —
 * `features/issues/components/issue-table-columns.ts` 에 그 이유가 있다.
 */
const FLEX_CELL = "w-full max-w-0"

/**
 * 「남는 폭을 가져가되 **바닥이 있는**」 칸 — 그 행이 무엇인지 말하는 «식별자» 자리.
 *
 * 🔴 **`FLEX_CELL` 에는 바닥이 없다. 좁은 화면에서 그것이 문제가 된다.**
 *
 * `max-w-0` 은 이 칸의 min-content 를 0 으로 만든다. 컨테이너가 표의 자연 폭보다 좁아지면
 * 브라우저는 **줄일 수 있는 칸부터 줄이므로** 고정 폭 열은 그대로 두고 이 칸만 뭉갠다.
 * 390px 에서 실측한 값이다 — Review 상세·Repository 상세의 **제목 칸이 45px**,
 * Reviews·Repositories 목록의 **저장소 칸이 55px** 이 되어 `maker3391/code-intelligence`
 * 가 한 글자씩 일곱 줄로 접혔다. 표는 컨테이너 안에 «들어갔고», 그래서 `overflow-x-auto`
 * 는 아무 일도 하지 않았다 — **읽을 수 없게 만드는 대가로** 들어간 것이다.
 *
 * ## 🔴 `min-w-32`(128px)은 «재어서» 나온 값이다
 *
 * 처음에는 160px(`min-w-40`)이었다. 390 은 살렸지만 **768 에서 없던 가로 스크롤이 생겼다** —
 * 그 폭에서는 컨테이너가 462px 뿐이라 32px 이 그대로 넘침이 된다. 실측(2026-08-29,
 * 실제 데이터·실제 브라우저)으로 두 폭을 함께 만족하는 값을 찾았다.
 *
 * **390 — 이 칸의 바닥이 실제로 일하는 폭.** 줄바꿈하는 식별자(Reviews·Repositories 목록의
 * `owner/name`, `break-all`)의 **줄 수가 꺾이는 자리가 128px** 이다. 그 아래로는 줄이 는다.
 *
 * ```
 * 바닥 없음   55px   Reviews 132px 높이(8줄) · Repositories 160px(10줄)   ← 원래의 고장
 * 96 · 112    그대로  Reviews  68px          · Repositories  80px
 * 128         ✔      Reviews  52px          · Repositories  60px
 * 144 · 160   같음    Reviews  52px          · Repositories  60px         ← 32px 을 더 써도 얻는 것이 없다
 * ```
 *
 * 잘라내는 식별자(제목·이름, `truncate`)는 **폭이 줄어도 줄 수가 늘지 않는다** — 보이는
 * 글자 수만 준다. 그래서 바닥은 「줄이 접히기 시작하는」 쪽이 정한다.
 *
 * **768 — 32px 을 되돌려 받는다.**
 *
 * ```
 *                       160px      128px
 * Project Overview      +23  →      0
 * Projects              +43  →     +11
 * Reviews               +70  →     +38
 * Repositories · Dashboard  0 →      0     (자연 폭이 이미 바닥보다 넓다)
 * ```
 *
 * **1024 이상에서는 이 값이 아무 일도 하지 않는다** — 남는 폭이 바닥보다 넓어 `w-full` 이
 * 먼저 이긴다(실측: 0~160px 어느 값이든 결과가 같다).
 *
 * 🔴 **여기서 더 낮추지 마라.** 112px 로 내리면 768 의 Projects 만 11px 을 얻는 대신
 * **390 에서 저장소 이름이 다시 한 줄 더 접힌다**(52 → 68px). 그것이 원래 고치려던 문제다.
 * 바닥에 닿으면 **표만** 제 컨테이너 안에서 가로로 넘어간다 — 그것은 의도된 동작이고,
 * 🔴 **페이지 자체는 좌우로 넘치지 않는다**(CLAUDE.md 16). 실제로 모든 폭에서 `<main>` 의
 * 넘침은 0 이다.
 *
 * 🔴 **모든 `FLEX_CELL` 을 이것으로 바꾸지 마라.** 남는 폭을 «흡수만» 하는 칸
 * (API Key 표의 오른쪽 Action 열처럼 내용이 없는 자리)에 바닥을 주면, 아무것도 없는
 * 128px 때문에 표가 그만큼 더 넓어져 가로 스크롤이 «없어도 될 때» 생긴다.
 */
const NAME_CELL = `${FLEX_CELL} min-w-32`

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  FLEX_CELL,
  NAME_CELL,
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
