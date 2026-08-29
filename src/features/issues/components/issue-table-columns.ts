/**
 * Issue 목록 표의 «폭 계약».
 *
 * 🔴 **표와 Skeleton 이 이 값을 함께 쓴다.** 두 곳에 따로 적으면 결과가 도착하는 순간
 * 열이 미끄러진다(Layout Shift). 실제 표에서 한 번 어긋난 적이 있어 여기로 모았다.
 *
 * ## 왜 `table-fixed` 인가 — 이것이 가로 스크롤의 «원인»이었다
 *
 * 기본 `table-auto` 에서는 칸 안의 글자가 열의 폭을 «밀어낸다». `TableCell` 은
 * `whitespace-nowrap` 이라 `codeapex-engineering/reviewtrace-backend-service` 같은 값
 * 하나가 Location 열을 456px 까지 벌렸고, 표는 컨테이너(1104px)보다 넓은 1248px 이 되어
 * **표 안에 가로 스크롤이 생겼다.** 정작 화면에는 500px 이 남아 있었다.
 *
 * `table-fixed` 에서는 **폭을 머리 행이 정하고 내용은 그 안에서 잘린다.** 값이 아무리 길어도
 * 표가 넓어지지 않는다. 🔴 그래서 `overflow-x-hidden` 으로 스크롤바를 «가리는» 것이 아니라
 * 넘칠 일 자체가 없어진다.
 *
 * ## 좁은 화면
 *
 * `min-w-[22rem]` — 이 아래로는 제목 칸이 100px 남짓이 되어 아무것도 읽히지 않는다.
 * 그때는 **표만** 자기 컨테이너 안에서 가로로 넘어간다(`Table` 의 `overflow-x-auto`).
 * 🔴 **페이지 자체는 좌우로 넘치지 않는다.**
 *
 * ## 열은 «중요한 순서»로 사라진다
 *
 * ```
 * 항상    Severity · Title · Status      무엇이 얼마나 급한가
 * lg~     + Location                     어디인가
 * xl~     + Category · Detected          어떤 갈래인가 · 언제부터인가
 * ```
 *
 * 🔴 **열을 아끼는 것은 제목을 위해서다.** 1024 에서 여섯 열을 다 세우면 제목 칸이 190px 밖에
 * 남지 않아 첫 낱말만 보인다 — 실제로 그렇게 그려 보고 고쳤다. 위 순서로는 320px 이 남는다.
 *
 * 숨은 값은 Issue 상세에 그대로 있고 Category 는 위의 Filter 로도 좁힌다 —
 * 목록에서 지운 것이 아니라 **좁은 폭에서 접은 것**이다.
 */
export const ISSUE_TABLE = "table-fixed min-w-[22rem]";

/**
 * 열마다의 폭과 «언제 보이는가».
 *
 * 고정 폭의 합은 넓은 화면에서 648px 이고, 남는 폭은 전부 제목이 가져간다 —
 * 1920 화면에서 제목 칸이 약 960px 이다(예전에는 448px 에서 잘렸다).
 */
export const ISSUE_COL = {
  /** `CRITICAL` Badge 가 잘리지 않는 최소치. */
  severity: "w-[5.5rem]",
  /** `EXCEPTION_HANDLING` 이 12px mono 로 들어가는 폭. 넘치면 잘린다. */
  category: "w-[9rem] hidden xl:table-cell",
  /** `owner/repository` 와 `file.ts:12-34` 두 줄이 들어간다. 둘 다 잘린다. */
  location: "w-[13rem] hidden lg:table-cell",
  /** `FALSE_POSITIVE` Badge 기준. */
  status: "w-[6.5rem]",
  detected: "w-[6.5rem] hidden text-right xl:table-cell",
} as const;
