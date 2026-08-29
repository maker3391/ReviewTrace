import { LoaderCircleIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * 진행 중 표시.
 *
 * 🔴 **버튼의 이름표를 갈아 끼우지 않기 위해 있는 것이다.** `삭제 중` · `폐기 중` 처럼
 * label 을 바꾸면 **누른 것이 무엇이었는지가 사라진다** — 사용자는 지금 무엇이 실행 중인지
 * 알아야 하고, 그 답은 label 에 있다. 대신 label 앞에 이것을 세운다.
 *
 * ```
 * 좋음  [spinner] 폐기
 * 나쁨  폐기 중
 * ```
 *
 * 🔴 **색을 정하지 않는다.** lucide icon 은 `currentColor` 로 그려지므로 `destructive`
 * 버튼 안에서는 destructive 색, `default` 버튼 안에서는 그 색으로 저절로 따라간다 —
 * 화면마다 색을 적으면 버튼 variant 를 바꿀 때마다 이 자리도 함께 틀어진다.
 *
 * 🔴 **크기도 정하지 않는다.** `Button` 이 이미 크기별로
 * `[&_svg:not([class*='size-'])]:size-*` 를 갖고 있어(`components/ui/button.tsx`)
 * `sm` 버튼 안에서는 3.5, 기본 버튼 안에서는 4로 선다. 여기서 `size-4` 를 박으면
 * 그 규칙을 **가려** 작은 버튼 안에서만 아이콘이 커진다.
 *
 * 화면 전체를 덮는 Loading 은 이것이 맡지 않는다 — 조회는 Suspense + Skeleton 이다
 * (CLAUDE.md 8).
 */
export function Spinner({ className }: { className?: string }) {
  return <LoaderCircleIcon aria-hidden className={cn("animate-spin", className)} />;
}
