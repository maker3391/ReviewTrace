import type { ReactNode } from "react";

import { AppearanceControls } from "@/components/molecules/AppearanceControls";

/**
 * 로그인 관련 화면의 껍데기.
 *
 * Dashboard Shell(사이드바·상단 바)을 쓰지 않는다 — 아직 들어가지 못한 사람에게
 * 메뉴를 보여 줄 이유가 없다.
 *
 * 🔴 **높이를 `min-h-0` 으로 잘라 두지 않는다.** 가운데 정렬(`items-center`)에서 내용이
 * 화면보다 길어지면 위쪽이 잘린 채 스크롤도 되지 않는다 — 늘어나게 두면 body 가 대신
 * 스크롤한다. 좁은 세로 화면에서 버튼이 사라지지 않게 하는 값이다.
 *
 * 🔴 **언어·테마 전환은 여기에도 둔다.** 이 화면에는 상단 바가 없어, 없으면 «로그인하기
 * 전에는» 둘 다 바꿀 방법이 없다. 로그인 전에 쓰는 화면이야말로 모국어로 보여야 한다.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex justify-end px-4 pt-4">
        <AppearanceControls />
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-10 pt-6 sm:pb-16">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
