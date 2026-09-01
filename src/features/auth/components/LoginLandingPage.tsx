import { APP_CONFIG } from "@/config/app";
import { LoginAgentSupport } from "@/features/auth/components/LoginAgentSupport";
import {
  LoginFeatureList,
  LoginShowcase,
} from "@/features/auth/components/LoginShowcase";
import { ReviewTraceMark } from "@/features/auth/components/ReviewTraceMark";
import { SignInWithGithubButton } from "@/features/auth/components/SignInWithGithubButton";
import { readMessages } from "@/lib/ui/appearance";

/**
 * 로그인 화면. 🔴 공개 경로다 — 막으면 무한 리다이렉트가 된다.
 *
 * 🔴 **가입이 따로 없다.** 처음 GitHub 으로 로그인하면 그것이 가입이고, 그 사람의
 * Personal Workspace 가 함께 만들어진다(스펙 0·3). 🔴 **그 사실을 화면에 적지 않는다** —
 * 버튼 하나가 진입점 전부라 설명이 필요 없고, 구현 세부를 로그인 화면이 말할 이유도 없다.
 *
 * ## 화면의 결
 *
 * ```
 * [ Product Value ] [ Brand + Auth ] [ Product Evidence ]
 * Headline ReviewTrace Review → Issue → Evidence
 * 3 features GitHub 버튼 → Decision → Verified
 * ```
 *
 * 🔴 **세 단의 역할이 갈린다.** 「무엇을 해 주는가」는 왼쪽이, 「무엇이 남는가」는
 * 오른쪽이 말한다. 🔴 **가운데는 아무것도 «설명하지» 않는다** — 제품 이름과 문
 * 하나뿐이다. 셋 중 둘이 이미 말한 것을 가운데가 한 번 더 말하면, 그 자리는
 * 설명이 아니라 소음이 된다.
 *
 * 🔴 **Brand 색으로 문장 절반을 칠하지 않는다.** 검은 글자가 주인공이고 Indigo 는
 * 마지막 한 덩어리와 Evidence 연결선까지다.
 */
export async function LoginLandingPage({
  error,
}: {
  error?: string | string[];
}) {
  const t = (await readMessages()).login;

  return (
    <div className="w-full max-w-[84rem]">
      {/*
 🔴 **3단은 1280 부터다.** 1024 에서 셋을 우겨넣으면 헤드라인이 쪼개지고 코드 줄이
 잘린다 — 좁아지면 오른쪽 미리보기를 «먼저» 접는다.
 */}
      <div className="grid items-center gap-x-10 gap-y-12 lg:grid-cols-[minmax(0,1.15fr)_25rem] xl:grid-cols-[minmax(0,1.15fr)_25rem_minmax(0,0.95fr)] xl:gap-x-14">
        {/* 왼쪽 — 무엇을 남기는가. 좁은 화면에서는 카드 아래로 내려간다. */}
        <section className="order-2 lg:order-1">
          {/*
 🔴 `break-keep` 이 이 화면에서 가장 중요한 한 줄이다. 없으면 한국어가
 낱말·조사 중간에서 끊긴다 — 그것은 취향이 아니라 오식이다.
 */}
          <h1 className="text-[2.125rem] font-bold leading-[1.22] tracking-[-0.022em] break-keep sm:text-[2.5rem] xl:text-[2.875rem]">
            {t.headlineLead}
            <br />
            <span className="text-primary">{t.headlineAccent}</span>
          </h1>

          <p className="mt-6 max-w-[32rem] text-base leading-[1.75] break-keep text-foreground/70">
            {t.subhead}
          </p>

          <LoginFeatureList features={t.features} />

          {/*
 🔴 **왼쪽 단의 «맨 아래»가 이 줄의 자리다.** 위의 셋이 「무엇을 해 주는가」를
 말하고 나면 남는 물음이 「그래서 내 Agent 가 되는가」 하나다 — 그 순서로
 읽히도록 features 뒤에 둔다. 위로 올리면 아직 무엇인지도 모르는 제품의
 연결 대상을 먼저 읽게 되고, 오른쪽·가운데로 옮기면 그 단이 이미 맡은
 말(무엇이 남는가 · 어떻게 시작하는가)과 섞인다.

 🔴 **새 마디가 아니라 features 의 바닥이다.** 제목을 두지 않고 연결 «구조»도
 그리지 않는다 — 로그인 화면이 답할 것은 「내 Agent 가 붙는가」까지다.
 */}
          <LoginAgentSupport label={t.agentSupport} />
        </section>

        {/*
 가운데 — Brand + Authentication. 다른 화면과 같은 카드 문법을 쓴다.

 ## 🔴 이 카드는 OAuth 버튼을 담은 상자가 아니다

 ReviewTrace 로 들어오는 **문**이라 제품 마크와 이름이 반드시 남는다. Header 에
 같은 것이 있다는 이유로 지우면, 남는 것은 「어디에 로그인하는지 모를 검은 버튼
 하나」다.

 ## 세로 값을 이렇게 정한 이유 — 여백을 «줄인» 것이 아니라 «옮겼다»

 내용이 **Brand 와 CTA 둘뿐**이라, 이 카드의 인상은 전적으로
 **「테두리까지의 여백」 대 「둘 사이의 여백」** 비율이 정한다.

 ```
 py-9 (36px) ← 테두리까지
 Brand (42px)
 mt-12 (48px) ← 둘 사이. 셋 중 «가장 넓다»
 CTA (40px)
 py-9 (36px) 카드 221px -> 204px
 ```

 - **`py-10`(40) → `py-9`(36).** 줄이되 더 줄이지 않는다 — `sm:px-9` 와 같은 값이라
 640 이상에서 네 변이 균일한 36px 틀이 된다. 여기서 더 깎으면 버튼을 감싼
 wrapper 로 쪼그라든다
 - 🔴 **둘 사이는 32 → 48 로 «늘렸다».** 양 끝에서 걷어낸 8px 을 가운데로 옮긴
 것이라, 카드는 17px 줄었는데 숨 쉴 자리는 넓어졌다. 문구를 지운 자리가
 «남은 자리»가 아니라 «둔 자리»가 되는 것은 이 뒤집기 하나다
 - 🔴 **둘 사이(48)가 테두리까지(36)보다 좁으면 안 된다.** 좁으면 Brand 와 CTA 가
 서로 붙은 한 덩어리로 읽혀 카드가 「위아래로 넉넉히 패딩된 버튼」이 된다.
 넓어야 둘이 독립한 층으로 갈라져 **이름 → (숨) → 할 일** 이 읽힌다
 - 48 은 Brand 줄(42)·버튼(40) 어느 쪽보다도 크다. 요소 자기 키보다 작은 간격은
 눈에 「붙었다」로 읽히기 때문에, 그 선을 넘겨야 간격이 «보인다»
 */}
        <section className="order-1 mx-auto w-full max-w-md rounded-2xl border border-border/80 bg-card px-7 py-9 shadow-[0_1px_2px_0_oklch(0_0_0/0.04),0_12px_32px_-20px_oklch(0_0_0/0.16)] sm:px-9 lg:order-2">
          {/* 🔴 마크는 `public/logo.png` 하나다(`ReviewTraceMark`). */}
          <div className="flex items-center justify-center gap-2.5">
            <ReviewTraceMark size={96} className="size-9" />
            <span className="text-[1.75rem] font-semibold tracking-[-0.02em]">
              {APP_CONFIG.name}
            </span>
          </div>

          {/*
 🔴 **오류는 CTA 와 한 덩어리다.** 실패한 것이 이 버튼을 누른 일이라 바로 위에
 붙여 둔다 — 그래야 Brand 와 CTA 사이의 48px 이 오류가 있든 없든 그대로라
 간격이 무너지지 않고, 카드만 오류 높이만큼 자란다.
 */}
          <div className="mt-12">
            {/*
 🔴 실패 사유를 나누어 보여 주지 않는다. Auth.js 의 오류 코드를 그대로 그리면
 설정 상태와 계정 존재 여부가 밖으로 새어 나간다.
 */}
            {error !== undefined && (
              <p
                role="alert"
                className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[0.8125rem] text-destructive"
              >
                {t.error}
              </p>
            )}

            <SignInWithGithubButton />
          </div>
        </section>

        {/* 오른쪽 — 무엇이 남는가. 좁아지면 아예 그리지 않는다. */}
        <div className="order-3 hidden xl:block">
          <LoginShowcase
            issue={t.showcaseIssue}
            decision={t.showcaseDecision}
          />
        </div>
      </div>

      {/*
 🔴 **Footer 는 이 페이지에서 «가장 낮은» 층이다.** divider 한 줄과 muted 글자뿐이고
 메뉴도 설명도 두지 않는다 — 여기가 무거워지면 CTA 아래에 두 번째 화면이 생긴다.

 ## 🔴 `All rights reserved.` 를 지웠다

 이 저장소는 **Apache-2.0** 이다(루트 `LICENSE` · `package.json` 의 `license` ·
 GitHub 이 인식한 값 셋이 일치한다). 「모든 권리를 유보한다」는 그 라이선스와
 **반대로 읽히는 문구**라, 오픈소스 저장소의 푸터에 남겨 둘 이유가 없다.
 대신 **실제 `LICENSE` 파일로 가는 링크**를 둔다 — 문구가 아니라 파일이 정본이다.

 🔴 **License 링크는 `/blob/HEAD/LICENSE` 다.** 기본 브랜치 이름(`develop`)을 URL 에
 박으면 나중에 기본 브랜치가 바뀌는 순간 404 가 된다. `HEAD` 는 GitHub 이 그때의
 기본 브랜치로 풀어 준다.
 */}
      <footer className="mt-14 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border-t border-border/60 pt-6 text-xs text-muted-foreground lg:justify-start">
        <span>
          © {new Date().getFullYear()} {APP_CONFIG.name}
        </span>
        <span aria-hidden="true">·</span>
        <a
          href="https://github.com/maker3391/ReviewTrace"
          target="_blank"
          rel="noreferrer noopener"
          className="rounded-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          GitHub
        </a>
        <span aria-hidden="true">·</span>
        <a
          href="https://github.com/maker3391/ReviewTrace/blob/HEAD/LICENSE"
          target="_blank"
          rel="noreferrer noopener"
          className="rounded-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {t.license}
        </a>
      </footer>
    </div>
  );
}
