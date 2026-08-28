#!/usr/bin/env bash
#
# Agent API E2E — 실제 서버 · 실제 PostgreSQL.
#
# 🔴 이 저장소는 「Compile 성공만으로 완료라고 판단하지 않는다」(CLAUDE.md 21).
#    Agent API 는 화면이 없어 눈으로 확인할 수 없으므로, 그 자리를 이 스크립트가 맡는다.
#
# 무엇을 지키는가
#   - API Key 원문이 Database 에 남지 않는다
#   - 잘못된·폐기된·만료된 키가 전부 같은 401 이다
#   - 한 Review 가 한 Transaction 으로 저장된다 (반쪽 Session 없음)
#   - 같은 Idempotency-Key 재전송이 ReviewSession 을 늘리지 않는다
#   - 🔴 Workspace 를 넘는 접근이 막힌다 (404, 403 이 아니다)
#   - 상태와 History 가 모순되지 않는다
#
# 쓰는 법
#   1) docker compose up -d          (컨테이너 code-intelligence-postgres)
#   2) pnpm dev -- -p 3930           (다른 터미널)
#   3) bash scripts/agent-api-e2e.sh
#
# 끝나면 만들어 둔 Workspace 를 지운다. 실패해도 지운다.
#
set -u

PORT="${E2E_PORT:-3930}"
BASE="http://localhost:${PORT}/api/v1"
CONTAINER="${E2E_PG_CONTAINER:-code-intelligence-postgres}"
PGUSER_="${E2E_PG_USER:-code_intelligence}"
PGDB="${E2E_PG_DB:-code_intelligence}"
WORK="$(mktemp -d)"


psql_() { docker exec -i "$CONTAINER" psql -U "$PGUSER_" -d "$PGDB" "$@"; }
psql1() { psql_ -t -A -c "$1"; }

cleanup() { psql1 "delete from workspaces where slug like 'e2e-%'" >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf 'OK   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf 'FAIL %s\n' "$1"; }
# expect <이름> <기대 status> <curl 인자...>
expect() {
  local name="$1" want="$2"; shift 2
  local code
  code=$(curl -s -o "$WORK/body" -w "%{http_code}" "$@")
  if [ "$code" = "$want" ]; then ok "$name ($code)"
  else bad "$name — got=$code want=$want"; head -c 300 "$WORK/body"; echo; fi
}
# 본문에서 값 하나를 꺼낸다. 셸이 UTF-8 을 망가뜨리지 않게 node 를 쓴다.
pick() { node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(eval('d.'+process.argv[2]))" "$WORK/body" "$1"; }

echo "===== 0. 준비 — 실제 생성기로 API Key 를 만들고 Hash 만 저장한다 ====="
node -e "
const fs=require('fs');
import(new URL('../src/lib/api/api-key-token.ts', 'file://' + process.argv[1].replace(/\\\\/g,'/') + '/scripts/').href).then(m => {
  const keys = Object.fromEntries(['alpha','beta','revoked','expired'].map(n => [n, m.generateApiKey()]));
  fs.writeFileSync(process.argv[2] + '/keys.json', JSON.stringify(keys), 'utf8');
  for (const [n,k] of Object.entries(keys)) fs.writeFileSync(process.argv[2] + '/tok_' + n, k.plainToken, 'utf8');
  // 🔴 원문은 여기(임시 디렉터리)에만 있다. SQL 에는 Hash 와 Prefix 만 나간다.
  const row = (ws,name,k,exp,rev) =>
    \`('\${ws}','\${name}','\${k.keyPrefix}','\${k.keyHash}',\${exp},\${rev})\`;
  const A='aaaaaaaa-0000-4000-8000-000000000001', B='bbbbbbbb-0000-4000-8000-000000000002';
  fs.writeFileSync(process.argv[2] + '/seed.sql', [
    \`insert into workspaces (id, slug, name) values ('\${A}','e2e-alpha','E2E Alpha'),('\${B}','e2e-beta','E2E Beta');\`,
    'insert into api_keys (workspace_id, name, key_prefix, key_hash, expires_at, revoked_at) values',
    [row(A,'alpha-agent',keys.alpha,'null','null'),
     row(B,'beta-agent',keys.beta,'null','null'),
     row(A,'alpha-revoked',keys.revoked,'null','now()'),
     row(A,'alpha-expired',keys.expired,\"now() - interval '1 day'\",'null')].join(',\n') + ';',
  ].join('\n'), 'utf8');
}).catch(e => { console.error('키 생성 실패:', e.message); process.exit(1); });
" "$(pwd)" "$WORK" || exit 1

psql_ -v ON_ERROR_STOP=1 -q < "$WORK/seed.sql" || { echo "시드 실패"; exit 1; }
A=$(cat "$WORK/tok_alpha"); B=$(cat "$WORK/tok_beta")
REV=$(cat "$WORK/tok_revoked"); EXP=$(cat "$WORK/tok_expired")

STORED=$(psql1 "select count(*) from api_keys where key_hash like 'ci\\_%' or key_hash !~ '^[0-9a-f]{64}\$'")
if [ "$STORED" = "0" ]; then ok "🔴 API Key 원문이 Database 에 없다 (전부 64자 SHA-256 hex)"; else bad "원문으로 보이는 key_hash 가 $STORED 행 있다"; fi

node -e "
const fs=require('fs');
fs.writeFileSync(process.argv[1]+'/review.json', JSON.stringify({
  repository:{provider:'GITHUB',externalRepositoryId:'987654321',owner:'SMIL-26',name:'smil-be',
    fullName:'SMIL-26/smil-be',defaultBranch:'develop',htmlUrl:'https://github.com/SMIL-26/smil-be'},
  target:{type:'COMMIT',branch:'develop',commitSha:'a81f3c2'},
  reviewer:{type:'AGENT',name:'codex',version:'1.0.0'},
  summary:'Refresh token 회전 경합 검토',
  issues:[
    {severity:'HIGH',category:'CONCURRENCY',patternKey:'REFRESH_TOKEN_RACE_CONDITION',
     title:'Refresh token rotation race condition',
     description:'Concurrent requests can rotate the same token family.',
     filePath:'src/RefreshTokenService.java',startLine:82,endLine:101,
     suggestion:'Make family rotation atomic.',source:'codex',externalId:'CDX-1',
     tags:['refresh-token','Race Condition','race_condition']},
    {severity:'CRITICAL',category:'TRANSACTION',patternKey:'EXTERNAL_IO_IN_TRANSACTION',
     title:'External API call inside DB transaction',filePath:'src/OrderService.java',startLine:40,
     source:'codex',externalId:'CDX-2',tags:['transaction']},
    {severity:'LOW',category:'CLEAN_CODE',title:'Unused import',tags:[]}]
}), 'utf8');
fs.writeFileSync(process.argv[1]+'/resolve.json', JSON.stringify({
  status:'RESOLVED', resolutionSummary:'회전을 Lua Script 한 번으로 원자화했다',
  actor:{type:'AGENT',name:'코덱스'}}), 'utf8');
fs.writeFileSync(process.argv[1]+'/reopen.json', JSON.stringify({
  status:'REOPENED', actor:{type:'HUMAN',name:'사장님'}}), 'utf8');
fs.writeFileSync(process.argv[1]+'/fix.json', JSON.stringify({
  type:'FIX_ATTEMPTED', actor:{type:'AGENT',name:'claude'},
  description:'Lua Script 로 회전을 원자화했다', commitSha:'def1234'}), 'utf8');
" "$WORK"
JSON='content-type: application/json'

echo
echo "===== 1. 인증 — 사유를 구분해 알려주지 않는다 ====="
expect "Authorization 없음"        401 -X POST "$BASE/reviews" -H "$JSON" -d '{}'
expect "형식이 아닌 키"            401 -X POST "$BASE/reviews" -H 'authorization: Bearer nonsense' -H "$JSON" -d '{}'
expect "형식은 맞지만 없는 키"      401 -X POST "$BASE/reviews" -H "authorization: Bearer ci_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" -H "$JSON" -d '{}'
expect "폐기된 키"                 401 -X POST "$BASE/reviews" -H "authorization: Bearer $REV" -H "$JSON" -d '{}'
expect "만료된 키"                 401 -X POST "$BASE/reviews" -H "authorization: Bearer $EXP" -H "$JSON" -d '{}'

echo
echo "===== 2. 검증 ====="
expect "잘못된 Payload"            400 -X POST "$BASE/reviews" -H "authorization: Bearer $A" -H "$JSON" -d '{"repository":{"provider":"GITLAB"},"issues":[{"severity":"URGENT"}]}'
expect "깨진 JSON"                 400 -X POST "$BASE/reviews" -H "authorization: Bearer $A" -H "$JSON" -d '{oops'

echo
echo "===== 3. Review 저장 ====="
expect "첫 저장"                   201 -X POST "$BASE/reviews" -H "authorization: Bearer $A" -H "$JSON" -H 'Idempotency-Key: e2e-run-1' --data-binary @"$WORK/review.json"
SESSION=$(pick reviewSessionId); REPO=$(pick repositoryId); ISSUE=$(pick "issues.find(i=>i.severity==='HIGH').id")
COUNT=$(psql1 "select count(*) from review_issues where review_session_id='$SESSION'")
if [ "$COUNT" = "3" ]; then ok "ReviewIssue 3건이 같은 Session 에 저장됐다"; else bad "Issue 수가 $COUNT 다"; fi
ACT=$(psql1 "select count(*) from issue_activities a join review_issues i on i.id=a.review_issue_id where i.review_session_id='$SESSION' and a.type='DETECTED'")
if [ "$ACT" = "3" ]; then ok "DETECTED Activity 가 자동으로 3건 생겼다"; else bad "DETECTED 가 $ACT 건이다"; fi
TAGS=$(psql1 "select count(*) from tags t join workspaces w on w.id=t.workspace_id where w.slug='e2e-alpha'")
if [ "$TAGS" = "3" ]; then ok "Tag 정규화 — Race Condition/race_condition 이 한 행으로 합쳐졌다"; else bad "Tag 가 $TAGS 행이다 (3 이어야 한다)"; fi

echo
echo "===== 4. Idempotency ====="
expect "같은 Idempotency-Key 재전송" 200 -X POST "$BASE/reviews" -H "authorization: Bearer $A" -H "$JSON" -H 'Idempotency-Key: e2e-run-1' --data-binary @"$WORK/review.json"
if [ "$(pick reviewSessionId)" = "$SESSION" ] && [ "$(pick idempotentReplay)" = "true" ]; then ok "같은 ReviewSession 을 돌려준다"; else bad "세션이 갈렸다"; fi
SESS=$(psql1 "select count(*) from review_sessions where repository_id='$REPO'")
if [ "$SESS" = "1" ]; then ok "ReviewSession 이 늘지 않았다"; else bad "Session 이 $SESS 개다"; fi

echo
echo "===== 5. Tenant 격리 ====="
expect "Workspace B 가 같은 GitHub Repository 를 저장" 201 -X POST "$BASE/reviews" -H "authorization: Bearer $B" -H "$JSON" -H 'Idempotency-Key: e2e-run-1' --data-binary @"$WORK/review.json"
if [ "$(pick repositoryId)" != "$REPO" ]; then ok "Workspace 마다 다른 repositories 행"; else bad "Repository 가 Tenant 를 넘어 공유됐다"; fi
expect "🔴 B 키로 A 의 Issue 에 Activity"  404 -X POST "$BASE/issues/$ISSUE/activities" -H "authorization: Bearer $B" -H "$JSON" -d '{"type":"COMMENT","actor":{"type":"AGENT","name":"intruder"},"description":"x"}'
expect "🔴 B 키로 A 의 Issue 상태 변경"    404 -X PATCH "$BASE/issues/$ISSUE" -H "authorization: Bearer $B" -H "$JSON" -d '{"status":"IGNORED"}'

echo
echo "===== 6. Activity ====="
expect "FIX_ATTEMPTED 추가"        201 -X POST "$BASE/issues/$ISSUE/activities" -H "authorization: Bearer $A" -H "$JSON" --data-binary @"$WORK/fix.json"
expect "행위자 없는 Activity"       400 -X POST "$BASE/issues/$ISSUE/activities" -H "authorization: Bearer $A" -H "$JSON" -d '{"type":"COMMENT","description":"x"}'
expect "UUID 아닌 issueId"          400 -X POST "$BASE/issues/not-a-uuid/activities" -H "authorization: Bearer $A" -H "$JSON" -d '{"type":"COMMENT","actor":{"type":"AGENT","name":"c"}}'
expect "없는 issueId"               404 -X POST "$BASE/issues/00000000-0000-4000-8000-000000000000/activities" -H "authorization: Bearer $A" -H "$JSON" -d '{"type":"COMMENT","actor":{"type":"AGENT","name":"c"}}'

echo
echo "===== 7. Resolution — 상태와 History 가 함께 움직인다 ====="
expect "요약 없는 RESOLVED"        400 -X PATCH "$BASE/issues/$ISSUE" -H "authorization: Bearer $A" -H "$JSON" -d '{"status":"RESOLVED"}'
expect "RESOLVED"                  200 -X PATCH "$BASE/issues/$ISSUE" -H "authorization: Bearer $A" -H "$JSON" --data-binary @"$WORK/resolve.json"
KOR=$(psql1 "select (resolution_summary ~ '[가-힣]')::text from review_issues where id='$ISSUE'")
if [ "$KOR" = "true" ]; then ok "한글 해결 요약이 UTF-8 로 온전히 저장됐다"; else bad "한글이 깨졌다"; fi
expect "REOPENED"                  200 -X PATCH "$BASE/issues/$ISSUE" -H "authorization: Bearer $A" -H "$JSON" --data-binary @"$WORK/reopen.json"
CLEARED=$(psql1 "select (resolved_at is null and resolution_summary is null)::text from review_issues where id='$ISSUE'")
if [ "$CLEARED" = "true" ]; then ok "REOPENED 가 resolvedAt·resolutionSummary 를 비웠다"; else bad "REOPENED 인데 해결 흔적이 남았다"; fi
KEPT=$(psql1 "select count(*) from issue_activities where review_issue_id='$ISSUE' and type='RESOLVED' and description ~ '[가-힣]'")
if [ "$KEPT" != "0" ]; then ok "지난 해결 요약이 RESOLVED Activity 에 남아 History 로 읽힌다"; else bad "지난 해결 요약이 사라졌다"; fi
BAD=$(psql1 "select count(*) from review_issues where (status='RESOLVED' and (resolved_at is null or resolution_summary is null)) or (status<>'RESOLVED' and (resolved_at is not null or resolution_summary is not null))")
if [ "$BAD" = "0" ]; then ok "🔴 상태와 시각·요약이 모순된 행이 하나도 없다"; else bad "모순된 행이 $BAD 개다"; fi

echo
echo "===== 8. Knowledge Context ====="
expect "Workspace A 조회"          200 "$BASE/knowledge/context?limit=10" -H "authorization: Bearer $A"
node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
console.log('   frequentPatterns:', j.frequentPatterns.map(p=>p.patternKey+' x'+p.occurrences+' (resolved '+p.resolvedCount+')').join(' | '));
console.log('   unresolved:', j.unresolvedIssues.map(i=>i.severity).join(','));" "$WORK/body"
expect "🔴 B 는 A 의 Resolution 을 못 본다" 200 "$BASE/knowledge/context?limit=10" -H "authorization: Bearer $B"
if [ "$(pick 'pastResolutions.length')" = "0" ]; then ok "B 의 pastResolutions 가 비어 있다"; else bad "다른 Tenant 의 해결 요약이 새어 나왔다"; fi
expect "🔴 남의 repositoryId 를 Filter 로"  200 "$BASE/knowledge/context?repositoryId=$REPO&limit=10" -H "authorization: Bearer $B"
if [ "$(pick 'frequentPatterns.length + d.recentHighSeverityIssues.length + d.unresolvedIssues.length + d.pastResolutions.length')" = "0" ]; then ok "남의 repositoryId 로는 아무것도 나오지 않는다"; else bad "다른 Tenant 데이터가 나왔다"; fi
expect "limit 상한 초과"           400 "$BASE/knowledge/context?limit=999" -H "authorization: Bearer $A"

echo
echo "===== 9. 같은 문제 재보고 (source + externalId) ====="
expect "다른 Idempotency-Key 로 재전송" 201 -X POST "$BASE/reviews" -H "authorization: Bearer $A" -H "$JSON" -H 'Idempotency-Key: e2e-run-2' --data-binary @"$WORK/review.json"
DUP=$(psql1 "select count(*) from review_issues where repository_id='$REPO' and external_id='CDX-1'")
if [ "$DUP" = "1" ]; then ok "같은 externalId 는 행이 늘지 않았다"; else bad "같은 문제가 $DUP 행으로 갈라졌다"; fi
AGAIN=$(psql1 "select count(*) from issue_activities where review_issue_id='$ISSUE' and type='REVIEWED_AGAIN'")
if [ "$AGAIN" != "0" ]; then ok "다시 만난 Issue 에 REVIEWED_AGAIN 이 남았다"; else bad "재보고가 History 에 남지 않았다"; fi

echo
echo "===== 결과: PASS=$PASS FAIL=$FAIL ====="
[ "$FAIL" = "0" ]
