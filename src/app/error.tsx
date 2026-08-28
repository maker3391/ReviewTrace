"use client";

import { Button } from "@/components/ui/button";

/**
 * 화면 단위 Error Boundary.
 *
 * 🔴 Stack Trace · SQL · 내부 경로를 사용자에게 보여 주지 않는다(CLAUDE.md 19).
 * 프로덕션 빌드에서는 Server 오류의 `message` 가 이미 지워진 채 도착한다 —
 * 원인을 찾는 단서는 `digest` 이고, 그것은 서버 로그와 짝을 이룬다.
 *
 * `retry` 는 Next.js 16 에서 안정화된 prop 이다. `reset` 과 달리 데이터를 다시 가져오므로
 * Server Component 에서 난 오류도 실제로 회복된다.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-sm font-medium">요청을 처리하지 못했습니다.</p>
      <p className="text-xs text-muted-foreground">
        잠시 후 다시 시도해 주세요.
        {error.digest !== undefined && (
          <>
            {" "}
            문의 시 이 코드를 알려 주세요:{" "}
            <code className="font-mono">{error.digest}</code>
          </>
        )}
      </p>
      <Button size="sm" variant="outline" onClick={() => retry()}>
        다시 시도
      </Button>
    </div>
  );
}
