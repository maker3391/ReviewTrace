import { APP_CONFIG } from "@/config/app";
import { SignOutButton } from "@/features/auth/components/SignOutButton";

/**
 * 상단 바.
 *
 * Server Component 다 — 로그아웃은 Server Action 하나라 `'use client'` 가 필요 없다.
 *
 * 🔴 **화면이 그리는 필드만 받는다.** 세션이나 사용자 행을 통째로 받으면 RSC payload 로
 * 페이지 소스에 이메일까지 실려 나간다(CLAUDE.md 11).
 */
export function AppHeader({
  user,
}: {
  user: { name: string | null; image: string | null };
}) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
      <span className="text-sm font-semibold tracking-tight">
        {APP_CONFIG.name}
      </span>

      <div className="flex items-center gap-3">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {user.image !== null && (
            /*
              next/image 를 쓰지 않는다 — GitHub 아바타는 외부 도메인이라 원격 패턴 설정이
              필요하고, 12px 아이콘 하나에 최적화 파이프라인을 붙일 이유가 없다.
            */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.image}
              alt=""
              width={20}
              height={20}
              className="size-5 rounded-full"
            />
          )}
          {user.name ?? "이름 없음"}
        </span>
        <SignOutButton />
      </div>
    </header>
  );
}
