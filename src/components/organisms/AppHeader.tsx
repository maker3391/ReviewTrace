import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SignOutButton } from "@/features/auth/components/SignOutButton";

/**
 * 상단 바.
 *
 * 🔴 **선 한 줄짜리 Toolbar 로 두지 않는다**(CLAUDE.md 16). 왼쪽은 «지금 어디인가»
 * (Workspace → Project), 오른쪽은 계정이다. 둘의 우선순위가 눈에 보여야 한다.
 *
 * Server Component 다 — 계정 메뉴는 Radix 이지만 `DropdownMenu` 자체가 Client Component 라
 * 여기서는 조립만 한다.
 *
 * 🔴 **화면이 그리는 필드만 받는다.** 세션이나 사용자 행을 통째로 받으면 RSC payload 로
 * 페이지 소스에 이메일까지 실려 나간다(CLAUDE.md 11).
 */
export function AppHeader({
  user,
  workspaceName,
  projectName,
}: {
  user: { name: string | null; image: string | null };
  /** 지금 보고 있는 Tenant. */
  workspaceName: string;
  /** Project 안에 있을 때만. 없으면 Workspace 까지만 그린다. */
  projectName?: string | null;
}) {
  const initial = (user.name ?? "?").trim().charAt(0).toUpperCase();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-card/80 px-5 backdrop-blur-sm">
      {/*
        Breadcrumb 은 «두 층까지»만 둔다 — Home / Workspace / Project / Section 처럼
        전부 늘어놓으면 정작 현재 위치가 묻힌다.
      */}
      <nav aria-label="현재 위치" className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-semibold tracking-tight text-foreground">
          {workspaceName}
        </span>
        {projectName != null && projectName !== "" && (
          <>
            <span aria-hidden className="text-border">
              /
            </span>
            <span className="truncate text-sm text-muted-foreground">
              {projectName}
            </span>
          </>
        )}
      </nav>

      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 text-sm transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50">
          {user.image !== null ? (
            /*
              next/image 를 쓰지 않는다 — GitHub 아바타는 외부 도메인이라 원격 패턴 설정이
              필요하고, 아이콘 하나에 최적화 파이프라인을 붙일 이유가 없다.
            */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.image}
              alt=""
              width={26}
              height={26}
              className="size-[26px] rounded-full ring-1 ring-border"
            />
          ) : (
            <span className="flex size-[26px] items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
              {initial}
            </span>
          )}
          <span className="max-w-36 truncate text-muted-foreground">
            {user.name ?? "이름 없음"}
          </span>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {user.name ?? "이름 없음"}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/*
            로그아웃은 Server Action 을 쏘는 form 이다. DropdownMenuItem 이 클릭을
            가로채지 않도록 `asChild` 로 form 을 그대로 둔다.
          */}
          <DropdownMenuItem asChild className="p-0">
            <div className="w-full">
              <SignOutButton />
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
