"use client";

import { Button } from "@/components/ui/button";
import { messages } from "@/config/i18n";
import { useLocale } from "@/lib/ui/locale-context";

/**
 * 화면 단위 Error Boundary.
 *
 * 🔴 Stack Trace · SQL · 내부 경로를 사용자에게 보여 주지 않는다(CLAUDE.md 19).
 * 프로덕션 빌드에서는 Server 오류의 `message` 가 이미 지워진 채 도착한다 —
 * 원인을 찾는 단서는 `digest` 이고, 그것은 서버 로그와 짝을 이룬다.
 *
 * `retry` 는 Next.js 16 에서 안정화된 prop 이다. `reset` 과 달리 데이터를 다시 가져오므로
 * Server Component 에서 난 오류도 실제로 회복된다.
 *
 * 🔴 **언어를 여기서 다시 알아내지 않는다.** 이 화면은 Root Layout **안**이라, Layout 이
 * 쿠키에서 읽어 `<html lang>` 에 쓴 값이 Context 로 이미 내려와 있다
 * (`lib/ui/locale-context.tsx`) — 서버가 그린 것과 첫 클라이언트 렌더가 같다.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = messages(useLocale()).errorPage;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-sm font-medium">{t.generic}</p>
      <p className="text-xs text-muted-foreground">
        {t.hint}
        {error.digest !== undefined && (
          <>
            {" "}
            {t.digestLabel}{" "}
            <code className="font-mono">{error.digest}</code>
          </>
        )}
      </p>
      <Button size="sm" variant="outline" onClick={() => retry()}>
        {t.retry}
      </Button>
    </div>
  );
}
