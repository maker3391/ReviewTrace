import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { APP_CONFIG } from "@/config/app";
import { SignInWithGithubButton } from "@/features/auth/components/SignInWithGithubButton";
import { currentUser } from "@/lib/auth/session";
import { readMessages } from "@/lib/ui/appearance";

export const metadata: Metadata = {
  title: "로그인",
};

/**
 * 로그인 화면. 🔴 공개 경로다 — 막으면 무한 리다이렉트가 된다(CLAUDE.md 11).
 *
 * 🔴 **가입이 따로 없다.** 처음 GitHub 으로 로그인하면 그것이 가입이고, 그 사람의
 * Personal Workspace 가 함께 만들어진다(스펙 0·3).
 *
 * ## 화면의 결
 *
 * 제품을 처음 만나는 자리라 **하나의 올라온 표면**에 브랜드 → 행동 → 설명을 세로로
 * 세운다. 카드 문법은 다른 화면(`Section variant="raised"`)과 같은 것을 쓴다 — 로그인
 * 전용 디자인을 따로 만들지 않는다(CLAUDE.md 16).
 *
 * 🔴 **좌우로 쪼개거나 illustration 을 두지 않는다.** 할 일이 버튼 하나뿐인 화면에
 * 마케팅 Landing 을 흉내내면 제품의 인상이 흐려진다.
 */
export default async function LoginPage(props: PageProps<"/login">) {
  // 이미 들어와 있는 사람에게 로그인 화면을 다시 보여 줄 이유가 없다.
  if ((await currentUser()) !== null) {
    redirect("/");
  }

  const { error } = await props.searchParams;
  const t = (await readMessages()).login;

  return (
    <div className="rounded-xl border border-border/80 bg-card px-6 py-9 shadow-[0_1px_2px_0_oklch(0_0_0/0.04),0_1px_3px_0_oklch(0_0_0/0.03)] sm:px-9 sm:py-10">
      <div className="flex flex-col items-center text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]">
          {APP_CONFIG.name}
        </h1>
        {/*
          Tagline 은 제품을 처음 만나는 이 자리에만 둔다 — 상단 바·사이드바에 또 적으면
          장식이 된다(CLAUDE.md 16). 제목보다 약하되 «읽히는» 크기를 지킨다.
        */}
        <p className="mt-2 text-sm text-muted-foreground">
          {APP_CONFIG.tagline}
        </p>
      </div>

      {/*
        🔴 실패 사유를 나누어 보여 주지 않는다. Auth.js 의 오류 코드를 그대로 그리면
        설정 상태와 계정 존재 여부가 밖으로 새어 나간다(CLAUDE.md 19).
      */}
      {error !== undefined && (
        <p
          role="alert"
          className="mt-7 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[0.8125rem] text-destructive"
        >
          {t.error}
        </p>
      )}

      <div className="mt-8">
        <SignInWithGithubButton />
      </div>

      <p className="mt-4 text-center text-[0.8125rem] leading-relaxed text-balance text-muted-foreground">
        {t.hint}
      </p>
    </div>
  );
}
