import { Badge } from "@/components/ui/badge";
import { readMessages } from "@/lib/ui/appearance";
import { cn } from "@/lib/utils";
import type { IssueSeverity } from "@/types/review";

/**
 * Severity 를 한눈에 구분되게 그린다.
 *
 * Atom 인 이유: Badge Primitive 에 「Severity 라는 의미」와 색 규칙이 얹혔다.
 * 의미가 얹히지 않은 Primitive 는 `ui` 를 그대로 쓴다.
 *
 * ## 🔴 값이 아니라 이름표를 그린다
 *
 * `severity` 는 Agent 가 보내고 Database·API 가 쓰는 **값**이라 그대로 두고, 화면에는
 * 그 값의 **이름표**(`enums.severity`)를 그린다 — 한국어 화면에 `HIGH` 가 찍히지 않게
 * 하되 API·URL 에 실려 가는 값은 손대지 않는다(`config/messages/ko.ts` 머리말).
 *
 * 🔴 **문구를 prop 으로 받지 않고 스스로 읽는다.** Badge 는 화면 곳곳에 흩어져 있어
 * 부르는 쪽마다 낱말을 넘기게 하면 열 곳에서 같은 표를 옮겨 적게 된다.
 * 대신 `server-only` 인 `readMessages` 를 쓰므로 **Client Component 에 넣으면 빌드가
 * 깨진다** — 경계를 주석이 아니라 빌드가 지킨다.
 */

// Tailwind 는 클래스 문자열을 정적으로 훑는다. 조합해서 만들면 빌드에서 사라진다.
const SEVERITY_CLASS: Record<IssueSeverity, string> = {
 CRITICAL: "bg-destructive text-white",
 HIGH: "bg-destructive/15 text-destructive",
 MEDIUM: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
 LOW: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
 INFO: "bg-muted text-muted-foreground",
};

export async function SeverityBadge({
 severity,
 className,
}: {
 severity: IssueSeverity;
 className?: string;
}) {
 const labels = (await readMessages()).enums.severity;

 return (
 <Badge
 variant="outline"
 className={cn(
 "border-transparent text-[11px] tracking-tight",
 SEVERITY_CLASS[severity],
 className,
)}
 >
 {labels[severity]}
 </Badge>
);
}
