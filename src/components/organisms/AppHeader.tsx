import Link from "next/link";

import { AppearanceControls } from "@/components/molecules/AppearanceControls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { APP_CONFIG } from "@/config/app";
import { DEFAULT_SECTION, sectionHref } from "@/config/navigation";
import { ReviewTraceMark } from "@/features/auth/components/ReviewTraceMark";
import { SignOutButton } from "@/features/auth/components/SignOutButton";
import { readMessages } from "@/lib/ui/appearance";
import { avatarSources } from "@/lib/ui/avatar";

/**
 * 아바타의 표시 크기(CSS px).
 *
 * 🔴 **아래 `size-[26px]` 과 같은 값이어야 한다.** Tailwind 는 class 문자열을 정적으로
 * 훑으므로 이 상수를 class 에 끼워 넣을 수 없다 — 그래서 두 자리가 나뉘어 있고, 한쪽만
 * 고치면 내려받는 해상도와 그리는 크기가 어긋난다.
 */
const AVATAR_PX = 26;

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
export async function AppHeader({
  user,
  workspaceSlug,
  workspaceName,
  projectName,
}: {
  user: { name: string | null; image: string | null };
  /** 브랜드를 눌렀을 때 돌아갈 자리. */
  workspaceSlug: string;
  /** 지금 보고 있는 Tenant. */
  workspaceName: string;
  /** Project 안에 있을 때만. 없으면 Workspace 까지만 그린다. */
  projectName?: string | null;
}) {
  const initial = (user.name ?? "?").trim().charAt(0).toUpperCase();
  const t = (await readMessages()).nav;
  const avatar =
    user.image === null ? null : avatarSources(user.image, AVATAR_PX);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-card/80 px-3 backdrop-blur-sm sm:gap-4 sm:px-5">
      {/*
        🔴 **맨 왼쪽은 제품이지 Tenant 가 아니다.**

        Workspace 이름부터 오면 「내가 어느 제품에 있는가」를 답하는 자리가 아예 없어진다 —
        Workspace 는 바꿔 가며 쓰는 것이고 제품은 바뀌지 않는다. 그래서 브랜드가 먼저 서고,
        그 오른쪽에 「지금 어디인가」가 붙는다.

        좁은 폭에서는 마크만 남긴다 — 이름까지 넣으면 Breadcrumb 이 밀려 잘린다.

        🔴 **그때 누를 자리가 마크 «크기 그대로»가 되면 안 된다.** `lg` 아래에서는 글자가
        빠져 링크가 마크 하나(24×24)로 줄어드는데, 실측해 보니 그게 헤더에서 제일 작은
        대상이었다(표시 설정 32 · 계정 36). `-m-2 p-2` 로 누를 상자만 40×40 으로 키운다 —
        음수 margin 이 padding 을 정확히 상쇄해 **마크가 그려지는 자리는 1px 도 움직이지
        않고**, 옆 항목과의 간격도 그대로다.

        44px 까지 키우지 않은 이유는 그러면 상자가 오른쪽 「/」를 넘어 Workspace 이름 위로
        올라와, 이름을 누르려던 손가락이 브랜드로 빠지기 때문이다. 지금 넓힌 8px 은
        「/」 양옆의 빈 자리 안에서 끝난다.
      */}
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <Link
          href={sectionHref(workspaceSlug, DEFAULT_SECTION)}
          aria-label={APP_CONFIG.name}
          className="-m-2 flex shrink-0 items-center gap-2 rounded-md p-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ReviewTraceMark className="size-6" />
          <span className="hidden text-sm font-semibold tracking-tight lg:inline">
            {APP_CONFIG.name}
          </span>
        </Link>

        <span aria-hidden className="text-border">
          /
        </span>

        {/*
          Breadcrumb 은 «두 층까지»만 둔다 — Home / Workspace / Project / Section 처럼
          전부 늘어놓으면 정작 현재 위치가 묻힌다.
        */}
        <nav
          aria-label={t.breadcrumb}
          className="flex min-w-0 items-center gap-2"
        >
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
      </div>

      {/*
        오른쪽은 «내 것»이다 — 표시 설정(언어·테마)과 계정.

        🔴 좁은 폭에서 이름을 숨긴다(`hidden sm:block`). 아바타가 이미 누구인지 말하고,
        390px 에서는 그 자리를 Breadcrumb 이 써야 한다.
      */}
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <AppearanceControls />

        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-full py-1 pl-1 pr-1.5 text-sm transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 sm:pr-2.5">
            {avatar !== null ? (
              /*
                next/image 를 쓰지 않는다 — GitHub 아바타는 외부 도메인이라 원격 패턴 설정이
                필요하고, 아이콘 하나에 최적화 파이프라인을 붙일 이유가 없다.

                🔴 **대신 해상도는 «직접» 고른다.** 세션의 `image` 는 크기 인자가 없는
                `avatar_url` 원문이라 그대로 쓰면 460×460 원본이 와서 브라우저가 26px 로
                17.7배를 줄인다 — 그게 아바타가 저해상도로 보이던 원인이다. `srcSet` 으로
                DPR 별 크기를 GitHub 에게 요청한다(`@/lib/ui/avatar`).
                🔴 **표시 크기는 그대로다** — 바뀌는 것은 내려받는 픽셀 수뿐이다.
              */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatar.src}
                srcSet={avatar.srcSet}
                alt=""
                width={AVATAR_PX}
                height={AVATAR_PX}
                className="size-[26px] rounded-full ring-1 ring-border"
              />
            ) : (
              <span className="flex size-[26px] items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                {initial}
              </span>
            )}
            <span className="hidden max-w-36 truncate text-muted-foreground sm:block">
              {user.name ?? t.noName}
            </span>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {user.name ?? t.noName}
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
      </div>
    </header>
  );
}
