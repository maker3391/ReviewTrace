import { TableCell } from "@/components/ui/table";
import {
  describeTarget,
  REVIEW_COL,
} from "@/features/reviews/components/review-table-columns";

/**
 * 「대상」 한 칸 — Review 목록과 Project Overview 가 **같이** 쓴다.
 *
 * 🔴 **같은 뜻의 칸을 두 곳에서 다르게 그리지 않는다.** `describeTarget` 은 이미 한 곳에
 * 모여 있었는데 «그린 결과»는 두 화면에 복사돼 있었다 — 한쪽만 고치면 같은 데이터가
 * 두 화면에서 다르게 보인다(CLAUDE.md 6). 규칙(순수 함수)과 표현(이 파일)을 각각 한
 * 자리에 둔다.
 *
 * ## 왜 한 줄인가
 *
 * ```
 * 예전 feature/auth-refactor 두 줄 · 행 55px
 * 커밋 · a81f3c2
 *
 * 지금 feature/auth-refactor a81f3c2 한 줄 · 행 41px
 * ```
 *
 * 세로로 훑는 표에서 **한 화면에 들어오는 행 수**가 곧 scanability 다. 아랫줄이 담던
 * 종류는 한 Project 안에서 거의 같은 값이라 모든 행에 같은 낱말을 되풀이하면서 행마다
 * 14px 을 썼다 — 값이 가장 낮은 정보가 가장 비싼 자리를 쓰고 있었다.
 *
 * 🔴 **그렇다고 열을 하나 더 만들지 않았다.** branch 와 commit 은 「어느 코드를 봤나」
 * 하나의 답이라 두 열로 가르면 표가 옆으로 길어지고 이름이 묻힌다(CLAUDE.md 16).
 *
 * ## 🔴 짧은 SHA 는 줄어들지 않는다 — 대신 `xl` 아래에서 «접힌다»
 *
 * `flex` 안에서 branch 쪽만 `min-w-0 truncate` 로 두고 SHA 는 `shrink-0` 이다. 반대로
 * 두면 좁은 폭에서 **자를 자리가 있는 쪽이 아니라 짧은 쪽이 먼저 잘려** `a81f…` 처럼
 * 아무 값도 아닌 것이 남는다. 잘려도 뜻이 남는 쪽(branch)만 자른다.
 *
 * 🔴 **그래도 SHA 를 «늘» 그리면 좁은 폭에서 손해만 본다.** 접는 자리를 고르려고 세
 * 가지를 실제로 재 봤다(2026-09-02 · component harness · dev 서버의 빌드된 CSS ·
 * 같은 fixture). 숫자는 **branch 글자가 실제로 보이는 폭(px)** 이다:
 *
 * ```
 * 화면 폭 대상 칸 예전(두 줄) SHA 를 늘 그림 지금(xl 에서만)
 * 390 144 120 72 120 ✔ 예전과 같다
 * 768 254 230 182 230 ✔
 * 1024 203 179 131 179 ✔
 * 1280 323 (안 잘림) 251 251 ← 여기만 손해
 * 1366~ 366+ (안 잘림) (안 잘림) (안 잘림)
 *
 * 행 높이 55 41 41
 * ```
 *
 * 🔴 **`lg` 아래에서는 한 줄로 만들어도 행이 줄지 않는다** — 리뷰어 칸이 저장소를 아랫줄로
 * 접어 어차피 두 줄(58px)이기 때문이다. 그 구간에서 SHA 를 그리는 것은 **branch 글자 수만
 * 내주고 아무것도 얻지 못하는 거래**다. `xl` 에서 접으면 **1280~1365 한 구간을 빼면 어느
 * 폭에서도 예전보다 좁아지지 않으면서** 행 높이가 55px → 41px 이 된다 — 한 화면에 들어오는
 * 행이 25% 는다.
 *
 * 🔴 **남는 손해를 숨기지 않는다**: 1280~1365 에서 **43자가 넘는 branch** 는 SHA 가 가져간
 * 56px 만큼 더 잘린다(위 표의 284px 짜리 이름이 251px 에서 잘렸다). 잘린 전문은 `title` 에
 * 그대로 있고, 1366 위로는 다시 온전히 보인다. `2xl` 로 더 미루면 1366 처럼 **자리가 남는
 * 폭에서까지** SHA 를 잃어 얻는 것보다 잃는 것이 크다.
 *
 * 🔴 **`detail` 은 언제나 짧은 SHA 다.** 종류(`MANUAL` 등)는 `describeTarget` 이
 * `primary` 로 올린다 — 접히는 자리에 두면 390px 에서 그 행이 통째로 비어 보인다.
 *
 * 🔴 **어느 폭에서도 페이지·`<main>` 은 좌우로 넘치지 않는다**(실측 0). 390px 에서
 * **표만** 제 `overflow-x-auto` 안에서 60px 넘어가는데, 그것은 `min-w-[22rem]` 때문이고
 * 이 변경 전후가 **같다**(`review-table-columns.ts`).
 */
export function ReviewTargetCell({
  review,
  typeLabel,
}: {
  review: { branch: string | null; commitSha: string | null };
  /** 이미 지역화된 `targetType` 이름표. 이 Component 는 사전을 읽지 않는다. */
  typeLabel: string;
}) {
  const target = describeTarget(review, typeLabel);

  return (
    <TableCell className={REVIEW_COL.target}>
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 truncate font-mono text-xs" title={target.full}>
          {target.primary}
        </span>
        {target.detail !== null && (
          <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground xl:inline">
            {target.detail}
          </span>
        )}
      </div>
    </TableCell>
  );
}
