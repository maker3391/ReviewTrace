import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { APP_CONFIG } from "@/config/app";
import { SignInWithGithubButton } from "@/features/auth/components/SignInWithGithubButton";
import { currentUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "로그인",
};

/**
 * 로그인 화면. 🔴 공개 경로다 — 막으면 무한 리다이렉트가 된다(CLAUDE.md 11).
 *
 * 🔴 **가입이 따로 없다.** 처음 GitHub 으로 로그인하면 그것이 가입이고, 그 사람의
 * Personal Workspace 가 함께 만들어진다(스펙 0·3).
 */
export default async function LoginPage(props: PageProps<"/login">) {
  // 이미 들어와 있는 사람에게 로그인 화면을 다시 보여 줄 이유가 없다.
  if ((await currentUser()) !== null) {
    redirect("/");
  }

  const { error } = await props.searchParams;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-base font-semibold tracking-tight">
          {APP_CONFIG.name}
        </h1>
        {/*
          Tagline 은 제품을 처음 만나는 이 자리에만 둔다 — 상단 바·사이드바에 또 적으면
          장식이 된다(CLAUDE.md 16).
        */}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {APP_CONFIG.tagline}
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          GitHub 계정으로 시작합니다. 처음이면 자동으로 가입됩니다.
        </p>
      </div>

      {/*
        🔴 실패 사유를 나누어 보여 주지 않는다. Auth.js 의 오류 코드를 그대로 그리면
        설정 상태와 계정 존재 여부가 밖으로 새어 나간다(CLAUDE.md 19).
      */}
      {error !== undefined && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          로그인하지 못했습니다. 잠시 뒤 다시 시도하세요.
        </p>
      )}

      <SignInWithGithubButton />
    </div>
  );
}
