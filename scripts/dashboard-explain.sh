#!/usr/bin/env bash
#
# Dashboard 질의의 실행 계획 — 실제 PostgreSQL · 실제 볼륨.
#
# 🔴 이 저장소는 「Index 는 조회 패턴에 근거해서만 추가한다」.
# 그 근거를 말로 적지 않고 **EXPLAIN ANALYZE 로 확인**하는 자리가 여기다.
#
# 무엇을 보는가
# - Dashboard 질의가 Seq Scan 대신 «넣어 둔 Index» 를 타는가
# - Project 집계가 Project 수만큼 질의를 늘리지 않는가 (N+1)
# - 넣어 둔 Index 중 «한 번도 쓰이지 않는» 것이 있는가
#
# 🔴 데이터를 남기지 않는다
# 전부 한 Transaction 안에서 만들고 **ROLLBACK 한다.** 기존 행은 읽지도 바꾸지도 않는다.
# 중간에 죽어도 Transaction 이 열린 채 끝나므로 커밋되지 않는다.
#
# 쓰는 법
# docker compose up -d (컨테이너 code-intelligence-postgres)
# bash scripts/dashboard-explain.sh
#
# 볼륨은 환경 변수로 바꾼다: WORKSPACES=20 PROJECTS=5 REPOS=3 SESSIONS=25 ISSUES=15
set -u

CONTAINER="${EXPLAIN_PG_CONTAINER:-code-intelligence-postgres}"
PGUSER_="${EXPLAIN_PG_USER:-code_intelligence}"
PGDB="${EXPLAIN_PG_DB:-code_intelligence}"

# 🔴 Workspace 를 «여럿» 만든다.
#
# 하나만 만들면 표의 100% 가 그 Workspace 것이라 `workspace_id` 조건이 아무것도 걸러 내지
# 못한다 — Planner 는 당연히 Seq Scan 을 고르고, 그 결과는 「Index 가 안 쓰인다」가 아니라
# **「시험이 잘못됐다」** 는 뜻이다. Tenant 가 여럿인 실제 모양으로 만들어야 판단할 수 있다.
WORKSPACES="${WORKSPACES:-20}"
PROJECTS="${PROJECTS:-5}"
REPOS="${REPOS:-3}"
SESSIONS="${SESSIONS:-25}"
ISSUES="${ISSUES:-15}"

psql_() { docker exec -i "$CONTAINER" psql -U "$PGUSER_" -d "$PGDB" -v ON_ERROR_STOP=1 "$@"; }

echo "===== Workspace ${WORKSPACES} × Project ${PROJECTS} × Repo ${REPOS} × Session ${SESSIONS} × Issue ${ISSUES} ====="
echo " (조회 대상은 그중 Workspace 하나 — 나머지는 다른 Tenant 의 잡음이다)"
echo

psql_ <<SQL
BEGIN;

-- ── 시험용 Workspace 여럿. 기존 행은 건드리지 않는다 ───────────────────────────
INSERT INTO workspaces (slug, name)
SELECT 'explain-tmp-' || w, 'EXPLAIN 시험 ' || w
FROM generate_series(1, ${WORKSPACES}) w;

-- 조회 대상은 그중 «하나»다. 나머지는 다른 Tenant 의 잡음으로 남는다.
CREATE TEMP TABLE _ws ON COMMIT DROP AS
SELECT id FROM workspaces WHERE slug = 'explain-tmp-1';

INSERT INTO projects (workspace_id, name, slug)
SELECT w.id, 'P' || g, 'p' || g
FROM workspaces w, generate_series(1, ${PROJECTS}) g
WHERE w.slug LIKE 'explain-tmp-%';

INSERT INTO repositories
 (workspace_id, project_id, provider, external_repository_id, owner, name, full_name)
SELECT p.workspace_id, p.id, 'GITHUB',
 p.id || '-' || r, 'acme', 'svc' || r, 'acme/svc' || r
FROM projects p
JOIN workspaces w ON w.id = p.workspace_id AND w.slug LIKE 'explain-tmp-%',
 generate_series(1, ${REPOS}) r;

INSERT INTO review_sessions
 (workspace_id, repository_id, target_type, reviewer_type, reviewer_name, created_at)
SELECT r.workspace_id, r.id, 'COMMIT', 'AGENT', 'codex',
 now() - (s || ' days')::interval
FROM repositories r
JOIN workspaces w ON w.id = r.workspace_id AND w.slug LIKE 'explain-tmp-%',
 generate_series(1, ${SESSIONS}) s;

INSERT INTO review_issues
 (workspace_id, repository_id, review_session_id, title, severity, category, status,
 pattern_key, first_detected_at, resolved_at, resolution_summary)
SELECT rs.workspace_id, rs.repository_id, rs.id,
 'Issue ' || i,
 (ARRAY['CRITICAL','HIGH','MEDIUM','LOW','INFO'])[1 + (i % 5)]::issue_severity,
 (ARRAY['TRANSACTION','SECURITY','PERFORMANCE','VALIDATION'])[1 + (i % 4)]::issue_category,
 CASE WHEN i % 3 = 0 THEN 'RESOLVED' ELSE 'OPEN' END::issue_status,
 (ARRAY['N_PLUS_ONE','MISSING_VALIDATION','EXTERNAL_IO_IN_TRANSACTION'])[1 + (i % 3)],
 rs.created_at,
 CASE WHEN i % 3 = 0 THEN rs.created_at + interval '1 day' END,
 CASE WHEN i % 3 = 0 THEN '이렇게 고쳤다' END
FROM review_sessions rs
JOIN workspaces w ON w.id = rs.workspace_id AND w.slug LIKE 'explain-tmp-%',
 generate_series(1, ${ISSUES}) i;

-- 🔴 **Activity 가 없으면 Frequent Patterns 를 재도 지금 질의를 잰 것이 아니다.**
-- encounter 집계가 issue_activities 를 LEFT JOIN 하므로, 그 표가 비어 있으면 join 이
-- 공짜가 되어 실제보다 빠른 숫자가 나온다. 최초 발견(DETECTED) 1건에 더해 일부에
-- REVIEWED_AGAIN·FIX_ATTEMPTED 를 섞어 실제 모양을 만든다.
INSERT INTO issue_activities (workspace_id, review_issue_id, type, actor_type, actor_name, created_at)
SELECT i.workspace_id, i.id, 'DETECTED', 'AGENT', 'codex', i.first_detected_at
FROM review_issues i
JOIN workspaces w ON w.id = i.workspace_id AND w.slug LIKE 'explain-tmp-%';

INSERT INTO issue_activities (workspace_id, review_issue_id, type, actor_type, actor_name, created_at)
SELECT i.workspace_id, i.id, 'REVIEWED_AGAIN', 'AGENT', 'codex',
 i.first_detected_at + interval '3 days'
FROM review_issues i
JOIN workspaces w ON w.id = i.workspace_id AND w.slug LIKE 'explain-tmp-%'
WHERE ('x' || substr(md5(i.id::text), 1, 4))::bit(16)::int % 3 = 0;

INSERT INTO issue_activities (workspace_id, review_issue_id, type, actor_type, actor_name, created_at)
SELECT i.workspace_id, i.id, 'FIX_ATTEMPTED', 'AGENT', 'claude',
 i.first_detected_at + interval '5 days'
FROM review_issues i
JOIN workspaces w ON w.id = i.workspace_id AND w.slug LIKE 'explain-tmp-%'
WHERE ('x' || substr(md5(i.id::text), 1, 4))::bit(16)::int % 5 = 0;

ANALYZE projects;
ANALYZE repositories;
ANALYZE review_sessions;
ANALYZE review_issues;
ANALYZE issue_activities;

SELECT '전체 review_issues=' || count(*) FROM review_issues;
SELECT '대상 Workspace 의 review_issues=' || count(*)
FROM review_issues WHERE workspace_id = (SELECT id FROM _ws);
SELECT '대상 비중=' ||
 round(100.0 * count(*) FILTER (WHERE workspace_id = (SELECT id FROM _ws))
 / greatest(count(*), 1), 1) || '%'
FROM review_issues;

\\echo
\\echo '===== 1. Workspace Dashboard — Needs Attention ====='
\\echo ' 기대: review_issues_workspace_list_idx'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT i.id, i.title, i.severity, p.slug, r.full_name, i.first_detected_at
FROM review_issues i
JOIN repositories r ON r.id = i.repository_id
JOIN projects p ON p.id = r.project_id
WHERE i.workspace_id = (SELECT id FROM _ws)
 AND i.status IN ('OPEN','IN_PROGRESS','REOPENED')
ORDER BY i.severity ASC, i.first_detected_at ASC
LIMIT 8;

\\echo
\\echo '===== 2. Workspace Dashboard — KPI (FILTER 한 문장) ====='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT
 count(*) FILTER (WHERE first_detected_at >= now() - interval '30 days')::int,
 count(*) FILTER (WHERE resolved_at >= now() - interval '30 days')::int,
 count(*) FILTER (WHERE status IN ('OPEN','IN_PROGRESS','REOPENED'))::int
FROM review_issues
WHERE workspace_id = (SELECT id FROM _ws);

\\echo
\\echo '===== 3. Workspace Dashboard — Frequent Patterns (encounter 집계) ====='
\\echo ' 🔴 이것이 지금 findFrequentPatterns 가 실제로 내는 모양이다.'
\\echo '    Issue 행 수가 아니라 «최초 발견 + REVIEWED_AGAIN» 을 세므로 issue_activities 를'
\\echo '    LEFT JOIN 하고, 그 fan-out 을 count(distinct) 로 되돌린다.'
\\echo ' 기대: review_issues_workspace_category_idx + issue_activities_issue_created_at_idx'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT i.pattern_key, i.category,
 count(DISTINCT i.id)::int AS unique_issues,
 (count(DISTINCT i.id)
   + count(a.id) FILTER (WHERE a.type = 'REVIEWED_AGAIN'))::int AS encounters,
 count(DISTINCT i.id) FILTER (WHERE i.status = 'RESOLVED')::int AS resolved_count,
 greatest(
   max(i.first_detected_at),
   coalesce(
     max(a.created_at) FILTER (WHERE a.type = 'REVIEWED_AGAIN'),
     max(i.first_detected_at)
   )
 ) AS last_encounter_at
FROM review_issues i
JOIN repositories r
  ON r.id = i.repository_id AND r.workspace_id = i.workspace_id
LEFT JOIN issue_activities a
  ON a.review_issue_id = i.id AND a.workspace_id = i.workspace_id
WHERE i.workspace_id = (SELECT id FROM _ws) AND i.pattern_key IS NOT NULL
GROUP BY i.pattern_key, i.category
ORDER BY 4 DESC, 6 DESC
LIMIT 8;

\\echo
\\echo '===== 3-b. 같은 화면의 «옛» 모양 — 비교용으로만 남긴다 ====='
\\echo ' 🔴 이 질의는 제품에 더 없다. count(distinct) 가 HashAggregate 를 GroupAggregate 로'
\\echo '    바꾸므로 3 번이 이것보다 느린 것은 정상이다 — 얼마나 벌어지는지를 본다.'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT i.pattern_key, i.category, count(*)::int,
 count(*) FILTER (WHERE i.status = 'RESOLVED')::int,
 max(i.first_detected_at)
FROM review_issues i
JOIN repositories r ON r.id = i.repository_id
WHERE i.workspace_id = (SELECT id FROM _ws) AND i.pattern_key IS NOT NULL
GROUP BY i.pattern_key, i.category
ORDER BY count(*) DESC, max(i.first_detected_at) DESC
LIMIT 8;

\\echo
\\echo '===== 3-c. create_review Knowledge preflight — 후보 pool (Repository 하나) ====='
\\echo ' 기대: Repository 로 먼저 좁힌 뒤 Activity 를 index 로 붙는다'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT i.id, i.title, i.status, i.severity, i.file_path,
 (1 + count(a.id) FILTER (WHERE a.type = 'REVIEWED_AGAIN'))::int AS encounters
FROM review_issues i
JOIN repositories r
  ON r.id = i.repository_id AND r.workspace_id = i.workspace_id
LEFT JOIN issue_activities a
  ON a.review_issue_id = i.id AND a.workspace_id = i.workspace_id
WHERE i.workspace_id = (SELECT id FROM _ws)
  AND i.repository_id = (
    SELECT id FROM repositories WHERE workspace_id = (SELECT id FROM _ws) LIMIT 1
  )
  AND i.status IN ('OPEN','IN_PROGRESS','REOPENED','RESOLVED')
GROUP BY i.id, i.title, i.status, i.severity, i.file_path, i.first_detected_at
ORDER BY i.severity ASC, i.id ASC
LIMIT 200;

\\echo
\\echo '===== 4. Project 목록 집계 — 🔴 N+1 이 아닌지 (문장 하나여야 한다) ====='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT p.id, p.name,
 coalesce(rs.repository_count, 0),
 coalesce(vs.review_count, 0),
 coalesce(isx.open_issue_count, 0)
FROM projects p
LEFT JOIN (
 SELECT project_id, count(*)::int AS repository_count
 FROM repositories WHERE workspace_id = (SELECT id FROM _ws) GROUP BY project_id
) rs ON rs.project_id = p.id
LEFT JOIN (
 SELECT r.project_id, count(*)::int AS review_count
 FROM review_sessions s JOIN repositories r ON r.id = s.repository_id
 WHERE s.workspace_id = (SELECT id FROM _ws) GROUP BY r.project_id
) vs ON vs.project_id = p.id
LEFT JOIN (
 SELECT r.project_id,
 count(*) FILTER (WHERE i.status IN ('OPEN','IN_PROGRESS','REOPENED'))::int AS open_issue_count
 FROM review_issues i JOIN repositories r ON r.id = i.repository_id
 WHERE i.workspace_id = (SELECT id FROM _ws) GROUP BY r.project_id
) isx ON isx.project_id = p.id
WHERE p.workspace_id = (SELECT id FROM _ws)
ORDER BY p.name;

\\echo
\\echo '===== 5. Project Dashboard — Open Issues (Repository Join 으로 좁힘) ====='
\\echo ' 기대: repositories_project_idx 를 타고 Project 로 먼저 좁는다'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT i.id, i.title, i.severity, r.full_name
FROM review_issues i
JOIN repositories r ON r.id = i.repository_id
WHERE i.workspace_id = (SELECT id FROM _ws)
 AND r.project_id = (SELECT id FROM projects WHERE workspace_id = (SELECT id FROM _ws) ORDER BY slug LIMIT 1)
 AND i.status IN ('OPEN','IN_PROGRESS','REOPENED')
ORDER BY i.severity ASC, i.first_detected_at ASC
LIMIT 8;

\\echo
\\echo '===== 6. Issue 목록 — Project Scope + 검색 ====='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT i.id, i.title, r.full_name
FROM review_issues i
JOIN repositories r ON r.id = i.repository_id
WHERE i.workspace_id = (SELECT id FROM _ws)
 AND r.project_id = (SELECT id FROM projects WHERE workspace_id = (SELECT id FROM _ws) ORDER BY slug LIMIT 1)
ORDER BY i.first_detected_at DESC, i.id DESC
LIMIT 25;

\\echo
\\echo '===== 7. Index 사용량 — 🔴 한 번도 안 쓰인 Index 를 찾는다 ====='
SELECT indexrelname AS index, idx_scan AS scans
FROM pg_stat_user_indexes
WHERE relname IN ('review_issues','repositories','review_sessions','projects','knowledge_pages')
ORDER BY idx_scan ASC, indexrelname;

ROLLBACK;
SQL

echo
echo "===== ROLLBACK 완료 — 남은 시험 데이터 확인 ====="
docker exec -i "$CONTAINER" psql -U "$PGUSER_" -d "$PGDB" -t -A \
 -c "select 'workspaces(explain-tmp)=' || count(*) from workspaces where slug like 'explain-tmp-%'" \
 -c "select 'projects=' || count(*) from projects" \
 -c "select 'review_issues=' || count(*) from review_issues"
