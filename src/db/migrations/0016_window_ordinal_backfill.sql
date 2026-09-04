--
-- 🔴 **배포 창에 생긴 빈 순번을 닫는다.** Schema 는 바뀌지 않는다 — 데이터만 고친다.
--
-- `0015` 가 운영에 적용된 시점과 순번을 «채우는» 코드가 배포된 시점 사이에 들어온
-- Activity 는 `ordinal` 이 비어 있다. 그 뒤에 들어온 행은 `MAX(ordinal) + 1` 을 받는데,
-- `MAX` 는 `NULL` 을 세지 않으므로 **창에서 들어온 행이 그보다 «뒤» 번호를 갖지 못한다.**
-- 그러면 `ORDER BY ordinal ... nulls last` 가 그 행을 실제보다 뒤에 그린다.
--
-- 🔴 **번호를 이어 붙이는 것으로는 고칠 수 없다.** 창에서 들어온 행은 이미 번호가 붙은
-- 행들 «사이»에 끼어 있어서, 그 Issue 의 순번을 통째로 다시 매겨야 한다.
--
-- 🔴 **다시 돌려도 «결과»는 안전하다.** 대상은 「비어 있는 행을 «가진» Issue」뿐이라, 창이
-- 없었으면 한 행도 건드리지 않고 끝난다.
--
-- 🔴 **다만 `db:migrate` 가 이것을 다시 돌려 주지는 않는다.** 한 번 적용된 migration 은
-- 기록에 남아 건너뛰어진다 — 이 실행이 놓친 행이 생기면 **새 migration 을 만들거나 같은
-- SQL 을 손으로 돌려야** 한다. 「다시 db:migrate 하면 된다」가 아니다.
--
-- 🔴 **그래서 실행 시점이 조건이다.** 순번을 채우는 코드가 배포를 «마치고» 옛 instance 가
-- 완전히 빠진 뒤에 누른다. 그 전에 누르면 아직 도는 옛 코드가 새 `NULL` 을 만들고, 그것은
-- 이 실행이 잠근 집합 밖이라 그대로 남는다.
--

--
-- 0) 🔴 **애플리케이션과 «같은» 잠금을 먼저 잡는다.**
--
-- 이 migration 은 서비스가 살아 있는 동안 돈다. 애플리케이션은 Activity 를 쓰기 전에
-- 부모 `review_issues` 행을 `FOR UPDATE` 로 잠그는데(`issue-activity-ordinal.ts`),
-- migration 이 그것을 건너뛰고 `issue_activities` 를 직접 고치면 **두 주체가 같은 Issue 의
-- 순번을 동시에 정한다.** 그러면 아래 재배열과 새 INSERT 가 같은 번호를 노려 `23505` 가
-- 나거나, 재배열 도중의 중간 상태를 writer 가 최대값으로 읽어 엉뚱한 번호를 계산한다.
--
-- 🔴 **`order by id` 를 그대로 지킨다** — 애플리케이션이 여러 Issue 를 잠글 때 쓰는 순서와
-- 같아야 고리가 닫히지 않는다(`@/db` 의 전역 잠금 순서).
--
-- 🔴 **잠글 대상을 고르는 subquery 는 잠금 «밖»에서 평가된다.** 그 뒤에 새로 생기는 빈
-- 순번은 이 실행이 보지 못한다 — 그래서 위 「실행 시점」 조건이 필요하다. 놓친 것이 남으면
-- `db:migrate` 가 아니라 **새 migration 이나 손으로 돌리는 같은 SQL** 로 메워야 한다.
--
SELECT "id"
  FROM "review_issues"
 WHERE "id" IN (
   SELECT DISTINCT "review_issue_id"
     FROM "issue_activities"
    WHERE "ordinal" IS NULL
 )
 ORDER BY "id"
   FOR UPDATE;--> statement-breakpoint

--
-- 1) 대상 Issue 의 «기존» 순번을 겹치지 않는 영역으로 밀어 둔다.
--
-- 🔴 순번을 재배열하는 UPDATE 는 한 문장으로 할 수 없다. unique index 가 지연되지 않아서,
-- 아직 옛 값을 쓰고 있는 행과 새 값이 부딪히면 그 자리에서 `23505` 다. 먼저 겹치지 않는
-- 영역으로 밀어 두면 다음 문장이 1 부터 자유롭게 매길 수 있다.
--
-- 🔴 **`NULL` 로 비우지 않는다.** 비우면 아래에서 「같은 transaction 에서 만들어진 행들」의
-- 상대 순서를 잃는다 — 그것을 아는 유일한 값이 지금의 `ordinal` 이다.
--
-- 🔴 **고정된 상수로 밀지 않는다.** 큰 양수(`+1000000`)는 `integer` 상한(2,147,483,647)
-- 가까이에서 넘치고, 고정된 큰 음수(`-1000000000`)도 안전하지 않다 — 순번이 10억을 넘으면
-- 뺀 결과가 **다시 양수**가 되어 아래에서 매기는 `1..n` 과 부딪힌다. 순번의 상한을 막는
-- 제약이 Database 에 없으므로 「그럴 리 없다」에 기대지 않는다.
--
-- 🔴 **그 Issue 의 최대값만큼 민다.** 결과는 `ordinal - (max + 1)` 이라
-- **언제나 `-max` 이상 `-1` 이하**다 — 반드시 음수이므로 `1..n` 과 겹칠 수 없고,
-- `-max` 는 `integer` 하한(-2,147,483,648)을 넘지 못한다(`max` 가 그 상한 안이므로).
-- Issue 마다 «같은» 값을 빼는 것이라 그 안의 상대 순서도 그대로다.
--
-- 🔴 **`LATERAL` 로 쓰지 않는다.** `UPDATE ... FROM LATERAL (…)` 안에서는 갱신 대상 별칭을
-- 참조하지 못한다(`invalid reference to FROM-clause entry`). 대상 Issue 의 최대값을 먼저
-- 한 번에 구해 붙인다.
UPDATE "issue_activities" AS a
   SET "ordinal" = a."ordinal" - peak."max_ordinal" - 1
  FROM (
    SELECT "review_issue_id", MAX("ordinal") AS "max_ordinal"
      FROM "issue_activities"
     WHERE "review_issue_id" IN (
       SELECT DISTINCT "review_issue_id"
         FROM "issue_activities"
        WHERE "ordinal" IS NULL
     )
     GROUP BY "review_issue_id"
  ) AS peak
 WHERE a."review_issue_id" = peak."review_issue_id"
   AND a."ordinal" IS NOT NULL;--> statement-breakpoint

--
-- 2) 그 Issue 들의 순번을 «시각 -> 옛 순번 -> id» 순서로 1 부터 다시 매긴다.
--
-- 🔴 이것도 「옳은 순서」가 아니라 「되찾을 수 있는 최선」이다. 창에서 들어온 행에는
-- 그 Issue 안의 실제 순서를 복원할 정보가 없어 시각으로 세우고, 시각까지 같으면 `id` 로
-- 갈라 **결정론만** 얻는다.
--
UPDATE "issue_activities" AS a
   SET "ordinal" = n.rn
  FROM (
    SELECT
      "id",
      row_number() OVER (
        PARTITION BY "review_issue_id"
        ORDER BY "created_at", "ordinal" NULLS LAST, "id"
      ) AS rn
    FROM "issue_activities"
    WHERE "review_issue_id" IN (
      SELECT DISTINCT "review_issue_id"
        FROM "issue_activities"
       WHERE "ordinal" IS NULL
    )
  ) AS n
 WHERE a."id" = n."id";
