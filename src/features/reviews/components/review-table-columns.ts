/**
 * Review 목록 표의 «폭 계약».
 *
 * `features/issues/components/issue-table-columns.ts` 와 같은 결이다 — 폭을 화면 파일에
 * 흩뿌리지 않고 한 곳에 모아 두고, 왜 그 값인지를 여기에 적는다.
 *
 * ## 왜 `FLEX_CELL`·`NAME_CELL` 로 풀 수 없었나
 *
 * 그 둘은 **「남는 폭을 가져가는 칸이 하나」일 때** 맞는 도구다. Review 목록에는 길이를
 * 예측할 수 없는 식별자 칸이 **둘**이다 — 저장소(`owner/name`)와 대상(branch 또는 SHA).
 * 예전 표는 저장소에만 `NAME_CELL` 을 걸고 대상을 `w-56`(224px)으로 «적어» 두었는데,
 * `table-auto` 에서 그것은 **요구일 뿐 약속이 아니다.** 실측한 결과:
 *
 * ```
 * 표 1214px(1920) 저장소 726px 대상 108px 브랜치·커밋 87px ← w-56 이 지켜지지 않았다
 * ```
 *
 * 저장소의 `w-full` 이 남는 폭을 전부 요구하자 브라우저가 **줄일 수 있는 칸부터 줄여**
 * 브랜치 칸을 87px 까지 밀어 넣었고, 거기에 `break-all` 이 걸려 있어 55자 브랜치가
 * 일곱 줄로 접혔다 — **행 하나가 131px(다른 행은 41px)이 된 원인이 이것**이다.
 * `max-w-0` 을 둘 다에 걸어도 나아지지 않는다. 바닥이 없어 좁은 폭에서 둘 다 뭉개지고,
 * 어느 쪽이 얼마나 줄어들지는 내용이 정한다(`table-auto` 의 shrink 배분).
 *
 * 그래서 Issue 목록과 같은 답을 쓴다 — **`table-fixed`.** 폭을 머리 행이 정하고 내용은
 * 그 안에서 잘린다. 값이 아무리 길어도 표가 넓어지지 않고, 두 식별자 칸이 서로의 폭을
 * 빼앗지도 않는다. 🔴 **공용 primitive 를 «더 만들지» 않았다** — 이미 있는 패턴이다.
 *
 * ## 좁은 화면
 *
 * `min-w-[22rem]` — Issue 목록과 같은 바닥이다. 고정 폭(Reviewer 128 + Issues 80)을 빼면
 * 대상 칸에 **144px** 이 남는다. 이 아래로는 브랜치가 두어 낱말만 남는다.
 * 그때는 **표만** 자기 컨테이너 안에서 가로로 넘어간다(`Table` 의 `overflow-x-auto`).
 * 🔴 **페이지 자체는 좌우로 넘치지 않는다**.
 */
export const REVIEW_TABLE = "table-fixed min-w-[22rem]";

/**
 * 열마다의 폭과 «언제 보이는가».
 *
 * ```
 * 항상 Reviewer · Target · Issues 누가 · 무엇을 봤고 · 몇 건이 나왔나
 * sm~ · lg~ + Date 언제인가 (🔴 md 구간만 다시 접는다 — 아래)
 * lg~ + Repository 어느 저장소인가
 * ```
 *
 * 🔴 **Reviewer 를 접지 않는 이유는 그 칸이 상세로 들어가는 입구이기 때문이다.**
 * 접으면 좁은 화면에서 Review 상세로 갈 길이 사라진다. 값도 짧고 예측 가능해
 * (`codex` · `claude-code` · 사람 이름) 고정 폭이 낭비되지 않는다.
 *
 * Repository 를 먼저 접는 것은 Issue 목록이 Location 을 `lg` 아래에서 접는 것과 같은
 * 판단이다 — 한 Project 안의 목록이라 저장소는 **행을 가르는 값**이지 **행을 알아보는 값**이
 * 아니다. 접힌 값은 Review 상세에 그대로 있다.
 *
 * ## 🔴 `md` 에서 자리가 «줄어든다» — 그래서 날짜를 그 구간만 다시 접는다
 *
 * 폭이 넓어질수록 자리가 는다는 가정이 여기서는 틀린다. 사이드바가 `md` 에서
 * `w-16`(64px) → `md:w-64`(256px)로 벌어져 **192px 을 한꺼번에 가져가기** 때문이다.
 * 실측한 표의 안쪽 폭(`overflow-x-auto` 컨테이너):
 *
 * ```
 * 390 292 640 526 767 653
 * 768 462 ← 여기서 «좁아진다»
 * 1024 718 1280 958 1440 1118 1920 1214
 * ```
 *
 * 날짜(`2026-08-28`)를 `sm` 에서 켠 채 두면 768~1023 구간에서 대상 칸이 134px 로 내려가
 * 브랜치가 낱말 하나만 남는다. 그 구간만 날짜를 접으면 대상이 254px 이 된다 —
 * 🔴 **잘리지 않는 값(날짜)을 지켜서 «잘리는 값»의 글자 수를 사는 거래**이므로, 자리가
 * 실제로 모자란 구간에서만 한다.
 *
 * ## 남는 폭은 저장소와 대상이 «반씩» 나눠 갖는다
 *
 * `table-fixed` 에서 폭을 적지 않은 열은 남는 폭을 균등하게 나눈다. 둘 중 하나를 고정하면
 * 다른 하나가 넓은 화면에서 그 폭을 혼자 물게 된다 — 그것이 원래의 고장이었다.
 *
 * ```
 * 고정 폭 저장소 대상
 * 1920 312 451 451 ← 브랜치 55자가 잘리지 않고 들어간다
 * 1440 312 403 403
 * 1024 312 203 203
 * 768 208 — 254
 * 390 208 — 144 (min-w 에 닿아 표만 60px 가로로 넘어간다)
 * ```
 *
 * 🔴 어느 폭에서도 **페이지·`<main>` 은 좌우로 넘치지 않는다**(실측 0). 390 에서 넘치는
 * 것은 표 자신의 `overflow-x-auto` 안이다.
 *
 * 행 높이는 데이터와 폭에 관계없이 **54~55px 로 일정하다.** 예전에는 같은 데이터에서
 * 첫 행만 131px 이었다 — 브랜치가 87px 칸 안에서 글자 단위로 일곱 줄 접혔기 때문이다.
 */
export const REVIEW_COL = {
  /**
   * 어느 Agent 가 남겼나.
   *
   * 🔴 **이 칸의 값은 이제 사람이 지은 «연결 이름»이다**(`agent_credentials.name` —
   * `lib/api/api-key-auth.ts`). 예전엔 `codex`·`claude-code` 처럼 짧고 예측 가능해
   * `w-32`(글자 자리 104px)로 충분했는데, 지금은 `claude-code-mcp`(116px)·
   * `browser-credential-verify` 같은 이름이 들어온다 — 그 폭에서는 `claude-code-mc…`
   * 로 잘려 **끝에서만 갈리는 이름 둘을 구별하지 못한다**(`claude-code-mcp` ·
   * `claude-code-cli`). 그것은 이번에 고친 회귀가 픽셀 수준에서 다시 생기는 것이다.
   *
   * 🔴 **그렇다고 모든 폭에서 넓히지 않는다.** 390·768 에서 넓히면 그만큼 대상 칸을
   * 빼앗는다(실측: 144→112 · 254→222). 그 구간은 표가 이미 가로로 넘치는 자리라,
   * 자리가 생기는 `lg` 부터만 넓힌다 — 저장소 칸이 열리는 것과 같은 자리다.
   *
   * ```
   * 리뷰어 대상
   * 390·768 128 (예전과 같다) 144·254 (예전과 같다)
   * 1024~ 160 (`claude-code-mcp` 가 온전히) 187 (−16)
   * ```
   */
  reviewer: "w-32 lg:w-40",
  repository: "hidden lg:table-cell",
  /** 폭을 적지 않는다 — 저장소와 남는 폭을 나눠 갖는다. */
  target: "",
  /** 세 자리 숫자와 머리글(`ISSUES`) 기준. */
  issues: "w-20 text-right",
  /**
   * `2026-08-28` 고정 형식(`lib/format/date.ts`)이라 자릿수가 늘지 않는다.
   * `md:hidden` 은 위의 사이드바 구간을 위한 것이다 — 실수가 아니다.
   */
  date: "w-[6.5rem] hidden text-right sm:table-cell md:hidden lg:table-cell",
} as const;

/**
 * 「무엇을 봤는가」 한 칸.
 *
 * 🔴 **`targetType` 에 없는 값을 지어내지 않는다.** 값은 `PULL_REQUEST`·`COMMIT`·`BRANCH`·
 * `REPOSITORY`·`MANUAL` 다섯뿐이고(`types/review.ts`), `branch`·`commitSha` 는 **둘 다
 * Nullable** 이다(`db/schema/review.ts`). 그래서 종류만으로 무엇을 그릴지 정하지 않고
 * **실제로 있는 값 중 가장 구체적인 것**을 앞에 세운다.
 *
 * ```
 * branch 있음 feature/auth-… a81f3c2
 * branch 없음·SHA 있음 a81f3c2
 * 둘 다 없음 Manual
 * ```
 *
 * ## 🔴 종류(`typeLabel`)는 «더 구체적인 값이 없을 때만» 그린다
 *
 * 예전에는 종류가 언제나 둘째 줄에 남아 한 칸이 두 줄이었다. 그런데 한 Project 의
 * Review 는 대개 같은 종류라 그 줄은 **모든 행에서 같은 낱말을 되풀이하면서** 행 높이를
 * 55px 로 밀어 올렸다 — 세로로 훑는 표에서 가장 값이 낮은 정보가 가장 비싼 자리를 썼다.
 * 「대상」이 답해야 하는 것은 «무슨 종류의 Review 였나»가 아니라 **«어느 코드를 봤나»**다.
 *
 * 종류가 사라지는 것이 아니다 — branch 도 SHA 도 없는 `REPOSITORY`·`MANUAL` 은 그것이
 * 유일하게 남은 값이라 그 행에서는 여전히 그린다. 나머지 행의 종류는 Review 상세의
 * 「대상」 절에 `targetType`·`branch`·`commit`·PR 번호로 온전히 남아 있다
 * (`ReviewDetailScreen`).
 *
 * 🔴 **목록에는 짧은 SHA 만 쓴다.** 40자는 끊을 자리가 없어 어떤 폭에서도 칸을 밀어낸다 —
 * 전체 값은 Review 상세에 있다(`ReviewDetailScreen`).
 *
 * 🔴 **Review 목록과 Project Overview 가 이 함수를 «함께» 쓴다.** 예전에는 Overview 가
 * `TYPE · branch · sha` 를 한 줄로 이어 붙여 그렸는데, 그 문자열에는 끊을 자리가 없어
 * 대상 칸이 **어느 폭에서나 770px** 로 굳었다 — 저장소 칸이 94px 로 뭉개지고 표가 1440
 * 에서도 61px 가로로 넘쳤다. 같은 뜻의 칸을 두 곳에서 다르게 그리면 한쪽만 고쳐진다.
 * 🔴 그래서 **그리는 자리도 하나**로 모았다 — `ReviewTargetCell`.
 *
 * 🔴 **`server-only` 모듈에서 타입을 끌어오지 않는다.** 필요한 것은 두 칸뿐이라 구조로
 * 받는다 — 이 파일이 조회 계층에 묶이지 않는다.
 *
 * @returns `primary` 는 이 Review 를 알아보는 값(잘릴 수 있다), `detail` 은 그 옆에 붙는
 *   **짧은 SHA**(없으면 `null` — 좁은 화면에서 접히는 자리다), `full` 은 잘린 값의
 *   전문(`title`).
 */
export function describeTarget(
  review: { branch: string | null; commitSha: string | null },
  typeLabel: string,
): { primary: string; detail: string | null; full: string | undefined } {
  const shortSha =
    review.commitSha === null ? null : review.commitSha.slice(0, 7);

  if (review.branch !== null) {
    return { primary: review.branch, detail: shortSha, full: review.branch };
  }

  if (shortSha !== null) {
    return {
      primary: shortSha,
      detail: null,
      // 상세로 가기 전에도 전체 SHA 를 확인할 수 있게 한다.
      full: review.commitSha ?? undefined,
    };
  }

  /*
 🔴 **여기서는 종류가 «가장 구체적인 값»이라 앞자리에 세운다.** 보조 자리에 두면 안
 된다 — 그 자리는 좁은 화면에서 접히므로(`ReviewTargetCell`), 390px 에서 이 행이
 「—」 하나만 남는다. **접혀도 되는 것은 더 구체적인 값이 옆에 있을 때뿐이다.**
 */
  return { primary: typeLabel, detail: null, full: undefined };
}
