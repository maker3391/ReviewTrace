import type { ReactNode } from "react";

/**
 * 로그인 관련 화면의 껍데기.
 *
 * Dashboard Shell(사이드바·상단 바)을 쓰지 않는다 — 아직 들어가지 못한 사람에게
 * 메뉴를 보여 줄 이유가 없다.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
