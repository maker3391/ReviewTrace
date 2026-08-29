import Link from "next/link";
import type { ReactNode } from "react";

import { AppearanceControls } from "@/components/molecules/AppearanceControls";
import { APP_CONFIG } from "@/config/app";
import { ReviewTraceMark } from "@/features/auth/components/ReviewTraceMark";

/**
 * 로그인 관련 화면의 껍데기.
 *
 * Dashboard Shell(사이드바·상단 바)을 쓰지 않는다 — 아직 들어가지 못한 사람에게
 * 메뉴를 보여 줄 이유가 없다. 대신 **제품을 처음 만나는 자리**라 브랜드가 상단 왼쪽에
 * 서고, 언어·테마 전환이 오른쪽에 선다.
 *
 * 🔴 **언어·테마 전환은 여기에도 둔다.** 이 화면에는 상단 바가 없어, 없으면 «로그인하기
 * 전에는» 둘 다 바꿀 방법이 없다. 로그인 전에 쓰는 화면이야말로 모국어로 보여야 한다.
 *
 * 🔴 **높이를 `min-h-0` 으로 잘라 두지 않는다.** 내용이 화면보다 길어지면 위쪽이 잘린 채
 * 스크롤도 되지 않는다 — 늘어나게 두면 body 가 대신 스크롤한다.
 *
 * 🔴 **폭을 여기서 고정하지 않는다.** 로그인은 넓게 펼치고 초대 화면은 좁게 세운다 —
 * 각 화면이 자기 폭을 정한다.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 px-4 py-4 sm:px-8 sm:py-6">
        {/*
          🔴 **브랜드는 언제나 Home 으로 가는 문이다.** 마크와 이름이 «하나의» 클릭
          영역이라, 글자만 눌리거나 로고만 눌리는 자리가 생기지 않는다.

          가는 곳은 `/` 하나뿐이다 — 로그인하지 않았으면 `/` 가 `/login` 으로 돌려보내고
          (`requireUser`), 이미 로그인했다면 `src/app/page.tsx` 가 마지막으로 보던
          Workspace 의 Dashboard 로 보낸다. 🔴 **여기서 그 판단을 다시 하지 않는다** —
          자격을 아는 자리는 서버 한 곳이고, 화면이 흉내 내면 둘이 갈라진다(CLAUDE.md 11).

          이름이 «글자로» 옆에 있으므로 마크는 `decorative` 인 채로 둔다 — `aria-label` 을
          더하면 스크린 리더가 제품명을 두 번 읽는다.
        */}
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ReviewTraceMark className="size-7 sm:size-8" />
          <span className="text-base font-semibold tracking-tight sm:text-lg">
            {APP_CONFIG.name}
          </span>
        </Link>
        <AppearanceControls />
      </header>

      <div className="flex flex-1 items-center justify-center px-4 pb-10 pt-2 sm:px-8 sm:pb-14">
        {children}
      </div>
    </div>
  );
}
