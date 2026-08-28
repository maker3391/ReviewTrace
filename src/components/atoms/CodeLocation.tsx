import { cn } from "@/lib/utils";

/**
 * 파일 경로와 줄 번호.
 *
 * 「어디였는가」가 없으면 같은 문제를 다시 짚을 수 없다 — Issue 목록에서 가장 자주 읽는 값이라
 * 표시 규칙(경로 축약·줄 표기)을 한 곳에 모은다.
 */
export function CodeLocation({
  filePath,
  lineStart,
  lineEnd,
  className,
}: {
  filePath: string | null;
  lineStart?: number | null;
  lineEnd?: number | null;
  className?: string;
}) {
  if (filePath === null || filePath === "") {
    return <span className={cn("text-muted-foreground", className)}>—</span>;
  }

  const lines =
    lineStart == null
      ? ""
      : lineEnd == null || lineEnd === lineStart
        ? `:${lineStart}`
        : `:${lineStart}-${lineEnd}`;

  return (
    <span
      className={cn("font-mono text-xs text-muted-foreground", className)}
      title={`${filePath}${lines}`}
    >
      <span className="text-foreground">{basename(filePath)}</span>
      {lines}
    </span>
  );
}

function basename(filePath: string): string {
  const segments = filePath.split("/");
  return segments[segments.length - 1] ?? filePath;
}
