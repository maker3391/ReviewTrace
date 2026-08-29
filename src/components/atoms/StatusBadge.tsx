import { Badge } from "@/components/ui/badge";
import { readMessages } from "@/lib/ui/appearance";
import { cn } from "@/lib/utils";
import type { IssueStatus } from "@/types/review";

/**
 * Issue 상태를 그린다.
 *
 * 🔴 **값과 이름표를 가른다** — `status` 는 API·Database·URL 이 쓰는 값 그대로 두고,
 * 화면에는 `enums.status` 의 이름표를 그린다(`SeverityBadge` 와 같은 이유).
 * 이름표 표는 사전 한 곳에 있어 Badge·Select·Filter 가 **같은 낱말**을 쓴다.
 */

const STATUS_CLASS: Record<IssueStatus, string> = {
  OPEN: "bg-destructive/15 text-destructive",
  IN_PROGRESS: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  RESOLVED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  IGNORED: "bg-muted text-muted-foreground",
  // 「Agent 가 잘못 짚은 것」은 해결과 색을 나눈다 — 통계에서 섞이면 안 되는 값이다.
  FALSE_POSITIVE: "bg-muted text-muted-foreground",
  REOPENED: "bg-destructive/15 text-destructive",
};

export async function StatusBadge({
  status,
  className,
}: {
  status: IssueStatus;
  className?: string;
}) {
  const labels = (await readMessages()).enums.status;

  return (
    <Badge
      variant="outline"
      className={cn("border-transparent", STATUS_CLASS[status], className)}
    >
      {labels[status]}
    </Badge>
  );
}
