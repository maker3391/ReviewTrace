import "server-only";

import { asc, eq, inArray, max, sql } from "drizzle-orm";

import type { DbExecutor } from "@/db";
import { issueActivities, reviewIssues } from "@/db/schema";

/**
 * `issue_activities.ordinal` 을 정하는 규칙. **Activity 를 쓰는 세 경로가 전부 여기를 지난다.**
 *
 * ```
 * issue-status-service     상태 전이       Activity 한 줄
 * issue-activity-service   History 추가    Activity 한 줄
 * review-ingest-service    Review 수집     Activity 여러 줄 · 여러 Issue
 * ```
 *
 * # 왜 순번이 필요한가
 *
 * `created_at` 은 `defaultNow()` 이고 PostgreSQL 의 `now()` 는 **transaction 시작 시각**이다.
 * 한 Transaction 이 같은 Issue 에 Activity 를 둘 넣으면 **50ms 를 쉬어도 같은 값**을 받는다.
 * 시각은 「언제」에 답할 뿐 「몇 번째」에 답하지 못한다.
 *
 * 🔴 **역할을 섞지 않는다.** `ordinal` 이 **순서**의 정본이고 `created_at` 은 사람에게
 * **보여 주는 시각**이다. 정렬을 시각으로 되돌리지 않는다.
 *
 * # 부여는 «잠근 뒤»에 한다
 *
 * 순번을 「지금 최대값 + 1」로 계산하는 한, 두 Transaction 이 같은 최대값을 읽는 창이 반드시
 * 있다. 실제 연결 둘로 재 보면 잠금이 없을 때 뒤엣것이 **막혀 기다리다 `23505` 로 실패**한다 —
 * unique 가 막아 주기는 하지만, `POST /reviews` 는 Session·Issue·Tag·Activity 가 한
 * Transaction 이라 그 실패가 **Review 통째로** 다시 도는 것을 뜻한다.
 *
 * 그래서 **`review_issues` 행을 먼저 잠근다.** 그러면 뒤엣것은 기다렸다가 **그대로 성공**하고
 * 재시도 경로 자체가 필요 없다. `issue-status-service` 가 이미 같은 행을 잠그고 있어
 * 새로운 잠금 순서가 생기지도 않는다.
 */

/**
 * Activity 를 붙일 Issue 들을 **한 문장에서 `id` 오름차순으로** 잠근다.
 *
 * 🔴 **순서가 이 함수의 전부다.** 여러 Issue 를 서로 다른 순서로 잠그면 고리가 닫힌다 —
 * 실제로 `40P01 deadlock detected` 를 재현했다. 전역 잠금 순서(`@/db`)가 「필요한 행을 한
 * 문장의 `ORDER BY` 안에 모두 넣어라」고 적어 둔 이유가 이것이다.
 *
 * 🔴 **이번 Transaction 이 «방금 INSERT 한» 행은 넘기지 않아도 된다.** 그 행은 아직 다른
 * Transaction 에 보이지 않아 경쟁 상대가 없다.
 */
export async function lockIssuesForActivity(
  executor: DbExecutor,
  issueIds: readonly string[],
): Promise<void> {
  const distinct = [...new Set(issueIds)];
  if (distinct.length === 0) {
    return;
  }

  await executor
    .select({ id: reviewIssues.id })
    .from(reviewIssues)
    .where(inArray(reviewIssues.id, distinct))
    .orderBy(asc(reviewIssues.id))
    .for("update");
}

/**
 * 그 Issue 들에 **다음에 붙일** 순번. Activity 가 하나도 없으면 `1` 이다.
 *
 * 🔴 **`lockIssuesForActivity` 뒤에 부른다.** 잠그지 않고 읽으면 그 값이 곧 낡는다.
 * 🔴 **Issue 개수만큼 질의하지 않는다** — 한 문장으로 묶어 센다.
 */
export async function nextActivityOrdinals(
  executor: DbExecutor,
  issueIds: readonly string[],
): Promise<Map<string, number>> {
  const distinct = [...new Set(issueIds)];
  const next = new Map<string, number>();
  if (distinct.length === 0) {
    return next;
  }

  const rows = await executor
    .select({
      reviewIssueId: issueActivities.reviewIssueId,
      highest: max(issueActivities.ordinal),
    })
    .from(issueActivities)
    .where(inArray(issueActivities.reviewIssueId, distinct))
    .groupBy(issueActivities.reviewIssueId);

  for (const row of rows) {
    next.set(row.reviewIssueId, (row.highest ?? 0) + 1);
  }
  return next;
}

/**
 * 한 문장에 실려 나갈 Activity 들에 순번을 매긴다. **입력 순서가 곧 순번 순서다.**
 *
 * 🔴 **한 문장 안에서는 서로의 INSERT 가 보이지 않는다.** 그래서 같은 Issue 가 목록에 두 번
 * 있으면 행마다 계산한 「지금 최대값 + 1」이 **같은 값**이 되고, 실제로 `23505` 가 난다
 * (실제 PostgreSQL 로 재현했다). 최대값이 아니라 **최대값 + 목록 안의 등장 순서**로 매기는
 * 이유가 이것이다.
 *
 * 🔴 **지금 제품 경로에서 그 반복이 일어나지는 않는다.** `review-ingest-service` 가
 * 넘기는 목록은 `prepareIssues` 가 `source + externalId` 로 이미 접어 둔 것이라 Issue 마다
 * 한 번뿐이다 — 실제 payload 로 확인했다. 이 계산은 그 dedup 이 사라졌을 때 조용히 깨지지
 * 않게 하는 것이지, **「지금 일어나는 일」이 아니다.**
 */
export function assignActivityOrdinals(
  issueIds: readonly string[],
  next: ReadonlyMap<string, number>,
): number[] {
  const cursor = new Map<string, number>();

  return issueIds.map((issueId) => {
    const ordinal = cursor.get(issueId) ?? next.get(issueId) ?? 1;
    cursor.set(issueId, ordinal + 1);
    return ordinal;
  });
}

/**
 * Activity 한 줄을 쓰는 경로가 쓰는 지름길 — 잠그고, 세고, 그 하나의 순번을 돌려준다.
 *
 * @param alreadyLocked 부르는 쪽이 그 Issue 행을 **이미 잠갔으면** `true`. 같은 행을 두 번
 *   잠그는 것은 무해하지만, 잠금을 어디서 잡았는지가 코드에 드러나는 편이 낫다.
 */
export async function nextActivityOrdinal(
  executor: DbExecutor,
  issueId: string,
  options: { alreadyLocked: boolean },
): Promise<number> {
  if (!options.alreadyLocked) {
    await lockIssuesForActivity(executor, [issueId]);
  }

  const rows = await executor
    .select({ highest: max(issueActivities.ordinal) })
    .from(issueActivities)
    .where(eq(issueActivities.reviewIssueId, issueId));

  return (rows[0]?.highest ?? 0) + 1;
}

/**
 * History 를 시간순으로 읽기 위한 정렬. **두 조회가 같은 것을 쓴다**
 * (`issue-detail-query.ts` · `issue-agent-query.ts`).
 *
 * 🔴 **`ordinal` 이 정본이고 뒤의 둘은 배포 창을 위한 것이다.** `0015` 가 적용된 뒤 순번을
 * 채우는 코드가 배포되기 전까지 들어온 행은 이 칸이 비어 있다 — 그것들만 뒤로 밀리고
 * 자기들끼리는 시각으로 선다. `0016` 이 그 행들을 채우면 이 뒷부분은 더 이상 걸리지 않는다.
 */
export const ACTIVITY_TIMELINE_ORDER = [
  sql`${issueActivities.ordinal} asc nulls last`,
  asc(issueActivities.createdAt),
  asc(issueActivities.id),
];
