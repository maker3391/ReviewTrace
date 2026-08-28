import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { IssueSeverity } from "@/types/review";

/**
 * Severity 를 한눈에 구분되게 그린다.
 *
 * Atom 인 이유: Badge Primitive 에 「Severity 라는 의미」와 색 규칙이 얹혔다.
 * 의미가 얹히지 않은 Primitive 는 `ui` 를 그대로 쓴다(CLAUDE.md 16).
 */

// Tailwind 는 클래스 문자열을 정적으로 훑는다. 조합해서 만들면 빌드에서 사라진다.
const SEVERITY_CLASS: Record<IssueSeverity, string> = {
  CRITICAL: "bg-destructive text-white",
  HIGH: "bg-destructive/15 text-destructive",
  MEDIUM: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  LOW: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  INFO: "bg-muted text-muted-foreground",
};

export function SeverityBadge({
  severity,
  className,
}: {
  severity: IssueSeverity;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-transparent font-mono text-[11px] tracking-tight",
        SEVERITY_CLASS[severity],
        className,
      )}
    >
      {severity}
    </Badge>
  );
}
