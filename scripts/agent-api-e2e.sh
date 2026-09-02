#!/usr/bin/env bash
#
# Agent API E2E — 실제 서버 · 실제 PostgreSQL.
#
# 🔴 이 저장소는 「Compile 성공만으로 완료라고 판단하지 않는다」.
# Agent API 는 화면이 없어 눈으로 확인할 수 없으므로, 그 자리를 이 스크립트가 맡는다.
#
# 무엇을 지키는가
# - API Key 원문이 Database 에 남지 않는다
# - 잘못된·폐기된·만료된 키가 전부 같은 401 이다
# - 한 Review 가 한 Transaction 으로 저장된다 (반쪽 Session 없음)
# - 같은 Idempotency-Key 재전송이 ReviewSession 을 늘리지 않는다
# - 🔴 Workspace 를 넘는 접근이 막힌다 (404, 403 이 아니다)
# - 상태와 History 가 모순되지 않는다
#
# 쓰는 법
# 1) docker compose up -d (컨테이너 code-intelligence-postgres)
# 2) pnpm dev -p 3930 (다른 터미널)
#    🔴 `pnpm dev -- -p 3930` 은 지금 pnpm 에서 `--` 를 그대로 넘겨 실패한다.
#    이미 다른 포트에 dev 서버가 떠 있으면 E2E_PORT 로 그쪽을 가리켜라 —
#    남의 서버를 죽이지 않는다. 예: E2E_PORT=3001 bash scripts/agent-api-e2e.sh
# 3) bash scripts/agent-api-e2e.sh
#
# 🔴 **Repository 는 「이미 연결돼 있다」에서 시작한다.**
#    2026-09-01(d462e1b) 부터 Ingestion 은 모르는 Repository 를 스스로 만들지 않는다 —
#    연결에는 Workspace 의 GitHub App installation 이 필요하다. 그래서 seed 가 사람이
#    화면에서 연결해 둔 상태를 먼저 만든다(Project 2 · Repository 5 · Workspace 2).
#
#    🔴 옛 계약(Ingest 가 저장소를 만들고 이름을 numeric id 로 승격하던 시절)을 검사하던
#    구간은 **지우지 않고 지금 계약으로 다시 썼다.** 각 검사가 지키려던 사실은 그대로다:
#    numeric id 가 이름을 이긴다 · 같은 이름 다른 id 는 다른 저장소다 · 이름만으로
#    가릴 수 없으면 아무 데도 쓰지 않는다 · 대소문자로 행이 갈라지지 않는다.
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

# 🔴 **Principal 은 Workspace 에 매달리지 않는다.** `SERVICE_AGENT` 는 `owner_user_id` 가
# NULL 이라 Workspace 를 지워도 남는다 — 자격이 Principal 로 옮겨간 뒤 이 정리를 함께
# 고치지 않아 다음 실행이 `agent_principals_pkey` 중복으로 시드에서 멈췄다(실제로 겪었다).
# credential 과 grant 는 Principal 에 CASCADE 로 매달려 함께 사라진다.
# 🔴 **고정 UUID 로만 지운다** — 이름으로 지우면 같은 이름의 실제 Principal 까지 훼손된다.
cleanup() {
 psql1 "delete from workspaces where slug like 'e2e-%'" >/dev/null 2>&1
 psql1 "delete from agent_principals where id in ('aaaaaaaa-4444-4000-8000-000000000001','bbbbbbbb-4444-4000-8000-000000000002')" >/dev/null 2>&1
 rm -rf "$WORK"
}
trap cleanup EXIT

PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); printf 'OK %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL %s\n' "$1"; }
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
# `pick` 은 앞에 `d.` 를 붙인다 — `Object.keys(...)` 처럼 «식 전체»가 필요한 자리는 이쪽을 쓴다.
jexpr() { node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(eval(process.argv[2]))" "$WORK/body" "$1"; }

echo "===== 0. 준비 — 실제 생성기로 Agent 자격을 만들고 Hash 만 저장한다 ====="
node -e "
const fs=require('fs');
import(new URL('../src/lib/api/api-key-token.ts', 'file://' + process.argv[1].replace(/\\\\/g,'/') + '/scripts/').href).then(m => {
 const keys = Object.fromEntries(['alpha','beta','revoked','expired'].map(n => [n, m.generateAgentCredential()]));
 fs.writeFileSync(process.argv[2] + '/keys.json', JSON.stringify(keys), 'utf8');
 for (const [n,k] of Object.entries(keys)) fs.writeFileSync(process.argv[2] + '/tok_' + n, k.plainToken, 'utf8');
 // 🔴 원문은 여기(임시 디렉터리)에만 있다. SQL 에는 Hash 와 Prefix 만 나간다.
 //
 // 🔴 **자격은 Principal 에 달리고 Workspace 접근은 grant 가 정한다**(legacy 의 단일
 // workspace_id 칸은 제품에서 사라졌다). A 와 B 가 서로 다른 Workspace 를 보려면
 // **Principal 이 둘**이어야 한다 — grant 가 Principal 단위이기 때문이다.
 const cred = (pid,name,k,exp,rev) =>
 \`('\${pid}','\${name}','\${k.keyPrefix}','\${k.keyHash}',\${exp},\${rev})\`;
 const PRA='aaaaaaaa-4444-4000-8000-000000000001', PRB='bbbbbbbb-4444-4000-8000-000000000002';
 const A='aaaaaaaa-0000-4000-8000-000000000001', B='bbbbbbbb-0000-4000-8000-000000000002';
 /**
 * 🔴 Repository 를 «미리 연결해» 둔다.
 *
 * 2026-09-01(d462e1b) 부터 Ingestion 은 모르는 Repository 를 스스로 만들지 않는다 —
 * 연결에는 그 Workspace 의 GitHub App installation 이 필요하다. 사람이 화면에서 먼저
 * 연결해 두는 것이 실제 흐름이므로, 시험도 그 상태에서 시작한다. 이 행이 없으면
 * 3 번부터 전부 NOT_CONNECTED_OR_NOT_AUTHORIZED 로 떨어진다.
 */
 const PA='aaaaaaaa-1111-4000-8000-000000000001', PB='bbbbbbbb-1111-4000-8000-000000000002';
 const PA2='aaaaaaaa-1111-4000-8000-00000000000a', PB2='bbbbbbbb-1111-4000-8000-00000000000b';
 const RA='aaaaaaaa-2222-4000-8000-000000000001', RB='bbbbbbbb-2222-4000-8000-000000000002';
 const RA2='aaaaaaaa-2222-4000-8000-00000000000a', RB2='bbbbbbbb-2222-4000-8000-00000000000b';
 const ID1='aaaaaaaa-3333-4000-8000-000000000100', ID2='aaaaaaaa-3333-4000-8000-000000000200';
 const CASEID='aaaaaaaa-3333-4000-8000-000000000400';
 fs.writeFileSync(process.argv[2] + '/seed.sql', [
 \`insert into workspaces (id, slug, name) values ('\${A}','e2e-alpha','E2E Alpha'),('\${B}','e2e-beta','E2E Beta');\`,
 \`insert into projects (id, workspace_id, name, slug) values
 ('\${PA}','\${A}','E2E Alpha Platform','platform'),('\${PB}','\${B}','E2E Beta Platform','platform'),
 ('\${PA2}','\${A}','E2E Alpha SMIL','smil'),('\${PB2}','\${B}','E2E Beta SMIL','smil');\`,
 /**
  * 🔴 **사람이 화면에서 연결해 둔 상태에서 시작한다.**
  *
  * Ingestion 은 모르는 Repository 를 스스로 만들지 않는다 — 연결에는 Workspace 의
  * GitHub App installation 이 필요하다(2026-09-01 d462e1b). 그러니 시험도 「이미 연결된
  * 저장소에 Review 가 들어온다」는 실제 상황에서 시작해야 한다.
  *
  * 🔴 \`idcheck/app\` 을 **같은 이름 · 다른 numeric id 로 둘** 만든다. 이름이 같아도 다른
  * 저장소라는 것과, 이름만으로는 둘을 가릴 수 없다는 것을 아래에서 함께 확인한다.
  */
 \`insert into repositories (id, workspace_id, project_id, provider, external_repository_id, owner, name, full_name, default_branch)
 values ('\${RA}','\${A}','\${PA}','GITHUB','987654321','SMIL-26','smil-be','SMIL-26/smil-be','develop'),
 ('\${RB}','\${B}','\${PB}','GITHUB','987654321','SMIL-26','smil-be','SMIL-26/smil-be','develop'),
 ('\${RA2}','\${A}','\${PA2}','GITHUB','111222333','SMIL-26','smil-fe','SMIL-26/smil-fe','develop'),
 ('\${RB2}','\${B}','\${PB2}','GITHUB','111222333','SMIL-26','smil-fe','SMIL-26/smil-fe','develop'),
 ('\${ID1}','\${A}','\${PA}','GITHUB','100','idcheck','app','idcheck/app','main'),
 ('\${ID2}','\${A}','\${PA}','GITHUB','200','idcheck','app','idcheck/app','main'),
 ('\${CASEID}','\${A}','\${PA}','GITHUB','400','acme','app','acme/app','main');\`,
 \`insert into agent_principals (id, type, display_name, review_language) values
 ('\${PRA}','SERVICE_AGENT','E2E Alpha Agent','ko'),
 ('\${PRB}','SERVICE_AGENT','E2E Beta Agent','ko');\`,
 \`insert into agent_workspace_grants (principal_id, workspace_id) values
 ('\${PRA}','\${A}'),('\${PRB}','\${B}');\`,
 'insert into agent_credentials (principal_id, name, key_prefix, key_hash, expires_at, revoked_at) values',
 [cred(PRA,'alpha-agent',keys.alpha,'null','null'),
 cred(PRB,'beta-agent',keys.beta,'null','null'),
 cred(PRA,'alpha-revoked',keys.revoked,'null','now()'),
 cred(PRA,'alpha-expired',keys.expired,\"now() - interval '1 day'\",'null')].join(',\n') + ';',
 ].join('\n'), 'utf8');
}).catch(e => { console.error('키 생성 실패:', e.message); process.exit(1); });
" "$(pwd)" "$WORK" || exit 1

psql_ -v ON_ERROR_STOP=1 -q < "$WORK/seed.sql" || { echo "시드 실패"; exit 1; }
A=$(cat "$WORK/tok_alpha"); B=$(cat "$WORK/tok_beta")
REV=$(cat "$WORK/tok_revoked"); EXP=$(cat "$WORK/tok_expired")

STORED=$(psql1 "select count(*) from agent_credentials where key_hash like 'ci\\_%' or key_hash !~ '^[0-9a-f]{64}\$'")
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
expect "Authorization 없음" 401 -X POST "$BASE/reviews" -H "$JSON" -d '{}'
expect "형식이 아닌 키" 401 -X POST "$BASE/reviews" -H 'authorization: Bearer nonsense' -H "$JSON" -d '{}'
# 🔴 «형식은 맞다»가 되려면 `ci_agent_` + 43자여야 한다. legacy 모양(`ci_` + 43자)은 이제
# DB 조회 전에 형식에서 떨어져, 이 검사가 재려던 「없는 키도 같은 401」이 아니라
# 「형식 오류」를 재게 된다 — 접두를 함께 옮긴다.
expect "형식은 맞지만 없는 키" 401 -X POST "$BASE/reviews" -H "authorization: Bearer ci_agent_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" -H "$JSON" -d '{}'
# 🔴 옛 `ci_` 모양도 여전히 401 이다 — 사유를 구분해 알려주지 않는다는 계약은 그대로다.
expect "제거된 legacy 모양의 키" 401 -X POST "$BASE/reviews" -H "authorization: Bearer ci_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" -H "$JSON" -d '{}'
expect "폐기된 키" 401 -X POST "$BASE/reviews" -H "authorization: Bearer $REV" -H "$JSON" -d '{}'
expect "만료된 키" 401 -X POST "$BASE/reviews" -H "authorization: Bearer $EXP" -H "$JSON" -d '{}'

echo
echo "===== 2. 검증 ====="
expect "잘못된 Payload" 400 -X POST "$BASE/reviews" -H "authorization: Bearer $A" -H "$JSON" -d '{"repository":{"provider":"GITLAB"},"issues":[{"severity":"URGENT"}]}'
expect "깨진 JSON" 400 -X POST "$BASE/reviews" -H "authorization: Bearer $A" -H "$JSON" -d '{oops'

echo
echo "===== 3. Review 저장 ====="
expect "첫 저장" 201 -X POST "$BASE/reviews" -H "authorization: Bearer $A" -H "$JSON" -H 'Idempotency-Key: e2e-run-1' --data-binary @"$WORK/review.json"
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
echo "===== 4-b. Knowledge preflight · currentStatus · changedFiles (실제 HTTP) ====="
# 🔴 이 셋은 응답 «형태»가 계약이다. 단위·통합 시험은 함수까지만 보므로 여기서 왕복을 본다.
PF_AVAIL=$(pick "knowledgePreflight.available")
if [ "$PF_AVAIL" = "true" ]; then ok "create_review 응답에 Knowledge preflight 가 실려 나온다"; else bad "knowledgePreflight.available=$PF_AVAIL"; fi
PF_KEYS=$(jexpr "Object.keys(d.knowledgePreflight).sort().join(',')")
if [ "$PF_KEYS" = "available,changedFiles,frequentPatterns,guidance,relevantPastIssues,unresolvedIssues" ]; then
 ok "preflight 의 칸이 계약대로다 ($PF_KEYS)"
else bad "preflight 칸이 다르다: $PF_KEYS"; fi
CS=$(jexpr "d.issues.every(i=>i.currentStatus===i.status)")
if [ "$CS" = "true" ]; then ok "issues[].currentStatus 가 저장된 status 와 같다"; else bad "currentStatus 가 status 와 어긋난다"; fi
# 🔴 changedFiles 는 «보조 힌트»다 — 100 개를 넘겼다고 Review 저장이 깨지면 안 된다.
node -e "
const fs=require('fs');
const base=JSON.parse(fs.readFileSync(process.argv[1]+'/review.json','utf8'));
base.target.changedFiles=Array.from({length:140},(_,i)=>'src/zone'+i+'/file.ts');
base.issues=[];
base.summary='changedFiles 140개';
fs.writeFileSync(process.argv[1]+'/review-many-files.json', JSON.stringify(base),'utf8');
base.target.changedFiles=Array.from({length:1001},(_,i)=>'src/zone'+i+'/file.ts');
fs.writeFileSync(process.argv[1]+'/review-too-many-files.json', JSON.stringify(base),'utf8');
" "$WORK"
expect "changedFiles 140개여도 Review 는 저장된다" 201 -X POST "$BASE/reviews" -H "authorization: Bearer $A" -H "$JSON" --data-binary @"$WORK/review-many-files.json"
TRUNC=$(jexpr "JSON.stringify(d.knowledgePreflight.changedFiles)")
if [ "$TRUNC" = '{"total":140,"considered":100,"truncated":true}' ]; then
 ok "🔴 줄였다는 사실을 응답에 적는다 ($TRUNC)"
else bad "truncation 보고가 다르다: $TRUNC"; fi
expect "그래도 무제한은 아니다 — 1001개는 거절" 400 -X POST "$BASE/reviews" -H "authorization: Bearer $A" -H "$JSON" --data-binary @"$WORK/review-too-many-files.json"
# 🔴 옛 Client 는 changedFiles 를 아예 보내지 않는다. 그 요청이 그대로 통해야 한다.
expect "changedFiles 없는 옛 Payload 도 그대로 통한다" 201 -X POST "$BASE/reviews" -H "authorization: Bearer $A" -H "$JSON" --data-binary @"$WORK/review.json"
OLDPF=$(jexpr "JSON.stringify(d.knowledgePreflight.changedFiles)")
if [ "$OLDPF" = '{"total":0,"considered":0,"truncated":false}' ]; then ok "보내지 않으면 0 이고 잘리지 않았다고 답한다"; else bad "옛 Payload 의 changedFiles 보고: $OLDPF"; fi

echo
echo "===== 5. Tenant 격리 ====="
expect "Workspace B 가 같은 GitHub Repository 를 저장" 201 -X POST "$BASE/reviews" -H "authorization: Bearer $B" -H "$JSON" -H 'Idempotency-Key: e2e-run-1' --data-binary @"$WORK/review.json"
if [ "$(pick repositoryId)" != "$REPO" ]; then ok "Workspace 마다 다른 repositories 행"; else bad "Repository 가 Tenant 를 넘어 공유됐다"; fi
expect "🔴 B 키로 A 의 Issue 에 Activity" 404 -X POST "$BASE/issues/$ISSUE/activities" -H "authorization: Bearer $B" -H "$JSON" -d '{"type":"COMMENT","actor":{"type":"AGENT","name":"intruder"},"description":"x"}'
expect "🔴 B 키로 A 의 Issue 상태 변경" 404 -X PATCH "$BASE/issues/$ISSUE" -H "authorization: Bearer $B" -H "$JSON" -d '{"status":"IGNORED"}'

echo
echo "===== 6. Activity ====="
expect "FIX_ATTEMPTED 추가" 201 -X POST "$BASE/issues/$ISSUE/activities" -H "authorization: Bearer $A" -H "$JSON" --data-binary @"$WORK/fix.json"
expect "행위자 없는 Activity" 400 -X POST "$BASE/issues/$ISSUE/activities" -H "authorization: Bearer $A" -H "$JSON" -d '{"type":"COMMENT","description":"x"}'
expect "UUID 아닌 issueId" 400 -X POST "$BASE/issues/not-a-uuid/activities" -H "authorization: Bearer $A" -H "$JSON" -d '{"type":"COMMENT","actor":{"type":"AGENT","name":"c"}}'
expect "없는 issueId" 404 -X POST "$BASE/issues/00000000-0000-4000-8000-000000000000/activities" -H "authorization: Bearer $A" -H "$JSON" -d '{"type":"COMMENT","actor":{"type":"AGENT","name":"c"}}'

echo
echo "===== 7. Resolution — 상태와 History 가 함께 움직인다 ====="
expect "요약 없는 RESOLVED" 400 -X PATCH "$BASE/issues/$ISSUE" -H "authorization: Bearer $A" -H "$JSON" -d '{"status":"RESOLVED"}'
expect "RESOLVED" 200 -X PATCH "$BASE/issues/$ISSUE" -H "authorization: Bearer $A" -H "$JSON" --data-binary @"$WORK/resolve.json"
KOR=$(psql1 "select (resolution_summary ~ '[가-힣]')::text from review_issues where id='$ISSUE'")
if [ "$KOR" = "true" ]; then ok "한글 해결 요약이 UTF-8 로 온전히 저장됐다"; else bad "한글이 깨졌다"; fi
expect "REOPENED" 200 -X PATCH "$BASE/issues/$ISSUE" -H "authorization: Bearer $A" -H "$JSON" --data-binary @"$WORK/reopen.json"
CLEARED=$(psql1 "select (resolved_at is null and resolution_summary is null)::text from review_issues where id='$ISSUE'")
if [ "$CLEARED" = "true" ]; then ok "REOPENED 가 resolvedAt·resolutionSummary 를 비웠다"; else bad "REOPENED 인데 해결 흔적이 남았다"; fi
KEPT=$(psql1 "select count(*) from issue_activities where review_issue_id='$ISSUE' and type='RESOLVED' and description ~ '[가-힣]'")
if [ "$KEPT" != "0" ]; then ok "지난 해결 요약이 RESOLVED Activity 에 남아 History 로 읽힌다"; else bad "지난 해결 요약이 사라졌다"; fi
BAD=$(psql1 "select count(*) from review_issues where (status='RESOLVED' and (resolved_at is null or resolution_summary is null)) or (status<>'RESOLVED' and (resolved_at is not null or resolution_summary is not null))")
if [ "$BAD" = "0" ]; then ok "🔴 상태와 시각·요약이 모순된 행이 하나도 없다"; else bad "모순된 행이 $BAD 개다"; fi

echo
echo "===== 8. Knowledge Context ====="
expect "Workspace A 조회" 200 "$BASE/knowledge/context?limit=10" -H "authorization: Bearer $A"
node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
console.log(' frequentPatterns:', j.frequentPatterns.map(p=>p.patternKey+' x'+p.occurrences+' (resolved '+p.resolvedCount+')').join(' | '));
console.log(' unresolved:', j.unresolvedIssues.map(i=>i.severity).join(','));" "$WORK/body"
expect "🔴 B 는 A 의 Resolution 을 못 본다" 200 "$BASE/knowledge/context?limit=10" -H "authorization: Bearer $B"
if [ "$(pick 'pastResolutions.length')" = "0" ]; then ok "B 의 pastResolutions 가 비어 있다"; else bad "다른 Tenant 의 해결 요약이 새어 나왔다"; fi
# 🔴 **남의 repositoryId 는 「없는 것」과 «같은» 대답을 받아야 한다.**
#
# 예전에는 200 + 빈 결과였고 지금은 404 다. 둘 다 데이터를 주지 않지만, 지금 형태에서
# 중요한 것은 **없는 id 와 남의 id 를 구분해 주지 않는 것**이다 — 구분되는 순간 id 를
# 훑어 다른 Tenant 의 Repository 존재 여부를 셀 수 있다(스펙 15).
expect "🔴 남의 repositoryId 를 Filter 로" 404 "$BASE/knowledge/context?repositoryId=$REPO&limit=10" -H "authorization: Bearer $B"
FOREIGN_CODE=$(pick "error.code")
expect "존재하지 않는 repositoryId" 404 "$BASE/knowledge/context?repositoryId=00000000-0000-4000-8000-000000000000&limit=10" -H "authorization: Bearer $B"
MISSING_CODE=$(pick "error.code")
if [ "$FOREIGN_CODE" = "$MISSING_CODE" ] && [ "$FOREIGN_CODE" = "NOT_FOUND" ]; then
 ok "🔴 남의 것과 없는 것이 같은 NOT_FOUND 다 — 존재 여부가 새지 않는다"
else bad "남의 id=$FOREIGN_CODE 없는 id=$MISSING_CODE 로 갈렸다"; fi
expect "limit 상한 초과" 400 "$BASE/knowledge/context?limit=999" -H "authorization: Bearer $A"

echo
echo "===== 9. 같은 문제 재보고 (source + externalId) ====="
expect "다른 Idempotency-Key 로 재전송" 201 -X POST "$BASE/reviews" -H "authorization: Bearer $A" -H "$JSON" -H 'Idempotency-Key: e2e-run-2' --data-binary @"$WORK/review.json"
DUP=$(psql1 "select count(*) from review_issues where repository_id='$REPO' and external_id='CDX-1'")
if [ "$DUP" = "1" ]; then ok "같은 externalId 는 행이 늘지 않았다"; else bad "같은 문제가 $DUP 행으로 갈라졌다"; fi
AGAIN=$(psql1 "select count(*) from issue_activities where review_issue_id='$ISSUE' and type='REVIEWED_AGAIN'")
if [ "$AGAIN" != "0" ]; then ok "다시 만난 Issue 에 REVIEWED_AGAIN 이 남았다"; else bad "재보고가 History 에 남지 않았다"; fi

echo
echo "===== 10. Project 계층 ====="
# 🔴 **등록된 Repository 의 `project_id` 가 정본이다.** Agent 가 project 를 안 보내도
# 그 Repository 가 이미 달려 있는 Project 로 들어간다 — Ingest 가 Default Project 를
# 새로 만들던 시절의 동작이 아니다(2026-09-01 d462e1b).
OWNER_PRJ=$(psql1 "select p.slug from repositories r join projects p on p.id=r.project_id where r.id='$REPO'")
if [ "$OWNER_PRJ" = "platform" ]; then ok "🔴 project 를 안 보내면 Repository 가 달린 Project 로 들어간다"; else bad "Project slug 가 '$OWNER_PRJ' 다"; fi

# 🔴 **미등록 Repository 는 Default Project 를 만들어 받지 않는다.**
node -e "
const fs=require('fs');
const r=JSON.parse(fs.readFileSync(process.argv[1]+'/review.json','utf8'));
r.repository.externalRepositoryId='999000111';
r.repository.name='never-connected'; r.repository.fullName='SMIL-26/never-connected';
r.issues=[];
fs.writeFileSync(process.argv[1]+'/review-unconnected.json', JSON.stringify(r),'utf8');
" "$WORK"
expect "🔴 연결한 적 없는 Repository 는 거절한다" 404 -X POST "$BASE/reviews" -H "authorization: Bearer $A" -H "$JSON" --data-binary @"$WORK/review-unconnected.json"
GHOST=$(psql1 "select count(*) from repositories where full_name='SMIL-26/never-connected'")
if [ "$GHOST" = "0" ]; then ok "🔴 거절된 요청이 Repository 도 Project 도 만들지 않았다"; else bad "유령 Repository 가 $GHOST 행 생겼다"; fi
# 🔴 **개수가 아니라 «어긋난 것이 하나도 없는가»를 본다.** 시험 fixture 가 늘어도
# 지켜야 하는 사실은 그대로다 — Repository 와 그것이 달린 Project 는 언제나 같은
# Workspace 것이어야 한다.
MISOWNED=$(psql1 "select count(*) from repositories r join projects p on p.id=r.project_id where r.workspace_id <> p.workspace_id")
ALPHA_REPOS=$(psql1 "select count(*) from repositories r join workspaces w on w.id=r.workspace_id where w.slug='e2e-alpha'")
if [ "$MISOWNED" = "0" ] && [ "$ALPHA_REPOS" -gt 0 ]; then ok "🔴 Repository 가 같은 Workspace 의 Project 아래에 달렸다 (alpha $ALPHA_REPOS 개)"; else bad "Repository-Project-Workspace 가 $MISOWNED 건 어긋났다"; fi

# project.slug 를 보내면 그 Project 로 들어간다.
node -e "
const fs=require('fs');
const r=JSON.parse(fs.readFileSync(process.argv[1]+'/review.json','utf8'));
r.project={slug:'smil'};
r.repository.externalRepositoryId='111222333';
r.repository.name='smil-fe'; r.repository.fullName='SMIL-26/smil-fe';
r.issues=[{severity:'MEDIUM',category:'VALIDATION',patternKey:'MISSING_VALIDATION',title:'Missing request validation',source:'codex',externalId:'CDX-9'}];
fs.writeFileSync(process.argv[1]+'/review-smil.json', JSON.stringify(r),'utf8');
" "$WORK"
expect "project 를 지정한 저장" 201 -X POST "$BASE/reviews" -H "authorization: Bearer $A" -H "$JSON" -H 'Idempotency-Key: e2e-smil-1' --data-binary @"$WORK/review-smil.json"
SMIL_REPO=$(pick repositoryId)
SMIL_PRJ=$(psql1 "select p.slug from repositories r join projects p on p.id=r.project_id where r.id='$SMIL_REPO'")
if [ "$SMIL_PRJ" = "smil" ]; then ok "지정한 Project 로 들어갔다"; else bad "Project 가 '$SMIL_PRJ' 다"; fi

# 🔴 B 키로 A 의 Project slug 를 지목해도 A 의 Project 에 닿지 못한다.
expect "🔴 B 키가 A 의 project slug 를 지목" 201 -X POST "$BASE/reviews" -H "authorization: Bearer $B" -H "$JSON" -H 'Idempotency-Key: e2e-smil-b' --data-binary @"$WORK/review-smil.json"
B_REPO=$(pick repositoryId)
CROSS=$(psql1 "select count(*) from repositories ra join repositories rb on ra.project_id=rb.project_id where ra.id='$SMIL_REPO' and rb.id='$B_REPO'")
if [ "$CROSS" = "0" ]; then ok "🔴 같은 slug 라도 Workspace 마다 다른 Project 다"; else bad "Project 가 Tenant 를 넘어 공유됐다"; fi
MIX=$(psql1 "select count(*) from repositories r join projects p on p.id=r.project_id where r.workspace_id <> p.workspace_id")
if [ "$MIX" = "0" ]; then ok "🔴 Workspace 를 넘나드는 Repository-Project 조합이 하나도 없다"; else bad "어긋난 조합이 $MIX 개다"; fi

echo "----- Knowledge Context 의 Project Scope -----"
expect "projectSlug 로 좁힌 조회" 200 "$BASE/knowledge/context?projectSlug=smil&limit=10" -H "authorization: Bearer $A"
if [ "$(pick 'frequentPatterns.map(p=>p.patternKey).join(",")')" = "MISSING_VALIDATION" ]; then ok "그 Project 의 Pattern 만 나온다"; else bad "Project Scope 가 걸리지 않았다"; fi
if [ "$(pick 'scope.projectResolved')" = "true" ]; then ok "scope 가 Project 를 찾았음을 알린다"; else bad "scope 가 비었다"; fi
expect "🔴 없는 projectSlug" 200 "$BASE/knowledge/context?projectSlug=no-such&limit=10" -H "authorization: Bearer $A"
if [ "$(pick 'scope.projectResolved')" = "false" ] && [ "$(pick 'frequentPatterns.length + d.unresolvedIssues.length')" = "0" ]; then ok "🔴 못 찾았음을 알리고 빈 결과를 준다 — Workspace 전체로 넓히지 않는다"; else bad "없는 Project 인데 다른 데이터가 나왔다"; fi
expect "🔴 B 키로 A 의 project slug 조회" 200 "$BASE/knowledge/context?projectSlug=smil&limit=10" -H "authorization: Bearer $B"
# B 도 자기 'smil' Project 를 갖는다(위에서 만들어졌다). 같은 slug 로 조회하면
# **자기 것만** 나와야 한다 — A 의 Pattern 도, A 의 Resolution 도 보이지 않는다.
PB=$(pick 'frequentPatterns.map(p=>p.patternKey).join(",")')
RB=$(pick 'pastResolutions.length')
if [ "$PB" = "MISSING_VALIDATION" ] && [ "$RB" = "0" ]; then ok "🔴 B 는 자기 smil Project 만 본다 — A 의 Knowledge 가 새지 않는다"; else bad "B 에게 patterns=$PB resolutions=$RB 가 나왔다"; fi

echo

echo
echo "===== 11. Decision Record · Code Evidence · 읽기 API ====="
node -e "
const fs=require('fs');
fs.writeFileSync(process.argv[1]+'/decide.json', JSON.stringify({
 repository:{provider:'GITHUB',owner:'SMIL-26',name:'smil-be',fullName:'SMIL-26/smil-be',
 defaultBranch:'develop'},
 target:{type:'COMMIT',branch:'develop',commitSha:'a81f3c2'},
 reviewer:{type:'AGENT',name:'claude-code',version:'2.0'},
 issues:[{severity:'HIGH',category:'TRANSACTION',patternKey:'EXTERNAL_IO_IN_TRANSACTION',
 title:'Transaction 안에서 외부 API 를 부른다',
 description:'주문 저장 Transaction 안에서 결제 API 를 호출한다.',
 rootCause:'Transaction 경계를 Service 전체로 잡았다.',
 failurePath:'결제 API 가 느려지면 Connection Pool 이 마르고 주문 전체가 멈춘다.',
 filePath:'src/OrderService.java',startLine:40,endLine:52,
 source:'claude',externalId:'CLD-EV-1',
 decision:{solution:'Transaction 을 축소하고 결제 호출을 밖으로 옮겼다',
 decisionReason:'보상 처리가 재시도로 충분했다',
 alternativesConsidered:'Saga 도입 — 지금 규모에 과하다',
 tradeOff:'결제 실패 시 주문이 잠깐 PENDING 으로 남는다',
 verification:'부하 시험에서 Pool 고갈이 사라졌다',
 regressionTest:'OrderServiceTest#외부호출은_Transaction_밖에서',
 residualRisk:'보상 실패가 겹치면 수동 정리가 필요하다'},
 evidence:[{kind:'BEFORE',commitSha:'a81f3c2',filePath:'src/OrderService.java',
 startLine:40,endLine:52,snapshot:'@Transactional\npublic void place() { pay(); }'}]}]
}), 'utf8');
fs.writeFileSync(process.argv[1]+'/after.json', JSON.stringify({
 type:'FIX_ATTEMPTED', actor:{type:'AGENT',name:'claude-code'}, commitSha:'bbb2222',
 decision:{solution:'결제 호출을 Transaction 밖으로 뺐다', decisionReason:'첫 시도가 Timeout 을 못 막았다'},
 evidence:[{kind:'AFTER',commitSha:'bbb2222',filePath:'src/OrderService.java',startLine:40,endLine:48,
 snapshot:'public void place() { save(); }\npay();'}]}), 'utf8');
" "$WORK"

expect "숫자 id 없이 Review 저장 — Agent 는 git remote 만 안다" 201 -X POST "$BASE/reviews" -H "authorization: Bearer $A" -H "$JSON" -H 'Idempotency-Key: e2e-decision-1' --data-binary @"$WORK/decide.json"
EV_ISSUE=$(pick "issues[0].id")

# 🔴 숫자 id 를 안 보냈는데도 앞서 만든 같은 저장소 행을 다시 썼는가 (신원이 갈라지지 않았는가)
REPO_ROWS=$(psql1 "select count(*) from repositories where workspace_id='aaaaaaaa-0000-4000-8000-000000000001' and lower(full_name)='smil-26/smil-be'")
if [ "$REPO_ROWS" = "1" ]; then ok "🔴 숫자 id 를 생략해도 같은 Repository 한 행으로 모인다"; else bad "같은 저장소가 $REPO_ROWS 행으로 갈라졌다"; fi

DEC=$(psql1 "select count(*) from issue_activities where review_issue_id='$EV_ISSUE' and type='DETECTED' and solution is not null and trade_off is not null and residual_risk is not null")
if [ "$DEC" = "1" ]; then ok "🔴 판단이 Issue 가 아니라 DETECTED Activity 에 붙었다"; else bad "Decision Record 가 Activity 에 없다 ($DEC)"; fi

ISSUE_DEC=$(psql1 "select count(*) from review_issues where id='$EV_ISSUE' and root_cause is not null and failure_path is not null")
if [ "$ISSUE_DEC" = "1" ]; then ok "발견 시점의 사실(rootCause · failurePath)은 Issue 에 남았다"; else bad "rootCause/failurePath 가 Issue 에 없다"; fi

BEF=$(psql1 "select count(*) from issue_code_evidences where review_issue_id='$EV_ISSUE' and kind='BEFORE' and issue_activity_id is not null")
if [ "$BEF" = "1" ]; then ok "BEFORE 근거가 그 행위에 매달렸다"; else bad "BEFORE 근거가 없다 ($BEF)"; fi

echo "----- 두 번째 시도: 판단이 덮어써지지 않는가 -----"
expect "FIX_ATTEMPTED + AFTER 근거" 201 -X POST "$BASE/issues/$EV_ISSUE/activities" -H "authorization: Bearer $A" -H "$JSON" --data-binary @"$WORK/after.json"
KEPT=$(psql1 "select count(*) from issue_activities where review_issue_id='$EV_ISSUE' and solution is not null")
if [ "$KEPT" = "2" ]; then ok "🔴 두 번째 판단이 첫 번째를 덮어쓰지 않았다 (판단 2개가 나란히 남는다)"; else bad "판단이 $KEPT 개다 — 덮어썼거나 안 남았다"; fi
AFT=$(psql1 "select count(*) from issue_code_evidences where review_issue_id='$EV_ISSUE' and kind='AFTER'")
if [ "$AFT" = "1" ]; then ok "AFTER 근거가 그 시도에 매달렸다"; else bad "AFTER 근거가 없다 ($AFT)"; fi

echo "----- 확인되지 않은 것을 확인했다고 적지 않는가 -----"
# 없는 Commit 이므로 GitHub 에서 볼 수 없다. after() 가 응답 뒤에 도니 잠깐 기다린다.
UNVERIFIED=0
for _ in 1 2 3 4 5 6 7 8; do
 UNVERIFIED=$(psql1 "select count(*) from issue_code_evidences where review_issue_id='$EV_ISSUE' and verification <> 'VERIFIED'")
 DONE=$(psql1 "select count(*) from issue_code_evidences where review_issue_id='$EV_ISSUE' and verification='UNVERIFIED'")
 [ "$DONE" = "0" ] && break
 sleep 1
done
if [ "$UNVERIFIED" = "2" ]; then ok "🔴 GitHub 에서 못 본 근거는 VERIFIED 가 되지 않았다"; else bad "확인하지 않은 근거가 VERIFIED 로 적혔다"; fi
SNAP=$(psql1 "select count(*) from issue_code_evidences where review_issue_id='$EV_ISSUE' and snapshot is not null")
if [ "$SNAP" = "2" ]; then ok "확인에 실패해도 Agent 가 보낸 코드는 남아 화면이 무언가는 보여 준다"; else bad "Snapshot 이 사라졌다 ($SNAP)"; fi

echo "----- GET /issues/{id} -----"
expect "Issue 하나를 History 까지 읽는다" 200 "$BASE/issues/$EV_ISSUE" -H "authorization: Bearer $A"
ACTS=$(pick "issue.activities.length"); FIRST=$(pick "issue.activities[0].solution===null?'없음':'있음'")
LASTEV=$(pick "issue.activities.filter(a=>a.evidence.length>0).length")
if [ "$ACTS" -ge 2 ] && [ "$LASTEV" = "2" ]; then ok "Activity 마다 판단과 근거가 함께 나온다 (activities=$ACTS)"; else bad "History 가 이어지지 않는다 (activities=$ACTS, 근거있는행위=$LASTEV)"; fi
RC=$(pick "issue.rootCause===null?'없음':'있음'")
if [ "$RC" = "있음" ]; then ok "rootCause 가 응답에 담긴다"; else bad "rootCause 가 응답에 없다"; fi

expect "🔴 B 키로 A 의 Issue 조회" 404 "$BASE/issues/$EV_ISSUE" -H "authorization: Bearer $B"
ok "🔴 남의 Issue 는 403 이 아니라 404 다 — ID 의 존재 여부가 새지 않는다"

echo "----- GET /issues (search) -----"
expect "저장소로 좁힌 검색" 200 "$BASE/issues?repository=smil-26/SMIL-BE&status=OPEN&limit=10" -H "authorization: Bearer $A"
FOUND=$(pick "issues.length")
if [ "$FOUND" -ge 1 ]; then ok "대소문자가 달라도 같은 저장소로 찾는다 ($FOUND건)"; else bad "owner/name 검색이 안 된다"; fi
expect "Pattern 으로 좁힌 검색" 200 "$BASE/issues?patternKey=EXTERNAL_IO_IN_TRANSACTION" -H "authorization: Bearer $A"
PAT=$(pick "issues.length")
if [ "$PAT" -ge 1 ]; then ok "Pattern 으로 과거 사례를 찾는다 ($PAT건)"; else bad "Pattern 검색이 안 된다"; fi

# 🔴 B 도 «자기» Workspace 에 같은 이름의 저장소를 갖고 있다(10장에서 만들어졌다).
# 그러므로 「0건」은 옳은 기대가 아니다. 옳은 기대는 **돌아온 행이 전부 B 의 것**이라는 쪽이다 —
# 같은 owner/name 을 넣었을 때 A 의 행이 한 줄이라도 섞이면 그것이 유출이다.
expect "🔴 B 키로 A 와 같은 이름의 저장소 검색" 200 "$BASE/issues?repository=SMIL-26/smil-be" -H "authorization: Bearer $B"
IDS=$(pick "issues.map(i=>\"'\"+i.id+\"'\").join(',')||\"'00000000-0000-4000-8000-000000000000'\"")
LEAK=$(psql1 "select count(*) from review_issues where id in ($IDS) and workspace_id <> 'bbbbbbbb-0000-4000-8000-000000000002'")
if [ "$LEAK" = "0" ]; then ok "🔴 돌아온 행이 전부 B 의 것이다 — 같은 이름이어도 남의 행이 섞이지 않는다"; else bad "A 의 Issue 가 $LEAK 건 섞였다"; fi
MINE=$(psql1 "select count(*) from review_issues where id in ($IDS) and workspace_id = 'bbbbbbbb-0000-4000-8000-000000000002'")
if [ "$MINE" != "0" ]; then ok "B 는 자기 저장소의 Issue 를 정상적으로 본다 ($MINE건)"; else bad "B 가 자기 Issue 도 못 본다"; fi

expect "limit 상한 초과" 400 "$BASE/issues?limit=999" -H "authorization: Bearer $A"

echo

echo
echo "===== 12. Repository 신원 · 검색어 경계 ====="
node -e "
const fs=require('fs');
const repo = (extId) => ({provider:'GITHUB',owner:'idcheck',name:'app',fullName:'idcheck/app',
 defaultBranch:'main',...(extId===null?{}:{externalRepositoryId:extId})});
const mk = (extId, title) => ({repository:repo(extId),
 target:{type:'COMMIT',commitSha:'c0ffee1'},
 reviewer:{type:'AGENT',name:'codex'},
 issues:[{severity:'LOW',category:'CLEAN_CODE',title}]});
fs.writeFileSync(process.argv[1]+'/id-none.json', JSON.stringify(mk(null,'이름으로만 만든 저장소')), 'utf8');
fs.writeFileSync(process.argv[1]+'/id-100.json', JSON.stringify(mk('100','숫자 id 100 로 승격')), 'utf8');
fs.writeFileSync(process.argv[1]+'/id-200.json', JSON.stringify(mk('200','같은 이름 다른 저장소')), 'utf8');
fs.writeFileSync(process.argv[1]+'/wild.json', JSON.stringify({repository:repo('100'),
 target:{type:'COMMIT',commitSha:'c0ffee2'},reviewer:{type:'AGENT',name:'codex'},
 issues:[{severity:'LOW',category:'CLEAN_CODE',title:'퍼센트 % 가 든 제목'}]}), 'utf8');
" "$WORK"

# 🔴 **numeric id 가 정본이라는 것은 이제 «해석» 단계에서 지켜진다.**
#
# 신원 승격(이름 -> numeric)은 GitHub App installation 이 metadata 를 읽는
# 연결 단계로 옮겨갔다. Ingestion 에 남은 몫은 **이미 연결된 것 중 어느 행인가**를
# 고르는 일이고, 아래 셋이 그 몫을 지킨다.
#
# 🔴 이름만 왔을 때가 특히 중요하다 — `idcheck/app` 은 numeric id 가 다른 두 행이라,
# 이름만으로는 «어느 저장소인지 알 수 없다». 이때 아무거나 고르면 두 저장소의
# Knowledge 가 조용히 섞인다. 그래서 고르지 않고 거절한다
# (`repository-context-service.ts` 의 `limit 2` + `rows.length !== 1`).
# 🔴 대답은 404 가 아니라 **409 + 고를 수 있는 후보**다. 「없다」가 아니라 「둘 중 어느
# 것인지 네가 정해라」가 사실이고, Agent 가 다음 행동을 정할 수 있다(스펙 18).
expect "🔴 이름만으로는 두 저장소를 가릴 수 없다" 409 -X POST "$BASE/reviews" -H "authorization: Bearer $A" -H "$JSON" --data-binary @"$WORK/id-none.json"
AMBIG_STATUS=$(pick "error.resolutionStatus")
if [ "$AMBIG_STATUS" = "REPOSITORY_CONTEXT_AMBIGUOUS" ]; then ok "애매함을 그 이름으로 알린다"; else bad "resolutionStatus=$AMBIG_STATUS"; fi
# 🔴 후보를 준다고 해서 남의 Workspace 를 보여 주지는 않는다.
AMBIG_WS=$(jexpr "[...new Set(d.error.candidates.map(c=>c.workspace.slug))].sort().join(',')")
if [ "$AMBIG_WS" = "e2e-alpha" ]; then ok "🔴 후보가 이 Key 의 Workspace 안에서만 나온다"; else bad "후보에 다른 Workspace 가 섞였다 ($AMBIG_WS)"; fi
AMBIG=$(psql1 "select count(*) from review_issues i join repositories r on r.id=i.repository_id where r.full_name='idcheck/app' and i.title='이름으로만 만든 저장소'")
if [ "$AMBIG" = "0" ]; then ok "🔴 애매하면 아무 저장소에도 쓰지 않는다"; else bad "애매한 이름이 $AMBIG 건을 남겼다"; fi

expect "숫자 id 100 으로 오면 그 저장소다" 201 -X POST "$BASE/reviews" -H "authorization: Bearer $A" -H "$JSON" --data-binary @"$WORK/id-100.json"
HIT100=$(psql1 "select r.external_repository_id from review_issues i join repositories r on r.id=i.repository_id where i.title='숫자 id 100 로 승격'")
if [ "$HIT100" = "100" ]; then ok "numeric id 가 이름을 이긴다"; else bad "신원이 예상과 다르다 ($HIT100)"; fi

expect "같은 이름인데 «다른» 숫자 id 200 이 온다" 201 -X POST "$BASE/reviews" -H "authorization: Bearer $A" -H "$JSON" --data-binary @"$WORK/id-200.json"
ROWS2=$(psql1 "select count(*) from repositories where workspace_id='aaaaaaaa-0000-4000-8000-000000000001' and full_name='idcheck/app'")
if [ "$ROWS2" = "2" ]; then ok "🔴 이름이 같아도 숫자 id 가 다르면 다른 저장소다 — 하나로 합쳐지지 않는다"; else bad "서로 다른 저장소가 $ROWS2 행으로 합쳐졌다"; fi
MIXED=$(psql1 "select count(*) from review_issues i join repositories r on r.id=i.repository_id where r.external_repository_id='100' and i.title='같은 이름 다른 저장소'")
if [ "$MIXED" = "0" ]; then ok "새 저장소의 Issue 가 옛 저장소에 붙지 않았다"; else bad "Knowledge 가 섞였다"; fi

echo "----- 검색어는 패턴이 아니다 -----"
expect "퍼센트가 든 제목을 저장한다" 201 -X POST "$BASE/reviews" -H "authorization: Bearer $A" -H "$JSON" --data-binary @"$WORK/wild.json"
expect "q=%25 로 검색" 200 --get --data-urlencode "q=%" "$BASE/issues" -H "authorization: Bearer $A"
WILD=$(pick "issues.length")
WILD_HIT=$(pick "issues.filter(i=>i.title.includes('%')).length")
if [ "$WILD" = "$WILD_HIT" ]; then ok "🔴 q=% 가 전부를 긁어 오지 않는다 — 퍼센트가 든 제목만 나온다 ($WILD건)"; else bad "q=% 로 Issue 전체가 나왔다 (전체 $WILD건 중 일치 $WILD_HIT건)"; fi

expect "q=_ 로 검색" 200 --get --data-urlencode "q=_" "$BASE/issues" -H "authorization: Bearer $A"
UNDER=$(pick "issues.length")
UNDER_HIT=$(pick "issues.filter(i=>i.title.includes('_')||(i.filePath||'').includes('_')||(i.patternKey||'').includes('_')).length")
if [ "$UNDER" = "$UNDER_HIT" ]; then ok "밑줄도 글자 그대로 다룬다 ($UNDER건)"; else bad "q=_ 가 아무 글자 하나로 해석됐다 (전체 $UNDER건 중 일치 $UNDER_HIT건)"; fi

echo

echo
echo "===== 13. 같은 것을 가리키는 칸이 서로 어긋나지 않는가 ====="
node -e "
const fs=require('fs');
const mk=(repo)=>({repository:repo,target:{type:'COMMIT',commitSha:'d00d'},
 reviewer:{type:'AGENT',name:'codex'},issues:[]});
fs.writeFileSync(process.argv[1]+'/mismatch.json', JSON.stringify(mk({
 provider:'GITHUB',owner:'real',name:'source',fullName:'other/project',defaultBranch:'main'})), 'utf8');
fs.writeFileSync(process.argv[1]+'/case.json', JSON.stringify(mk({
 provider:'GITHUB',owner:'Acme',name:'App',fullName:'acme/app',defaultBranch:'main'})), 'utf8');
" "$WORK"

# 🔴 어긋나면 Evidence 확인은 owner/name 으로 GitHub 을 읽고, 화면·검색은 fullName 을 보여 준다 —
# 다른 저장소의 코드가 확인된 근거처럼 붙는다.
expect "🔴 fullName 이 owner/name 과 다르면 거절한다" 400 -X POST "$BASE/reviews" -H "authorization: Bearer $A" -H "$JSON" --data-binary @"$WORK/mismatch.json"
STRAY=$(psql1 "select count(*) from repositories where full_name='other/project'")
if [ "$STRAY" = "0" ]; then ok "어긋난 요청이 행을 만들지 않았다"; else bad "행이 $STRAY 개 생겼다"; fi

# 🔴 **GitHub 은 owner/name 의 대소문자를 가리지 않는다.** `Acme/App` 으로 온 요청이
# 연결해 둔 `acme/app` 을 찾지 못하면, 같은 저장소의 Knowledge 가 둘로 갈린다.
# 해석은 `lower(full_name) = lower(?)` 로 맞춘다(`repository-context-service.ts`).
expect "대소문자만 다른 것은 받는다 — GitHub 이 그것을 가리지 않는다" 201 -X POST "$BASE/reviews" -H "authorization: Bearer $A" -H "$JSON" --data-binary @"$WORK/case.json"
CASE_HIT=$(pick repositoryId)
CASE_ROW=$(psql1 "select external_repository_id from repositories where id='$CASE_HIT'")
if [ "$CASE_ROW" = "400" ]; then ok "🔴 대소문자만 다른 이름이 연결해 둔 같은 저장소로 간다"; else bad "다른 행으로 갔다 ($CASE_ROW)"; fi
CASE_ROWS=$(psql1 "select count(*) from repositories where workspace_id='aaaaaaaa-0000-4000-8000-000000000001' and lower(full_name)='acme/app'")
if [ "$CASE_ROWS" = "1" ]; then ok "행이 대소문자 때문에 갈라지지 않았다"; else bad "acme/app 이 $CASE_ROWS 행이다"; fi

echo
echo "===== 결과: PASS=$PASS FAIL=$FAIL ====="
[ "$FAIL" = "0" ]
