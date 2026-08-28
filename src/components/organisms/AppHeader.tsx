import { APP_CONFIG } from "@/config/app";

/**
 * 상단 바.
 *
 * Server Component 다 — 상호작용이 없다. 【향후】 인증이 붙으면 사용자 메뉴가 여기 들어가고,
 * 그 조각만 Client Component 로 내린다(CLAUDE.md 7).
 */
export function AppHeader() {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
      <span className="text-sm font-semibold tracking-tight">
        {APP_CONFIG.name}
      </span>
      <span className="text-xs text-muted-foreground">인증 미구현</span>
    </header>
  );
}
