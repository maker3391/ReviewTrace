import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { IssueStatus } from "@/types/review";

const STATUS_CLASS: Record<IssueStatus, string> = {
  OPEN: "bg-destructive/15 text-destructive",
  IN_PROGRESS: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  RESOLVED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  IGNORED: "bg-muted text-muted-foreground",
};

const STATUS_LABEL: Record<IssueStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  IGNORED: "Ignored",
};

export function StatusBadge({
  status,
  className,
}: {
  status: IssueStatus;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("border-transparent", STATUS_CLASS[status], className)}
    >
      {STATUS_LABEL[status]}
    </Badge>
  );
}
