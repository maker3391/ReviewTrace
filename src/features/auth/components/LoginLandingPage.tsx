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
    /*
 🔴 **폭 상한이 셋이다.** 3단(xl)에서만 84rem 이 필요하다. 중간 폭에서 같은 상한을 쓰면
 소개 단이 700px 넘게 늘어져 headline 이 화면을 가로지른다. 아래로 내려갈수록 읽는 폭으로
 좁힌다 — 36rem 은 로그인 카드(`max-w-md` · 28rem)가 «가운데에 놓인 것»으로 읽히는 가장
 좁은 폭이다(좌우 여백 64px씩). 더 좁히면 카드가 폭을 꽉 채워 가운데 정렬이 «보이지» 않는다.
 */
    <div className="w-full max-w-[36rem] min-[52rem]:max-w-[64rem] xl:max-w-[84rem]">
      {/*
 ## 이 화면은 폭에 따라 «세 가지 배치»다

 ```
 xl  >= 1280   [ 소개 | 로그인 | 미리보기 ]     3단. 오늘 모습 그대로다
 mid >=  832   [     로그인 (가운데)      ]     로그인이 위·가운데
               [   소개    |  미리보기   ]
 sm  >=  640   [     로그인 (가운데)      ]     같은 뜻을 세로로 쌓는다
               [          소개           ]
               [        미리보기         ]
 base <  640   [ 소개 ] [ 로그인 ] [ 연동 ]     읽는 순서가 먼저다
 ```

 ## 🔴 두 breakpoint 는 «재서» 나왔다 — 수치를 먼저 고르지 않았다

 | 값 | 무엇을 재서 나왔나 |
 |---|---|
 | **832px**(`min-[52rem]`) | 소개와 미리보기를 좌우로 세울 수 있는 «가장 좁은» 폭. 소개 단은 **400px** 아래에서 Agent 띠가 두 줄로 접히고(48 -> 78px), 미리보기는 **320px** 아래에서 diff 가 세 줄로 접힌다(카드 627 -> 707px). 400 + gap 40 + 320 + 페이지 여백 64 = **824** 라, 그 위의 첫 온전한 rem 값이 52rem 이다 |
 | **640px**(`sm`) | 로그인 카드(`max-w-md` = 448)가 «가운데에 놓인 것»으로 읽히는 하한. 640 에서 좌우 여백이 64px 씩이고 **512px 에서 0** 이 된다 — 그 아래로는 가운데 배치가 아무 말도 하지 않으므로 읽는 순서(소개 -> CTA -> 연동)로 바꾼다 |

 🔴 **미리보기를 laptop·tablet 에서 접지 않는다.** 320px 이 확보되는 동안은 좌우로,
 그 아래로는 세로로 쌓아서라도 남긴다 — 640 미만에서만 접는다.

 ## 🔴 `contents` 는 «모바일에서만» 켠다

 모바일 순서(소개 -> CTA -> 연동)는 Agent 띠가 로그인 카드 «뒤»에 와야 하는데, 그 띠는
 소개 단의 바닥이라 소개 `<section>` 안에 있다. 640 미만에서만 그 section 을
 `display: contents` 로 풀어 자식들을 이 grid 의 항목으로 만들고 `order` 로 세운다.
 🔴 **띠를 두 번 그리지 않는다** — 같은 문장이 DOM 에 둘이면 읽어 주는 기계에는 두 번 들린다.
 🔴 **640 이상에서는 다시 `block`** 이라 항목이 셋(소개 · 로그인 · 미리보기)인 채로 남는다 —
 3단이 오늘과 같은 이유가 이것이다.

 🔴 **그래서 모바일의 세로 간격은 `gap-y` 가 아니라 margin 이 정한다**(`gap-y-0`).
 `contents` 로 풀린 자식들은 각자 grid 행이 되어, `gap-y` 를 두면 이미 갖고 있는
 `mt-6`·`mt-10` 위에 덧붙어 간격이 두 배가 된다.
 */}
      <div className="grid grid-cols-1 items-center gap-x-10 gap-y-0 sm:gap-y-14 min-[52rem]:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)] min-[52rem]:items-start xl:grid-cols-[minmax(0,1.15fr)_25rem_minmax(0,0.95fr)] xl:items-center xl:gap-x-14">
        {/*
 소개 — 무엇을 해 주는가.

 - **base(< 640)**: `contents` 로 풀린다. 자식 넷이 각각 grid 항목이 되어 h1 · subhead ·
   features 가 맨 앞(order 0)에 서고, 로그인 카드(`order-2`)와 Agent 띠(`order-3`)가 뒤따른다
 - **sm 이상**: 다시 `block` 이라 넷이 한 덩어리다. 자리는 `order`(sm)와
   `row-start`/`col-start`(832 이상)가 정한다
 */}
        <section className="contents sm:order-2 sm:block min-[52rem]:col-start-1 min-[52rem]:row-start-2 xl:col-start-1 xl:row-start-1">
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
        {/*
 🔴 **`mx-auto w-full max-w-md` 가 가운데 정렬의 전부다.** 어느 배치에서도 이 세 class 가
 카드를 자기 grid 영역의 «가운데»에 세운다 — 832 이상에서는 그 영역이 두 단을 가로지르고
 (`col-span-2`), xl 에서는 가운데 단(25rem)이라 폭이 그대로 400px 이다.
 🔴 그래서 `justify-self` 를 따로 걸지 않는다. 걸면 같은 일을 두 곳이 정하게 된다.

 `order-2` 는 모바일 전용이다 — features(order 0) 와 Agent 띠(`order-3`) 사이가 CTA 자리다.
 */}
        <section className="order-2 mx-auto mt-12 w-full max-w-md rounded-2xl border border-border/80 bg-card px-7 py-9 shadow-[0_1px_2px_0_oklch(0_0_0/0.04),0_12px_32px_-20px_oklch(0_0_0/0.16)] sm:order-1 sm:mt-0 sm:px-9 min-[52rem]:col-span-2 min-[52rem]:row-start-1 xl:col-span-1 xl:col-start-2 xl:row-start-1">
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

        {/*
 미리보기 — 무엇이 남는가.

 🔴 **640 미만에서만 접는다.** 그 위로는 좌우(832 이상) 또는 세로(640~831)로 남는다 —
 접는 것은 마지막 수단이다.

 🔴 **세로로 쌓을 때는 로그인 카드와 «같은 폭»(`max-w-md` · 448)으로 묶는다.** 안 묶으면
 831px 화면에서 미리보기가 576px 까지 늘어나 로그인 카드보다 커지고, 화면의 중심이 CTA 에서
 장식으로 옮겨 간다. 같은 값을 쓰는 이유는 하나 더 있다 — 둘이 같은 폭·같은 축에 서야
 세로로 쌓인 것이 「따로 뜬 상자 둘」이 아니라 한 줄기로 읽힌다. 448 에서는 diff 가
 한 줄도 접히지 않는다(실측: 420px 부터 전부 한 줄).
 좌우로 설 때는 단 폭이 이미 정해져 있어 상한을 푼다.
 */}
        <div className="order-4 mx-auto hidden w-full max-w-md sm:block min-[52rem]:col-start-2 min-[52rem]:row-start-2 min-[52rem]:max-w-none xl:col-start-3 xl:row-start-1">
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
      {/*
 🔴 **왼쪽 정렬은 3단(xl)에서만이다.** 그 아래 배치들은 전부 가운데를 축으로 세우므로,
 푸터만 왼쪽에 붙으면 축이 둘이 된다.
 */}
      <footer className="mt-14 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border-t border-border/60 pt-6 text-xs text-muted-foreground xl:justify-start">
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
