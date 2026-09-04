ALTER TABLE "issue_activities" ADD COLUMN "ordinal" integer;--> statement-breakpoint
--
-- 🔴 기존 행에 순번을 채운다. `db:generate` 는 이 문장을 만들어 주지 않는다 —
-- Column 만 더하면 쌓여 있던 Activity 가 전부 비어 있어, 순번으로 정렬하는 순간
-- History 가 통째로 «순서 없음»이 된다.
--
-- 🔴 **여기서 부여하는 것은 「옳은 순서」가 아니라 「되찾을 수 있는 최선」이다.**
-- 지금 쌓인 행에는 진짜 생성 순서를 복원할 정보가 없다. `created_at` 이 같은 행들
-- 사이의 순서는 알 수 없으므로 `id` 로 갈라 **결정론만** 얻는다 — 새로 들어오는 행부터
-- 실제 순서가 정확해진다.
--
-- 🔴 **다시 돌려도 안전하다.** `WHERE ordinal IS NULL` 이라, 부분 실패 뒤 재실행하면
-- 이미 채워진 행을 건드리지 않고 남은 것만 채운다. 순번은 그 Issue 의 «현재 최대값»
-- 뒤에서 이어지므로 unique 와 부딪히지 않는다.
--
UPDATE "issue_activities" AS a
   SET "ordinal" = base.max_ordinal + n.rn
  FROM (
    SELECT
      "id",
      "review_issue_id",
      row_number() OVER (
        PARTITION BY "review_issue_id"
        ORDER BY "created_at", "id"
      ) AS rn
    FROM "issue_activities"
    WHERE "ordinal" IS NULL
  ) AS n,
  LATERAL (
    SELECT COALESCE(MAX(m."ordinal"), 0) AS max_ordinal
    FROM "issue_activities" AS m
    WHERE m."review_issue_id" = n."review_issue_id"
  ) AS base
 WHERE a."id" = n."id";--> statement-breakpoint
CREATE UNIQUE INDEX "issue_activities_issue_ordinal_unique" ON "issue_activities" USING btree ("review_issue_id","ordinal") WHERE "issue_activities"."ordinal" is not null;
