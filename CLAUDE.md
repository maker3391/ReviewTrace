@AGENTS.md

# ReviewTrace 작업 규칙

이 문서는 **이 저장소의 제품 목적·핵심 Domain·Architecture·Rendering 전략·Database 원칙·API 경계·Security·작업 규칙의 정본**이다.
Claude 사용법이나 일반적인 코딩 상식을 적는 곳이 아니다.

`AGENTS.md` 는 Next.js 가 스스로 써 넣는 프레임워크 안내다. 이 문서와 역할이 겹치지 않는다 — 프레임워크 사용법은 그쪽, 이 저장소의 규칙은 여기.

> **읽는 법 — 이 문서는 두 층으로 되어 있다**
> **【현재 규칙】** 지금 지켜야 하는 것.
> **【향후】** 아직 없는 것. **있는 것처럼 코드를 쓰거나 문서를 고치지 마라.**
> 실제 구현 현황은 아래 「0. 지금 있는 것」 이 정본이다.

---

## 0. 지금 있는 것

**인증 · Multi-Workspace · Tenant 격리 · Agent API · Project 계층 · Dashboard · Wiki 까지 서 있다.**
**이 절이 「무엇이 실제로 존재하는가」의 정본이다.** 무언가를 만들면 여기부터 고쳐라.

| | 상태 |
|---|---|
| Next.js 16 App Router · React 19 · TypeScript strict | 있다 |
| Tailwind CSS 4 · ESLint · pnpm | 있다 |
| shadcn/ui Primitive **11개** (`components/ui`) | 있다 — Button · Input · Textarea · Select · Badge · Table · Dialog · Dropdown Menu · Skeleton · Card · Tooltip |
| `react-markdown` · `remark-gfm` | 있다 — **Wiki 본문 렌더링 전용.** 아는 자리는 `components/molecules/MarkdownView.tsx` 하나뿐이다 |
| Atomic Design 계층 (`atoms` · `molecules` · `organisms`) | 있다 |
| Drizzle Schema (**17 table · 10 enum**) · Migration 환경(`db:generate`·`db:migrate`) | 있다 |
| Zod · React Hook Form(`zodResolver`) | 있다 |
| Feature 디렉터리 (`auth` · `invitations` · `issues` · `projects` · `dashboard` · `knowledge` · `reviews` · `repositories` · `api-keys`) | 있다 |
| **MCP Server** (`mcp/` · stdio · Tool 8종) | **있다** — Claude Code · Codex 실제 연결 확인 (아래) |
| Workspace Shell (`app/(workspace)/w/[workspaceSlug]` + AppHeader · AppSidebar · WorkspaceSwitcher) | 있다 |
| SSR + Suspense + Skeleton 조회 골격 (`/w/{ws}/p/{project}/issues`) | 있다 |
| Error Handling (`AppError` · `PublicError` · `error.tsx` · `global-error.tsx` · `not-found.tsx`) | 있다 |
| Server Action 반환 계약 (`ActionResult`) | 있다 — 로그인·로그아웃·초대 발행/수락·Project 생성·Wiki 등록/수정/삭제가 쓴다 |
| 환경 변수 구조 (`.env.example` · Zod 검증) · `docker-compose.yml` | 있다 |
| Test(`pnpm test`, vitest) · `typecheck` script | 있다 |
| **PostgreSQL · Migration 적용** | **있다.** Docker(`code-intelligence-postgres`)로 띄워 `db:migrate` 적용·확인 완료 |
| **GitHub OAuth 로그인 · 서버 측 세션**(Auth.js + Drizzle Adapter, `session.strategy = "database"`) | **있다** |
| **가입 = 첫 로그인.** 누구나 가입하고 Personal Workspace 의 OWNER 가 된다 | **있다** |
| **User : Workspace = N:M** (`workspace_members` 가 정본) · Workspace Switcher | **있다** |
| **Workspace 초대** 발행·수락 (Token 원문 미저장 · SHA-256 Hash 만) | **있다** — 링크를 직접 전달한다. 메일 발송은 없다 |
| **화면 접근 통제** — `proxy.ts`(렌더 전 관문) + `requireWorkspace`(소속 판정) | **있다** |
| **Agent API 7종** (`POST /reviews` · `POST /reviews/{id}/issues` · `PATCH /issues/{id}` · `POST /issues/{id}/activities` · `GET /issues/{id}` · `GET /issues` · `GET /knowledge/context`) | **있다.** 실제 서버·실제 PostgreSQL 로 E2E 확인 (아래) |
| **Decision Record** (`solution`·`decisionReason`·`alternativesConsidered`·`tradeOff`·`verification`·`regressionTest`·`residualRisk`) | **있다** — 🔴 Issue 가 아니라 **IssueActivity** 에 붙는다. 시도마다 따로 남아 덮어써지지 않는다 |
| **Code Evidence** (`issue_code_evidences` · BEFORE/AFTER · GitHub 대조) | **있다** — 확인은 응답 뒤(`after()`)에 돈다. 확인 못 하면 `UNAVAILABLE` 로 남고 Snapshot 은 보존된다 |
| **API Key** 발급·폐기·Bearer 검증 (`ci_` + 256bit 난수 · SHA-256 Hash 만 저장) | **있다** — 화면(`/w/{ws}/settings`)까지 |
| Agent API Error Contract (`error.code`·`message`, Code↔Status 대응 한 곳) | 있다 |
| **Project 계층** (`Workspace -> Project -> Repository -> ReviewSession -> ReviewIssue`) | **있다** — `projects` 표 · `UNIQUE(workspace_id, slug)` · `repositories.project_id` |
| **Project 생성 화면** (`/w/{ws}/projects`) · Project Navigation | **있다** |
| **Workspace Dashboard** (KPI · Projects · Needs Attention · Frequent Patterns · Recent Activity) | **있다** — 전부 SQL Aggregate. JS 집계 없음 |
| **Project Dashboard** (KPI · Open Issues · Patterns · Recent Reviews · Repositories · Wiki · Resolutions) | **있다** |
| **Wiki**(`knowledge_pages`) 목록·상세·생성·수정·삭제 · Workspace/Project Scope 분리 | **있다** — Markdown 원문 저장 |
| Reviews · Repositories 목록 화면 (Project 아래) | **있다** — 조회만 |
| `GET /api/v1/knowledge/context` 의 **Project Scope + Wiki** | **있다** — `?projectSlug=` · 응답에 `scope`·`wiki` |
| **Review Ingest 의 Project 지정** (`payload.project.slug`, 없으면 `default`) | **있다** |
| **Issue 상세**(History 타임라인 · Resolution · Tag) · **Review 상세** · **Repository 상세** | **있다** |
| **API Key 발급·폐기 화면**(`/w/{ws}/settings`, OWNER 전용 · 원문 1회 표시) | **있다** |
| **Workspace 만들기**(Switcher) · **멤버 역할 변경**(마지막 OWNER 강등 차단) | **있다** |
| **Project 수정·삭제**(`/w/{ws}/p/{p}/settings` · 삭제 영향 건수 표시 후 이름 확인) | **있다** |
| **Repository 를 Project 사이에서 이동** | **있다** — Review·Issue 가 함께 따라간다 |
| ReviewIssue 의 **화면 CRUD**(상태 변경·Activity 추가) | **있다** — Agent API 와 **같은 Application Service** 를 쓴다 |
| Wiki 의 Markdown **렌더링** | **있다** — `MarkdownView` 한 곳. 🔴 raw HTML 을 렌더하지 않아 sanitize 가 따로 필요 없다 |
| 멤버 **내보내기** · Workspace 이름·slug 변경 | **없다. 다음 단계** |
| MCP 의 npm 배포(`npx`로 바로 쓰기) | **없다.** 지금은 이 저장소의 `mcp/server.mjs` 를 절대 경로로 가리킨다 |
| Agent Integration 화면(`/w/{ws}/settings` · Claude Code · Codex 설정 복사) | **있다** — 🔴 키를 끼워 넣지 않고 `<your-api-key>` 자리표시자를 그린다 |
| Agent 문서 (`docs/agent-integration.md` · `docs/agent-api.md`) | **있다** |
| 언어 전환(KO·EN) · 테마 전환(light·dark·system) | **있다** — 쿠키를 서버가 읽어 첫 응답부터 반영한다(FOUC 없음). 🔴 상세 화면 일부는 아직 한국어로 남아 있다 |

### 검증된 것 (2026-08-28 실행)

`pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` **네 개 모두 통과했다.**

**`pnpm db:migrate` 가 실제 PostgreSQL 에서 돌았다.** `docker compose up -d` 로
`postgres:17-alpine` 을 띄우고 `0000`~`0003` 을 적용했다. 결과를 직접 조회해 확인한 것:

- **14 table · 8 enum** — `users` `accounts` `sessions` `verification_tokens`
  `workspaces` `workspace_members` `workspace_invitations` `api_keys` `repositories`
  `review_sessions` `review_issues` `issue_activities` `tags` `issue_tags`
- `review_issues.severity`·`category`·`status` 가 **진짜 enum 컬럼**이다(`issue_severity` 등).
  JSON 속에 묻히지 않아 인덱스가 걸린다
- **JSONB 는 `review_sessions.raw_payload` 한 자리뿐**이다
- `issue_status` 에 `FALSE_POSITIVE`·`REOPENED`, `reviewer_type` 에 `SYSTEM` 이 들어갔고
  `workspace_role` 은 `OWNER`·`MEMBER` 둘뿐이다

🔴 **`db:generate` 는 Column 이름을 바꿀 때 «이름 변경인가 새 Column 인가»를 되묻는다.**
그 프롬프트는 TTY 가 없으면 실패하므로, 이름을 바꿀 때는 **더하는 Migration 과 지우는 Migration 을
나눠 만든다**(`0002` → `0003` 이 그렇게 나왔다). 🔴 **생성된 SQL 을 그대로 믿지 마라** —
`0002` 는 `issue_tags` 의 PK 를 그 Column 이 만들어지기 **전에** 걸어 실제로 실패했다.
손으로 순서를 고쳤고, 적용 전에 `BEGIN; … ROLLBACK;` 으로 한 번 돌려 봐야 이런 것이 잡힌다.

### 가입·Workspace·초대 검증 (2026-08-28 실행)

**실제 PostgreSQL 을 쓰는 시험 10건이 통과했다** — `DB_INTEGRATION=true pnpm test`.
전부 **되돌려지는 Transaction 안**에서 돌고 끝난 뒤 행이 남지 않는다(조회로 확인: 전 표 0행).
기본 `pnpm test` 에서는 건너뛴다.

- 신규 가입 → Personal Workspace + `OWNER` 소속이 함께 생긴다
- **재로그인해도 Personal Workspace 가 늘지 않는다** (`workspaces.personal_owner_id` unique)
- **slug 가 겹치면 다음 후보로 넘어간다** — 같은 GitHub 아이디 계열이어도 가입이 실패하지 않는다
- **소속이 없으면 slug 를 알아도 Workspace 를 얻지 못한다.** 없는 slug 와 남의 slug 를 구분해
  알려 주지 않는다 (둘 다 `null` → 화면은 404)
- 기존 회원이 초대를 수락하면 **기존 Personal OWNER 소속은 그대로**이고 MEMBER 하나가 는다
- **같은 초대를 두 번 수락해도 소속이 둘로 늘지 않는다** (`accepted_at IS NULL` UPDATE + 소속 PK)
- 초대 Token **원문이 저장되지 않는다** — 저장된 값은 SHA-256 Hash 다
- 이미 멤버인 이메일은 초대되지 않고, 없는 Token 으로는 수락되지 않는다

🔴 **되돌림 확인**: `findMembership` 에서 `userId` 조건을 빼면 「소속이 없으면 얻지 못한다」가
실제로 실패하고, `isPublicPath` 가 `/w/` 를 공개로 치면 경로 판정 시험 두 건이 실패한다 —
직접 돌려 봤고 되돌렸다.

### 화면 접근·GitHub 로그인 E2E (2026-08-28 실행 · dev 서버 :3910)

**실제 GitHub OAuth 로그인이 끝까지 갔다.** 확인 뒤 서버는 종료했다.
로그인으로 생긴 행은 사장님의 실제 계정이라 **지우지 않았다.**

- **가입 흐름이 실제로 돌았다** — `accounts`(provider=`github`) 1행 · `sessions` 1행 ·
  Personal Workspace `maker3391` 이 자동 생성되고 그 사람이 `OWNER` 다(`personal_owner_id` 설정됨).
  slug 는 GitHub 아이디에서 나왔다
- 🔴 **GitHub Access Token 은 `accounts` 표에만 있다.** 세션 콜백이 프로필 세 칸만 돌려주므로
  세션 객체에 담기지 않는다
- **미로그인 상태에서 `/` · `/w/{any}/issues` · `/w/{any}/dashboard` · `/w/{any}/settings` 가
  전부 `307 → /login`** 이고 **본문이 6바이트**다 — 보호된 화면의 뼈대가 나가지 않았다
- 🔴 **세션 쿠키를 위조해 Proxy 를 통과시켜도 막힌다.** `authjs.session-token=forged` 로 보내면
  Proxy 는 통과하지만 서버가 소속을 확인해 `307 → /login` 이다 — Proxy 는 경계가 아니라는 것이
  실제로 확인됐다
- 공개 경로는 열린다 — `/login` 200 · `/invite/{token}` 200 · `/api/v1/*` 는 세션 없이 동작
- **로그인 시작이 GitHub 으로 올바르게 나간다** — `client_id` 설정됨,
  `redirect_uri=http://localhost:3910/api/auth/callback/github`, `scope=read:user user:email`, PKCE 포함
- **위조된 콜백은 거절된다** — `/api/auth/callback/github?code=fake` 는 `/login?error=...` 로 돌아오고
  화면에는 「로그인하지 못했습니다」만 뜬다. Auth.js 의 원본 사유가 그려지지 않는다
- 잘못된·형식이 틀린 초대 Token 은 둘 다 「사용할 수 없는 초대」다 — 구분해 알려 주지 않는다

### Agent API 검증 (2026-08-28 실행 · Agent API 담당)

**실제 dev 서버(:3930)와 실제 PostgreSQL 로 `curl` 왕복·DB 대조 39건을 돌렸고 전부 통과했다.**
저장된 행은 `docker exec … psql` 로 직접 조회해 확인했다. 확인 뒤 **서버를 종료하고 시험 데이터도 지웠다.**

**다시 돌릴 수 있다 — `bash scripts/agent-api-e2e.sh`** (컨테이너와 `pnpm dev -- -p 3930` 이 떠 있어야 한다).
**세션 쿠키 없이** 순수 Agent 로 돈다 — `/api/v1` 은 Proxy 의 공개 경로다.
검사 39건이 전부 통과했다. 🔴 **되돌림 확인**: Tenant 조건을 빼면 「B 키로 A 의 Issue」 두 건이,
Idempotency 열쇠를 저장하지 않게 하면 「Session 이 늘지 않았다」 세 건이 실제로 실패한다 — 직접 돌려 봤다.

- **인증** — 헤더 없음 · 형식 아님 · 없는 키 · 폐기된 키 · 만료된 키 **다섯 모두 `401 UNAUTHORIZED`**.
  사유를 구분해 알려주지 않는다
- **API Key 원문 미저장** — `api_keys` 전수 조회: `key_hash` 는 전부 64자 hex(SHA-256)이고
  `ci_` 로 시작하는 행이 하나도 없다. `key_prefix` 는 11자뿐이라 그것으로 토큰을 복원할 수 없다
- **Review 저장** — Repository Upsert → ReviewSession → ReviewIssue 3건 → Tag → IssueTag →
  `DETECTED` Activity 까지 한 Transaction. 반쪽 Session 없음
- **Idempotency** — 같은 `Idempotency-Key` 재전송이 **`200` + 같은 `reviewSessionId`**.
  `review_sessions` 에 행이 늘지 않았다. 다른 Key 로 보내면 `201`
- **같은 문제 재보고** — `source + externalId` 가 같으면 행을 새로 만들지 않고 `REVIEWED_AGAIN` 을
  남긴다. 🔴 **`source`·`externalId` 를 보내지 않은 Issue 는 매번 새 행이 된다** — 식별자가 없으면
  같은 문제인지 알 방법이 없다. Dedup 이 필요한 Agent 는 둘을 보내야 한다
- **Tenant 격리** — Workspace B 의 키로 A 의 Issue 에 Activity 추가 · 상태 변경을 시도하면 **`404`**
  (`403` 이 아니다). Knowledge 조회에 **남의 `repositoryId` 를 Filter 로 넣어도 결과가 비어 있다**.
  같은 GitHub Repository 라도 Workspace 마다 **다른 `repositories` 행**이다
- **상태 ↔ History 정합** — 「`RESOLVED` 인데 `resolved_at`·`resolution_summary` 가 없다」 또는
  「`RESOLVED` 가 아닌데 둘 중 하나가 남아 있다」를 찾는 질의가 **0행**이다.
  `REOPENED` 하면 둘 다 비워지고, 지난 요약은 `RESOLVED` Activity 의 `description` 에 남는다
- **실제 Ping-Pong History 가 한 줄기로 쌓였다**:
  `DETECTED/codex → FIX_ATTEMPTED/claude → RESOLVED/codex → REVIEWED_AGAIN/codex → RESOLVED → REOPENED`
- **Knowledge 집계** — `frequentPatterns` 가 `occurrences`·`resolvedCount` 를 **DB 에서** 세어 돌려준다.
  LLM·Vector 없음
- **Payload 로 Workspace 를 지정할 수 없다** — `workspaceId` 를 넣어 보내면 Zod 가 버린다.
  `raw_payload` 최상위 key 전수 조회로 확인했다
- **UTF-8 왕복** — 한글 요약·행위자 이름이 요청 → DB → 응답까지 온전하다


### Project 계층·Dashboard·Wiki 검증 (2026-08-28 실행)

`pnpm lint` · `typecheck` · `test`(**147개**, `DB_INTEGRATION=true` 포함) · `build` **네 개 모두 통과했다.**
`pnpm db:generate` 로 `0004_futuristic_stick.sql` 을 만들고 **실제 PostgreSQL 에 적용**했다.

- **Migration 이 실제로 돌았다** — `projects` · `knowledge_pages` 두 표가 생기고
  `repositories.project_id` 가 `NOT NULL` 로 잠겼다. **16 table** 이 됐다
- 🔴 **기존 데이터를 하나도 건드리지 않았다.** 적용 전 `repositories` 가 **0행**임을 직접 조회해
  확인했고, 그래서 Migration 의 Default Project 생성 구문이 **한 번도 걸리지 않았다**(`projects` 0행).
  Workspace 2개 · User 1명 · API Key 1개는 그대로다
- **부분 unique index 두 개**가 실제로 만들어졌다 —
  `knowledge_pages_workspace_slug_unique WHERE project_id IS NULL` ·
  `knowledge_pages_project_slug_unique WHERE project_id IS NOT NULL`
- **Tenant 격리 통합 시험 18건이 실제 PostgreSQL 에서 돌았다**(전부 되돌리는 Transaction 안).
  Workspace 별 Project slug uniqueness · 남의 Project 접근 차단 · Dashboard 두 개의 격리 ·
  Issue 목록의 Project Scope · Wiki Scope 분리 · Agent Ingest 의 Project 확보
- 🔴 **되돌림 확인** — `findProjectDashboard` 에서 `workspaceId` 조건을 빼자
  「다른 Workspace 의 projectId 를 받아도 비어서 돌아온다」가 **실제로 실패했다**
  (`expected [ {…} ] to have a length of +0 but got 1`). 조건을 되돌리자 다시 통과했다
- **Agent API E2E 가 53건으로 늘었고 전부 통과했다**(`bash scripts/agent-api-e2e.sh`).
  기존 39건은 **하나도 고치지 않고** 그대로 통과했고, Project 계층 14건을 새로 더했다 —
  `project` 미지정 시 `default` 생성 · 지정 시 그 Project 로 적재 ·
  🔴 **B 키로 A 의 project slug 를 지목해도 A 의 Project 에 닿지 못한다** ·
  `Workspace 를 넘나드는 Repository↔Project 조합 0행` · `?projectSlug=` Scope · 없는 slug 의 빈 결과
- **미로그인 상태에서 새 화면이 전부 막힌다** — `/w/{ws}/projects` · `/knowledge` · `/members` ·
  `/w/{ws}/p/{project}` · `/p/{project}/issues` · `/p/{project}/knowledge/{slug}` 가 모두
  **`307 → /login` 이고 본문 6바이트**다. 보호된 화면의 뼈대가 나가지 않았다
- 확인 뒤 **dev 서버를 종료했고 시험 데이터도 남기지 않았다** — `projects` 0행 · `repositories` 0행 ·
  Workspace 는 `dev`·`maker3391` 둘 그대로

### 상세 화면·관리 기능·실행 계획 검증 (2026-08-28 실행)

`pnpm lint` · `typecheck` · `test`(**157개**) · `build`(**28 route**) **네 개 모두 통과했다.**
Agent API E2E **53건**도 그대로 통과했다.

- **Tenant 격리 통합 시험이 28건으로 늘었다** — Project 수정·삭제 · Repository 이동 ·
  Issue/Review/Repository **상세 조회** · Workspace 만들기 · 멤버 역할 변경까지 실제
  PostgreSQL 에서 돌았다(전부 되돌리는 Transaction 안)
- 🔴 **시험이 실제 버그를 잡았다.** `changeMemberRole` 의 「마지막 OWNER 잠금」이
  `count(*) … FOR UPDATE` 였는데 PostgreSQL 이 `FOR UPDATE is not allowed with aggregate
  functions` 로 거절했다 — 행을 그대로 읽어 잠그도록 고쳤다
- **Repository 이동이 Review Knowledge 를 함께 옮긴다는 것을 확인했다** —
  `review_issues` 를 한 행도 건드리지 않았는데 옮겨 간 Project 의 Dashboard 에 Issue 가
  나타나고 원래 Project 에서는 사라졌다. 하위 표에 `project_id` 를 복사하지 않은 값이다

#### Dashboard 실행 계획 (`bash scripts/dashboard-explain.sh`)

🔴 **Workspace 20개 · ReviewIssue 112,500행**을 만들어 `EXPLAIN (ANALYZE, BUFFERS)` 를 돌렸다.
**전부 한 Transaction 안에서 만들고 ROLLBACK 했다** — 적용 뒤 `projects` 0행 · `review_issues`
0행 · `explain-tmp-%` Workspace 0개를 직접 조회해 확인했다.

🔴 **Workspace 를 «여럿» 만든 것이 요점이다.** 하나만 만들면 표의 100% 가 그 Workspace
것이라 `workspace_id` 가 아무것도 걸러 내지 못해 Planner 가 늘 Seq Scan 을 고른다 —
처음에 그렇게 돌렸다가 「Index 가 안 쓰인다」가 아니라 **시험이 잘못된 것**임을 알았다.
대상 Workspace 가 전체의 **5%** 가 되게 고쳐서 다시 쟀다.

| 질의 | 결과 |
|---|---|
| Workspace Needs Attention | Bitmap Index Scan(`review_issues_workspace_category_idx`) · **2.5ms** |
| Workspace KPI (`FILTER` 한 문장) | Bitmap Heap Scan · **3.1ms** — Issue 를 네 번 세지 않는다 |
| Project 목록 집계 | 🔴 **문장 하나.** Project 20개인데 질의가 늘지 않았다(N+1 없음) |
| Project Open Issues | `repositories_project_idx` → Nested Loop → BitmapAnd · **0.77ms** |
| Issue 목록(Project Scope) | 같은 모양 · **0.94ms** |

**`repositories_project_idx` 가 실제로 쓰인다** — Project 로 좁히는 경로가 이 Index 를 타고
Repository 3행으로 먼저 줄인 뒤 Issue 로 내려간다. Project 계층을 넣으며 더한 Index 가
제 몫을 한다는 뜻이다.

### 🔴 검증되지 않은 것

- 🔴 **`.env` 에 `AUTH_SECRET` 이 없다.** 위 E2E 는 프로세스 환경 변수로 넣어 띄웠다.
  **`.env` 에 넣지 않으면 다음에 띄울 때 인증 경로가 기동 단계에서 실패한다**
- **Workspace Switcher·초대 폼·Settings 화면을 사람 눈으로 보지 않았다.** 로그인까지는 실제로
  갔지만 그 뒤 화면들은 타입·빌드·서버 응답까지만 확인했고 **눌러 보지 않았다**
- **초대를 브라우저에서 발행·수락해 보지 않았다.** 그 흐름은 Database 시험으로만 확인했다
- **동시 가입 경쟁을 실제로 부딪혀 보지 않았다.** 「두 사람이 같은 순간 첫 로그인」은
  `workspaces.personal_owner_id` unique 와 slug 재시도로 설계했고 시험은 **순차로** 돌렸다
- **초대 메일을 보내지 않는다.** 발행된 링크를 사람이 직접 전달해야 한다 — 의도한 범위다
- **Agent API 담당이 확인하지 못한 것** (2026-08-28):
  - **부하·동시성을 재지 않았다.** 같은 `Idempotency-Key` 두 요청을 **동시에** 던져 보지 않았다.
    경쟁은 `(repository_id, idempotency_key)` unique 와 `onConflictDoNothing` 으로 설계했을 뿐
    실제로 부딪혀 보지는 않았다. Issue 500건 상한 근처도 넣어 보지 않았고, Round Trip 수도 설계로만 보장한다
  - **API Key 발급 «화면»이 없다.** Application Service(`issueApiKey`)까지만 있고 Server Action·UI 가 없어,
    지금 키를 만들려면 위 E2E 스크립트처럼 코드를 직접 부르거나 행을 넣어야 한다
  - **`.env` 에 `AUTH_SECRET` 이 없다.** E2E 는 프로세스 환경 변수로 넣어 띄웠다
- **Project 계층 담당이 확인하지 못한 것** (2026-08-28):
  - 🔴 **새 화면을 사람 눈으로 «한 번도» 본 적이 없다.** Workspace/Project Dashboard ·
    Projects · Wiki · Issue/Review/Repository 상세 · API Key · 멤버 역할 · Project 설정 ·
    바뀐 Sidebar 를 **브라우저로 열어 보지 않았다.** 타입·빌드·SSR 응답 코드·Database
    시험까지만 확인했다 — **Claude 의 브라우저 확장이 연결되지 않았고**, 세션 행을 손으로
    만들어 우회하는 것은 하지 않았다(그 시도는 차단됐고 우회하지 않았다)
  - **Server Action 왕복을 눌러 보지 않았다.** Project 생성·수정·삭제, Wiki 등록·수정·삭제,
    API Key 발급·폐기, 멤버 역할 변경, Repository 이동 — 전부 Application Service 계층까지만
    시험했다. `revalidatePath` 뒤 화면이 실제로 다시 그려지는지는 확인되지 않았다
  - **UI 규칙(16장) 적용을 눈으로 대조하지 않았다.** Card 를 걷어내고 divider·Typography 로
    바꾼 결과가 실제로 「전형적인 shadcn Dashboard 처럼 보이지 않는지」는 확인되지 않았다
  - **Markdown 렌더링을 화면에서 보지 않았다.** raw HTML 이 렌더되지 않는다는 것은
    `react-markdown` 의 기본 동작이지 우리가 시험으로 증명한 것이 아니다 —
    🔴 **`rehype-raw` 를 넣는 순간 그 보증이 사라진다**
  - **Index 사용량 표의 「0회」를 「필요 없다」로 읽지 마라.** `review_issues_pattern_idx` ·
    `review_sessions_repository_created_at_idx` 는 실행 계획 시험이 그 조회 패턴을 돌리지
    않았을 뿐이다. Knowledge Context 의 `repositoryId` Filter 경로는 재 보지 않았다
  - **Needs Attention 의 정렬이 Index 와 어긋난다.** `review_issues_workspace_list_idx` 는
    `(workspace_id, status, severity, first_detected_at DESC)` 인데 질의는
    `severity ASC, first_detected_at ASC` 로 정렬해 매번 top-N heapsort 가 붙는다.
    112,500행에서 2.5ms 라 지금은 문제가 아니다 — **근거 없이 Index 를 더하지 않았다.**
    실제로 느려지면 그때 검토한다(CLAUDE.md 10)
- 위를 「될 것이다」로 적지 마라. 확인한 사람이 이 표를 고쳐라

🔴 **없는 것을 있는 것처럼 쓰지 마라.** 실행하지 않은 검증을 통과했다고 적지 않는다. 확인하지 않은 동작을 정상이라고 추측하지 않는다.

---

## 1. 프로젝트 목적

**ReviewTrace** — *Review. Resolve. Remember.*

External Coding Agent 의 Code Review 결과를 수집하고 **Finding → Fix Attempt → Verification
→ Resolution 이력을 축적**해, 반복되는 문제와 과거의 해결 방법을 Knowledge 로 만드는
**Developer Review Memory System** 이다.

```text
Code Change -> External Agent Review -> ReviewSession -> ReviewIssue
  -> Fix Attempt -> Verification -> Resolution -> Pattern / Knowledge
  -> 다음 개발 및 Review 에서 재사용
```

이 시스템이 답해야 하는 질문:

1. 어떤 코드 문제를 반복해서 만들고 있는가?
2. 같은 문제가 과거에도 발생했는가?
3. 과거에는 어떻게 해결했는가?
4. 어떤 해결 방법이 실제 Verification 을 통과했는가?
5. 다음 개발·Review 에서 무엇을 우선 확인해야 하는가?

🔴 **이 프로젝트는 AI Code Reviewer 를 만드는 프로젝트가 아니다.** Review 수행 주체는 외부 Coding Agent(Claude Code · Codex CLI · 그 밖의 Agent · 사람)다.

ReviewTrace 의 책임은 Review 자체가 아니라 **수집 -> 구조화 -> 저장 -> 추적 -> 검색 -> 분석 -> 재사용** 이다.

---

## 2. 핵심 Domain

우선순위:

```text
ReviewIssue -> IssueActivity / Resolution -> ReviewSession -> Repository -> Knowledge / Pattern
```

**가장 중요한 Domain 은 ReviewIssue 다.** UI 나 Infrastructure 변경 때문에 ReviewIssue 중심 모델을 왜곡하지 않는다.

### ReviewSession

한 번의 Code Review 실행. **Review 대상은 Pull Request 에 한정하지 않는다.**

```text
PULL_REQUEST · COMMIT · BRANCH · REPOSITORY · MANUAL
```

🔴 **PR 은 ReviewSession 의 Optional Metadata 일 뿐 Domain Root 가 아니다.**

### ReviewIssue

Agent 또는 사람이 발견한 하나의 의미 있는 Code Issue.

```text
Refresh Token rotation race condition
Severity HIGH · Category CONCURRENCY
File RefreshTokenService.java · Line 82
Pattern REFRESH_TOKEN_RACE_CONDITION
```

Formatting·단순 Naming 취향처럼 Knowledge 가치가 낮은 것보다 다음을 우선한다:
Bug · Security · Architecture · Database · Transaction · Concurrency · Performance · API · Validation · Exception Handling · Reliability · Testing

### IssueActivity

ReviewIssue 는 `OPEN -> RESOLVED` 로 끝나는 데이터가 아니다. 실제 Agent 작업은 되풀이된다:

```text
Codex DETECTED -> Claude FIX_ATTEMPTED -> Codex REVIEWED_AGAIN
  -> Claude FIX_ATTEMPTED -> Codex RESOLVED
```

이 History 를 보존하려고 IssueActivity 를 쓴다.
Activity Type: `DETECTED · FIX_ATTEMPTED · REVIEWED_AGAIN · RESOLVED · REOPENED · IGNORED · COMMENT`

🔴 **Event Sourcing 을 구현하지 않는다.** IssueActivity 는 Issue 의 의미 있는 변경 History 일 뿐이다.

### Resolution

`resolved = true` 만 저장하지 않는다. **어떻게 해결했는가가 Knowledge 의 핵심이다.**
ReviewIssue 에 최종 Resolution Summary 를 두고, 상세 과정은 IssueActivity 가 갖는다.

```text
Issue        External API call inside DB transaction
Resolution   DB transaction 범위를 축소하고 외부 API 호출을 transaction 밖으로 이동
Verification Codex re-review PASS
```

---

## 3. Category / Tag / Pattern — 셋을 혼동하지 마라

| | 뜻 | 예 |
|---|---|---|
| **Category** | 넓은 기술 영역 | `ARCHITECTURE` `SECURITY` `PERFORMANCE` `DATABASE` `TRANSACTION` `CONCURRENCY` `API` `VALIDATION` `EXCEPTION_HANDLING` `TESTING` `CLEAN_CODE` `RELIABILITY` |
| **Tag** | 검색·분류용 자유도 높은 Keyword | `refresh-token` `race-condition` `transaction` `jpa` `n-plus-one` `validation` |
| **Pattern** | 반복되는 문제의 **정규화된 개념** | `N_PLUS_ONE` `EXTERNAL_IO_IN_TRANSACTION` `REFRESH_TOKEN_RACE_CONDITION` `MISSING_VALIDATION` |

```text
Category  TRANSACTION
Pattern   EXTERNAL_IO_IN_TRANSACTION
```

Pattern 은 초기에는 Agent 또는 사용자가 지정한다. **자동 Pattern 추출을 위해 LLM 을 현재 Architecture 에 강제로 넣지 않는다.**

---

## 4. Architecture 【현재 규칙】

**Full-Stack Next.js Modular Monolith.** 별도 Backend Application 을 두지 않는다.

```text
Next.js App
  UI / Server Components
  Server Actions
  Route Handlers
  Application Services
  Repository / Data Access
        |
        v
   PostgreSQL
```

**Stack**: Next.js App Router · React · TypeScript strict · PostgreSQL · Drizzle ORM · Tailwind CSS · shadcn/ui · React Hook Form · Zod · pnpm

🔴 **쓰지 않는 것**: Spring Boot · Redis · Kafka · Microservices · Elasticsearch · Vector Database · pgvector · Background Queue · WebSocket
**필요성이 실제로 발생하기 전까지 추가하지 않는다.**

---

## 5. Request Architecture 【현재 규칙】

```text
조회      Browser -> Server Component -> Application Query -> Repository -> PostgreSQL -> Server Render
Mutation  Client Form -> Server Action -> Zod -> Application Service -> Repository -> PostgreSQL
Agent     Claude/Codex -> REST API -> Route Handler -> API Key Auth -> Zod -> Application Service -> Repository -> PostgreSQL
```

🔴 **Route Handler 와 Server Action 은 Transport Boundary 다. Business Logic 의 정본으로 만들지 않는다.** 공통 Business Logic 은 Application Layer 에서 처리한다.

단 **Java/Spring 식 Layer 를 의미 없이 복제하지 마라.** 복잡성이 없는 기능에 Interface/Class 를 무조건 추가하지 않는다.

---

## 6. 프로젝트 구조 【현재 규칙】

기능 중심 구조.

```text
src/
  app/          Routing / Layout / Composition
  features/     Domain Feature
  components/   Shared UI (components/ui = shadcn primitives)
  db/           PostgreSQL / Drizzle (schema/ migrations/ index.ts)
  lib/          Cross-cutting Infrastructure (auth/ validation/ utils/)
  config/       Application Configuration
  types/        실제로 전역 공유되는 Type
```

Feature 내부 예: `src/features/issues/` -> `components/ server/ schemas/ types/ utils/`

🔴 **모든 Feature 에 같은 폴더를 미리 만들지 마라. 실제 파일이 생길 때 필요한 폴더만 만든다.**

### Route 구조 【현재 규칙】

```text
Workspace   /w/{workspaceSlug}/dashboard          Workspace 전체 상태
            /w/{workspaceSlug}/projects           Project 목록·생성
            /w/{workspaceSlug}/knowledge          Workspace Wiki  (+ /new · /{slug} · /{slug}/edit)
            /w/{workspaceSlug}/members            멤버·초대
            /w/{workspaceSlug}/settings           Workspace 자신

Project     /w/{workspaceSlug}/p/{projectSlug}                Project Dashboard
            /w/{workspaceSlug}/p/{projectSlug}/reviews
            /w/{workspaceSlug}/p/{projectSlug}/issues
            /w/{workspaceSlug}/p/{projectSlug}/repositories
            /w/{workspaceSlug}/p/{projectSlug}/knowledge      Project Wiki (+ /new · /{slug} · /{slug}/edit)
            /w/{workspaceSlug}/p/{projectSlug}/settings       이름·slug·설명·삭제

상세        …/issues/{issueId}        Issue — History 타임라인이 주인공이다
            …/reviews/{reviewId}      한 번의 Review 실행이 남긴 것
            …/repositories/{repoId}   저장소 상태 · Project 이동
```

🔴 **Project 를 최상위(`/p/{slug}`)로 올리지 않는다.** 주소만으로 Tenant 를 알 수 없게 되고,
slug 가 전역 unique 여야 해 먼저 만든 Workspace 가 이름을 선점한다.

🔴 **URL 의 `workspaceSlug`·`projectSlug` 는 Context 표시일 뿐 권한의 근거가 아니다.**
모든 Server Query 가 이 순서를 지킨다 —
**Session → Workspace 소속 확인 → 그 Workspace 안의 Project → Resource**
(`requireWorkspace` → `requireProject`). 없으면 **404 다. 403 이 아니다** —
403 은 그 slug 가 존재한다는 사실을 알려 준다.

🔴 **Issue 는 Project 안에서 본다.** Workspace 를 가로지르는 Issue 목록 화면은 두지 않는다 —
그 자리는 Workspace Dashboard 의 「Needs Attention」이 맡는다.

### Feature 는 «자기 표»의 주인이다 【현재 규칙】

```text
features/repositories/server   repositories 를 읽고 쓴다
features/reviews/server        review_sessions
features/issues/server         review_issues · issue_activities · pattern
features/knowledge/server      knowledge_pages
features/projects/server       projects
features/dashboard/server      🔴 위의 것들을 «불러» 한 화면으로 조립만 한다
```

🔴 **Feature 끼리 서로의 조회를 가져다 쓰지 않는다.** 의존은 한 방향뿐이다 —
**Dashboard -> Feature.** Feature 는 Dashboard 를 알지 못하므로, Dashboard 를 통째로
지워도 나머지가 그대로 선다.

🔴 **같은 질의를 두 곳에 적지 않는다.** 한쪽만 고치면 **두 화면이 같은 데이터를 다른
숫자로 그린다.** Pattern 집계가 Dashboard 두 곳에 복사돼 있던 것을
`features/issues/server/pattern-query.ts` 한 곳으로 모은 이유다.

🔴 **함수를 공유하는 대신 «타입»을 공유한다.** 조회 범위(`WorkspaceScope`·`ProjectScope`)는
`src/types/tenant.ts` 의 순수 타입이라 import 해도 아무것도 끌고 오지 않는다.

**외부 Library 를 아는 자리를 한 곳으로 모은다.** Markdown 렌더러는
`components/molecules/MarkdownView.tsx` 만 안다 — 바꾸거나 걷어내는 일이 **파일 하나**로
끝난다. Feature 마다 직접 부르면 그때 고칠 자리가 흩어진다.

### app 은 얇게 유지한다

`src/app` 에 Business Logic 을 넣지 않는다. `page.tsx` 는 Feature Screen 을 조합하거나 Server Component 를 호출하는 역할만 한다.

```text
app/(workspace)/w/[workspaceSlug]/p/[projectSlug]/issues/page.tsx
  -> features/issues/components/IssueListScreen.tsx
```

Route Handler 도 HTTP 처리만 한다: `Request -> Authentication -> Parsing/Validation -> Application Service -> Response`

---

## 7. Server / Client Boundary 【현재 규칙】

**Server Component 가 기본값이다.** `'use client'` 는 Interaction 이 실제로 필요한 곳에만.

Client Component 가 맞는 예: Form · Dialog · Dropdown · Interactive Select · Clipboard · API Key 1회 표시 · Client Event

🔴 **다음 이유만으로 Client Component 로 만들지 마라**: 데이터를 조회해야 해서 / 로딩이 있어서 / Table 이라서 / Filter 가 있어서

Server 에서 조회할 수 있는 데이터를 Client State 로 다시 복제하지 않는다.
**Global State Library(Redux·Zustand·Jotai·Recoil)를 기본으로 쓰지 않는다.** 도입하려면 「실제로 어떤 문제를 해결하는가」에 먼저 답한다.

---

## 8. 조회는 SSR 우선 · Loading UX 【현재 규칙】

ReviewTrace 는 **조회 중심 Developer Tool** 이다. Reviews · Issues · Knowledge · Repositories · Dashboard 는 SSR / Server Component 를 우선한다.

Filter·Search·Pagination 상태는 가능하면 **URL Search Params** 에 둔다.

```text
/issues?repository=smil-be&severity=HIGH&category=TRANSACTION&status=OPEN&page=2
```

새로고침·URL 공유·뒤로가기가 되고, Server Query 와 상태가 일치하며, Client State 가 필요 없다.

### 조회 Loading

🔴 **검색·조회·Pagination 시 전체 화면을 Loading 으로 바꾸지 않는다.**

```text
Search/Filter -> URL Search Params 변경 -> Server Component 재실행
  -> Suspense Boundary -> Table Skeleton -> 새 Result
```

조회 버튼을 눌렀을 때 **Header · Search · Filter · Toolbar 는 유지**되고 **Table 영역만** Skeleton -> 새 Result 로 바뀐다. 페이지 전체가 깜빡이는 구조로 만들지 않는다.

Skeleton 은 실제 Content 크기와 비슷하게 만들어 Layout Shift 를 줄인다. 버튼 자체의 Mutation 진행 상태에는 Spinner 를 쓸 수 있다.

### 렌더링 전략 — SSR · CSR · Server Action

| 무엇 | 어떻게 |
|------|--------|
| **조회 페이지** | **SSR.** 서버에서 받아 서버가 그린다 |
| **동적인 화면** | **CSR.** 상호작용이 실제로 필요한 경계에만 `'use client'` |
| **폼 등록·수정·삭제** | **Server Action** (`'use server'`) |

#### Server Action 은 Transport 다

```text
브라우저 폼 -> Server Action -> Application Service -> Repository -> PostgreSQL
                   |
                   +-> revalidatePath — 서버가 목록을 다시 그린다
```

🔴 **업무 규칙·검증·트랜잭션은 Application Layer 의 몫이다.** Server Action 안에서 도메인 판단을 하지 않는다.
Server Action 이 하는 일은 **입력을 다듬어 Application Service 를 부르고, 결과를 화면 형식으로 돌려주고, 끝난 자리에서 무엇을 다시 그릴지 정하는 것**까지다.

- 브라우저에서 곧장 Mutation 을 쏘지 않는다. 서버에서 처리하고 **`revalidatePath` 로 서버가 다시 그리게** 한다 — 목록을 브라우저에서 다시 불러오지 않는다
- 🔴 **실패는 예외로 던지지 말고 결과 타입(`ActionResult`)으로 돌려준다.** **프로덕션 빌드에서 Server Action 의 예외는 메시지가 지워진 채 도착해** 화면이 「무슨 이유로」 실패했는지 보여 줄 수 없다

#### 경계에서 헷갈리는 자리

| 상황 | 처리 |
|------|------|
| 사용자 입력이 있는 폼 | **CSR + RHF** 로 그리고, 제출은 **Server Action** |
| 서버에서만 할 수 있는 일(비밀값·Server-only 접근) | 서버에 둔다. 클라이언트에서 흉내내지 않는다 |
| 단순 조회·표시 | **SSR 우선.** 상호작용이 생기는 지점에서만 CSR 로 내린다 |
| 등록·수정·삭제 뒤 목록 갱신 | Server Action 의 `revalidatePath`. 클라이언트 재조회로 대신하지 않는다 |

- SSR 로 해결되는 것을 `'use client'` 로 내려서 처리하지 않는다
- 🔴 **CSR 컴포넌트에 값을 `const` 로 박아두고 화면을 그리지 않는다.** 폼은 RHF, 서버 데이터는 서버에서

---

## 9. Form / Validation 【현재 규칙】

Form State = **React Hook Form** · Validation = **Zod** · 연결 = `zodResolver`

🔴 **검증 규칙을 Component 안의 임의 `if` 문으로 흩뿌리지 않는다. Schema 에 둔다.**
Type 은 가능하면 `z.infer<typeof schema>` 로 파생한다.

**외부 입력은 신뢰하지 않는다.** 특히 이 Boundary 들에서 Validation 을 명확히 한다:
Agent API Request · Form Input · Search Params · Environment Variables · External API Response

---

## 10. Database 【현재 규칙】

PostgreSQL + Drizzle ORM. **Database 가 Knowledge 의 정본이다.**

```text
User -> WorkspaceMember -> Workspace
                             |-- ApiKey
                             |-- WorkspaceInvitation
                             |-- KnowledgePage            (project_id IS NULL = 공통 규칙)
                             +-- Project
                                   |-- KnowledgePage      (project_id 있음 = 그 Project 문서)
                                   +-- Repository -> ReviewSession -> ReviewIssue
                                                                        |-- IssueActivity
                                                                        +-- IssueTag -- Tag
```

개인용으로 시작하더라도 **Workspace 를 Tenant Boundary 로 쓴다.**

### Project 는 업무 단위이지 Tenant 가 아니다 【현재 규칙】

```text
Workspace   Tenant · Member · 권한 · API Key · 공통 Knowledge 의 경계
Project     하나의 제품 또는 업무 단위
Repository  실제 Git 코드베이스
```

🔴 **Workspace 를 Project 처럼 쓰지 않는다.** 한 Workspace(`CodeApex`)가 여러 Project
(`SMIL` · `ReviewTrace` · `ERP`)를 갖고, 한 Project 가 여러 Repository
(`smil-fe` · `smil-be` · `smil-agent`)를 갖는다. **Project 와 Repository 를 1:1 로 묶지 않는다.**

- `projects` 의 slug 는 **`UNIQUE(workspace_id, slug)`** 다 — 전역 unique 가 아니다.
  서로 다른 회사가 각각 `erp` 를 갖는 것은 정상이다
- 🔴 **접근 판정의 정본은 여전히 `workspace_members` 다.** Project 별 세부 권한은 실제 요구가
  생기기 전에 만들지 않는다
- 🔴 **`workspace_id` 를 하위 표에 «무조건» 복사하지 않는다.** 지금 갖고 있는 표
  (`repositories` · `review_sessions` · `review_issues` · `issue_activities` · `knowledge_pages`)는
  **Tenant 격리를 값싸고 잊기 어렵게** 만들려는 의도적 denormalization 이다.
  `review_issues` 에 `project_id` 는 **넣지 않았다** — Project 로 좁힐 때는 Repository 를 Join 한다
- 🔴 **조회에 `workspaceId` 와 `projectId` 를 «겹쳐서» 건다.** 한쪽만 걸면 그 값을 잘못 얻은
  경로 하나가 곧바로 다른 Tenant 를 읽는다. 겹쳐 두면 어느 한쪽을 틀려도 결과가 비어서 돌아온다

### JSON 남용 금지

🔴 **검색·Filter·Statistics 에 쓰일 핵심 데이터를 JSONB 하나에 몰아넣지 않는다.**
`severity` `category` `status` `patternKey` `filePath` `reviewer` `repositoryId` `createdAt` `resolvedAt` 등은 **명시적 Column** 으로 둔다.
JSONB 는 Raw Payload 처럼 구조가 유동적이고 JSON 형태 보존이 실제로 필요한 경우에만.

### Query 원칙

데이터가 많아질 것을 이유로 처음부터 복잡한 Infrastructure 를 추가하지 않는다. 먼저 **올바른 Query · Pagination · 필요한 Column 만 SELECT · Batch Insert · 적절한 Composite Index** 로 해결한다.

🔴 **조회 패턴에 근거하지 않은 Index 를 무작정 추가하지 않는다.** Index 개수가 많다고 빨라지지 않는다.
성능 문제가 실제로 나면: `Query 확인 -> EXPLAIN ANALYZE -> Index 검토 -> Query 개선` 순서.

### Batch Write

Agent Review 는 한 ReviewSession 에 여러 ReviewIssue 가 들어온다. **Issue 마다 Database Round Trip 을 만들지 않는다.**

```text
Transaction
  ReviewSession INSERT
  ReviewIssue Batch INSERT
  Tag 처리
  IssueActivity Batch INSERT
Commit
```

원자적으로 함께 저장되어야 하는 데이터는 Transaction Boundary 를 명확히 한다.

---

## 11. Multi-Tenant 【현재 규칙】

Tenant Boundary 는 **Workspace** 다. 사용자가 많아져도 같은 PostgreSQL 을 쓴다 — Account 마다 Database 를 분리하는 구조를 기본값으로 삼지 않는다.

**가장 중요한 것은 성능이 아니라 Tenant Data Leakage 방지다.**

🔴 **Client 가 전달한 `userId`·`workspaceId` 를 신뢰해 접근 권한을 결정하지 않는다.**

```text
Web Request    Session -> User + URL slug -> WorkspaceMember -> Authorized Workspace
Agent Request  API Key -> Key Lookup      -> Workspace       -> Authorized Workspace
```

### User 와 Workspace 는 N:M 이다

🔴 **User : Workspace 를 1:1 로 가정하지 않는다.** 한 사람이 자기 Personal Workspace 의 `OWNER`
이면서 회사 Workspace 의 `MEMBER` 일 수 있다. **소속의 정본은 `workspace_members` 하나뿐이다.**

- **가입은 누구나 할 수 있다.** GitHub OAuth 첫 로그인이 가입이고, 그때 그 사람의
  Personal Workspace 가 만들어진다. 허용 목록도 초대 전용도 아니다
- **초대받은 사람도 Personal Workspace 를 갖는다.** 예외를 두면 그가 초대 Workspace 에서
  빠지는 순간 갈 곳이 없어진다
- **재로그인이 Personal Workspace 를 다시 만들지 않는다.** 「있는지 보고 없으면 만든다」로는
  동시 로그인의 틈이 막히지 않아, `workspaces.personal_owner_id` 의 unique 가 최종 방어선이다

### Workspace Context 는 주소에 있다

화면 주소가 Tenant Context 를 담는다 — `/w/{workspaceSlug}/{section}`.

- 🔴 **세션이나 `users` 행의 `currentWorkspaceId` 를 Authorization 의 정본으로 쓰지 않는다.**
  한 사람이 탭마다 다른 Workspace 를 볼 수 있고, 그 구조는 탭끼리 서로의 값을 덮어쓴다
- 🔴 **URL 의 `workspaceSlug` 는 Context 표시일 뿐 권한 증명이 아니다.** 요청마다
  `Session -> User + slug -> WorkspaceMember` 를 확인한다
- **Workspace 전환은 Route 변경이지 재로그인이 아니다.** 세션을 새로 만들지 않고
  보고 있던 Section 을 유지한 채 주소만 바꾼다
- 「마지막으로 본 Workspace」를 기억하는 것은 **로그인 뒤 어디로 갈지의 편의**일 뿐이다.
  읽은 뒤 반드시 소속을 다시 확인한다
- **Agent 요청은 slug 를 쓰지 않는다.** API Key 가 Workspace 를 정한다

### 화면 접근은 서버가 먼저 막는다

**자격이 없으면 렌더 전에 돌려보낸다.** 경로별 접근 표는 **한 곳**에 둔다.

- 🔴 **클라이언트 판정을 「추가」하는 것으로 대신하지 않는다.** 렌더가 시작되면 상위 `loading.tsx` 골격이 먼저 스트리밍돼, 브라우저가 되돌려 보내기 전에 **보호된 화면의 뼈대가 한 번 보인다**
- 🔴 **공개 경로는 목록이고, 목록에 없으면 보호다.** 로그인 화면은 반드시 공개다 — 막으면 무한 리다이렉트가 된다
- **「로그인했다」와 「그 권한이다」는 다른 판정이다.** 권한이 필요한 화면은 권한까지 서버에서 확인하고, 읽지 못하면 열지 않는다
- 세부 권한(메뉴·기능 단위)은 서버가 요청마다 차단하는 것이 정본이다. 화면 판정은 그 앞의 편의일 뿐이다

### 세션

- **세션 전략은 Database 다**(`session.strategy = "database"`). 🔴 **고른 이유를 「JWT 를 쓰면 Token 이
  브라우저에 노출되기 때문」이라고 적지 마라 — 틀린 설명이다.** GitHub Access Token 이 새는 것은
  **세션 콜백에 그것을 담을 때**이지 세션 전략 때문이 아니다. 실제 이유는 둘이다:
  이미 Adapter 로 `users`·`accounts` 를 Database 에 두고 있어 `sessions` 한 표가 더 붙는 비용이
  거의 없다는 것, 그리고 **행을 지우면 그 즉시 세션이 끊긴다**는 것
- 🔴 **세션 응답에는 사용자 프로필만 담는다.** Auth.js 의 기본 동작은 `sessions` 행을 통째로 펼쳐
  돌려주므로 **브라우저 쿠키 값 그대로인 `sessionToken` 이 세션 객체에 들어온다.** 세션 콜백에서
  화면이 쓰는 칸만 남긴다 — 그러지 않으면 HttpOnly 쿠키를 쓰는 의미가 사라진다
- 🔴 **`session.accessToken` 같은 칸을 만들지 않는다.** GitHub Credential 은 `accounts` 표에만 두고
  Server-only 로 다룬다. 한 줄 더하는 순간 브라우저까지 나간다
- 프런트에서 Token 을 **해석(디코드)하거나 만료를 직접 계산하지 않는다**
- **갱신 주체는 서버 한 곳뿐이다.** 클라이언트가 갱신 Endpoint 를 직접 부르지 않는다 — 서버가 소비한 것과 저장된 것이 갈라져 세션이 통째로 끊긴다
- **401 과 5xx 를 구분한다.** 401·403 은 세션 종료, 5xx·네트워크 장애는 유예 후 재시도 — 서버가 잠깐 죽었다고 전체 사용자를 로그아웃시키지 않는다
- 세션 수명은 인증 저장소의 만료와 맞춘다. 세션이 더 길면 「화면은 로그인 상태인데 모든 요청이 401」인 구간이 생긴다

### 민감정보 노출 금지 【현재 규칙】

세션·응답·화면 어디에도 민감한 정보가 새지 않게 한다.

- 비밀번호·Token·API Key 는 **요청 본문 외 어디에도 담지 않는다.** 상태·로그·URL·에러 메시지 금지
- 🔴 **`console.log` 로 사용자 객체·API 응답을 통째로 찍지 않는다.** 필요하면 식별자만
- 🔴 **Server Component 에서 Client Component 로 넘길 때 화면에 필요한 필드만 전달한다.** RSC payload 는 페이지 소스에 그대로 실려 나간다
- 에러는 사용자용 `message` 만 노출한다. 원본 응답·스택(`details`)을 화면에 그리지 않는다
- **URL Query String 에 개인정보를 넣지 않는다** — 브라우저 이력·리퍼러·서버 로그에 남는다

### 입력 정규화·권한 미러링

- 이메일 등 식별 값은 보내기 직전에 **공통 정규화 함수 한 곳**에서 앞뒤 공백 제거·소문자화 한다. 형식 거부는 Schema 가 먼저 하고 **최종 판단은 서버가** 한다
- 화면의 권한 미러링(버튼 비활성 등)은 **편의일 뿐 경계가 아니다.** 서버가 같은 판정을 반드시 다시 한다
- 메뉴 키 ↔ 사이드바 항목 ↔ 라우트 대응표는 **한 파일**에 둔다. 여러 곳에 흩으면 갈라진다

---

## 12. API Key 【현재 규칙】

```text
Authorization: Bearer ci_xxxxxxxxx
```

🔴 **API Key 원문을 Database 에 저장하지 않는다.**

```text
ApiKey: id · workspaceId · name · keyPrefix · keyHash · lastUsedAt · expiresAt · revokedAt · createdAt

발급  Secure Random Token -> 사용자에게 원문 1회 표시 -> Hash 생성 -> Hash 만 DB 저장
```

토큰은 `ci_` + **난수 32 바이트(256 bit)** 를 base64url 로 적은 것이다(`src/lib/api/api-key-token.ts`).
그 Entropy 가 **Hash 방식의 근거**다 — 사용자가 고른 비밀번호가 아니라 생성기가 만든 난수라
사전 공격 대상이 아니고, 요청마다 도는 Lookup 이므로 SHA-256 한 번이 맞다.
bcrypt·argon2 를 들이려고 의존성을 늘리지 않는다(CLAUDE.md 18).

- **원문은 발급 응답에만 존재한다.** 목록(`listApiKeys`)은 `plainToken` 도 `keyHash` 도
  돌려주지 않는다 — `keyPrefix` 만으로 어느 키인지 알아본다
- **형식이 아닌 값은 Database 를 보지 않고 거절한다.** 아무 문자열이나 Hash 해서 조회하면
  요청마다 인덱스를 한 번씩 태우게 된다
- 🔴 **거절 사유를 구분해 알려주지 않는다.** 형식 오류·없는 키·폐기·만료가 전부 같은
  `UNAUTHORIZED` 다 — 구분해 주면 그것만으로 「이 키는 존재한다」가 새어 나간다
- **폐기는 행을 지우지 않는다**(`revokedAt`). 지우면 그 키가 무엇을 했는지가 함께 사라지고,
  같은 Hash 가 다시 발급될 여지가 생긴다
- `lastUsedAt` 은 1분에 한 번만 다시 찍는다. 요청마다 UPDATE 하면 바쁜 Key 하나에 쓰기가 몰려
  같은 행을 두고 잠금이 줄을 선다
- **Token 을 Log·응답·오류 메시지에 담지 않는다.** 받은 값을 되돌려 담지도 않는다

---

## 13. Public Agent API 【현재 규칙】

Namespace 는 `/api/v1/**` 로 통일하고 Versioning 한다. **네 Endpoint 가 모두 구현돼 있다.**

```text
POST   /api/v1/reviews                     Review 수집
POST   /api/v1/issues/{issueId}/activities Issue History 한 줄 추가
PATCH  /api/v1/issues/{issueId}            Issue 상태 전이
GET    /api/v1/knowledge/context           과거 Knowledge 조회
```

**API 는 Claude/Codex 에 종속되지 않는다.** Claude · Codex · Gemini · Custom Agent · 사람이 쓰는 도구 — 어떤 Client 라도 같은 계약을 쓸 수 있어야 한다.

```text
Route Handler -> API Key Authentication -> Zod -> Application Service -> Repository -> PostgreSQL
```

🔴 **Route Handler 는 Transport 다.** HTTP 를 다루는 일(인증·Parsing·오류 변환)까지만 하고,
업무 판단은 `features/{domain}/server` 의 Application Service 가 한다. 그렇다고 의미 없는
`BaseService`·`Interface + Impl` 를 두지 않는다(CLAUDE.md 18).

### Tenant — Key 가 곧 Workspace 다

🔴 **Agent API 에서는 Browser 처럼 `workspaceSlug` 를 권한 근거로 쓰지 않는다.**
Payload 에도 Query 에도 Workspace 자리가 없다. Client 가 보낸 `workspaceId` 는 Zod 가 버린다.

Issue 하나를 다룰 때도 `WHERE issue.id = ?` 로 끝내지 않는다 — **그 Issue 가 그 Key 의
Workspace 것인지** 조건에 함께 건다. `repositoryId` 는 Filter 일 뿐 권한 근거가 아니다.

🔴 **남의 Workspace 의 Issue 는 `FORBIDDEN` 이 아니라 `NOT_FOUND`** 다. 둘을 구분해 주면
그것만으로 그 ID 가 존재한다는 사실이 새어 나가고, ID 를 훑어 다른 Tenant 를 셀 수 있게 된다.

### Review Ingestion

```json
{
  "project":    { "slug": "smil" },
  "repository": { "provider": "GITHUB", "externalRepositoryId": "123456789",
                  "owner": "owner", "name": "repository", "fullName": "owner/repository" },
  "target":     { "type": "COMMIT", "branch": "develop", "commitSha": "a81f3c2" },
  "reviewer":   { "type": "AGENT", "name": "codex" },
  "summary":    "Review summary",
  "issues":     []
}
```

```text
API Key -> Workspace 결정 -> Zod Validation -> Repository Upsert
  -> Transaction -> ReviewSession -> ReviewIssues -> Tags/IssueTags -> Activities -> Commit
```

🔴 **Client 가 Workspace 를 임의 지정하도록 만들지 않는다.**

🔴 **`externalRepositoryId` 는 선택이다**(2026-08-28 변경). Agent 가 아는 것은 git remote 뿐이고,
GitHub 의 숫자 id 를 알려면 Agent 가 GitHub API 를 따로 불러야 한다 — 기록 하나 남기자고 Agent 에게
저장소 접근 권한을 요구하지 않는다. 보내면 rename 해도 같은 저장소로 남고, 안 보내면 `owner/name` 이
신원이 된다. 나중에 숫자 id 가 오면 서버가 그 행의 신원을 승격해 꿰맨다(`repository-upsert.ts`).

**`project` 는 선택이다.** 보내지 않으면 그 Workspace 의 `default` Project 로 들어간다 —
Agent 는 화면이 없어 Project 를 미리 만들 수 없고, 첫 Review 를 통째로 거절하면 무엇을 먼저
만들어야 하는지 알 방법이 없다.

🔴 **`project.slug` 도 Workspace 를 넘지 못한다.** 남의 Workspace 의 Project slug 를 적으면
그쪽 Project 에 닿는 것이 아니라 **자기 Workspace 안에** 그 이름의 Project 가 하나 생길 뿐이다.

🔴 **Repository 의 `project_id` 는 Ingest 가 «덮어쓰지» 않는다.** Repository 를 어느 Project 에
둘지는 사람이 정하는 일이다 — Agent 가 매 Review 마다 보내는 값으로 옮기면, 화면에서 옮겨 둔
것이 다음 Review 에 되돌아간다.
🔴 **하나의 Transaction 이다.** 중간에 실패하면 ReviewSession 도 남지 않는다.
🔴 **Issue 개수만큼 Round Trip 을 만들지 않는다.** Issue 가 1개든 500개든 문장 수는 같다.

`externalRepositoryId` 는 **필수**다. Repository 의 Unique 근거이고(스키마 참고), `owner/name`
은 GitHub 에서 바뀐다 — 이름으로 식별하면 Rename 한 순간 같은 Repository 가 둘로 갈라져
Knowledge 가 끊긴다. 문제를 하나도 못 찾은 Review 도 받는다 — 「이 Commit 은 깨끗했다」도 Knowledge 다.

### Idempotency — 왜 `Idempotency-Key` 인가

**둘 다 쓰되 맡는 일이 다르다.**

| | 무엇의 동일성인가 | 무엇을 막는가 |
|---|---|---|
| `Idempotency-Key` 헤더 | **요청** 하나 | 재전송이 ReviewSession 을 늘리는 것 |
| `source` + `externalId` | **Issue** 하나 | 같은 문제가 매 Review 마다 새 행이 되는 것 |

「동일 Request 가 ReviewSession 을 무한 생성」은 **요청의 동일성**이고, `source + externalId`
로는 답할 수 없다 — 그것은 Issue 의 신원이라 Issue 를 하나도 담지 않은 Review 나 `summary`
같은 Session 값에는 아무 말도 못 한다. 반대로 「같은 문제가 매번 새 행이 되는 것」은
Session 열쇠로 막을 수 없다. 그래서 나눴다.

- 열쇠는 `review_sessions.idempotency_key` **Column 하나**이고 Unique 는 Repository 안에서다.
  **별도의 Idempotency 표·응답 Cache·TTL 을 만들지 않는다**(CLAUDE.md 18)
- 헤더를 보내지 않으면 Dedup 하지 않는다. 「같은 Commit 을 두 번 Review 했다」는 정상이고,
  우리가 마음대로 접으면 두 번째 결과가 사라진다
- 재전송이면 **`200`**, 새로 저장했으면 **`201`** 이다
- 이미 아는 Issue 를 다시 보고받으면 행을 새로 만들지 않고 **`REVIEWED_AGAIN`** Activity 를 남긴다.
  「이번 Review 도 이 문제를 봤다」가 History 에 있어야 반복 여부를 셀 수 있다

### 상태 전이 — 상태와 History 를 함께 움직인다

`PATCH /api/v1/issues/{issueId}` 는 Column 하나를 바꾸지 않는다. 한 Transaction 안에서
`status` · `resolvedAt` · `resolutionSummary` · `IssueActivity` 넷이 함께 움직인다.

| 전이 | resolvedAt | resolutionSummary | Activity |
|---|---|---|---|
| `RESOLVED` | 지금 | 저장 (**필수**) | `RESOLVED` |
| `REOPENED` · 그 밖 | `NULL` | `NULL` | 상태별 대응 |

🔴 **`RESOLVED` 는 `resolutionSummary` 없이 통과하지 못한다** — `resolved = true` 만 저장하지
않는다(CLAUDE.md 2). 🔴 **RESOLVED 가 아닌 상태에 해결 요약을 남겨 두지 않는다.** 지난 요약은
`RESOLVED` Activity 의 `description` 에 남아 History 로 읽을 수 있다.

### Knowledge Context

`scope` · `wiki` · `frequentPatterns` · `recentHighSeverityIssues` · `unresolvedIssues` ·
`pastResolutions` 를 돌려준다. Filter 는 **`projectSlug`** · `repositoryId` · `category` ·
`pattern` · `severity` · `limit` 이다.

```text
Workspace Rules(wiki, project_id IS NULL)
  + Project Wiki(wiki, 그 Project)
  + Repository Patterns(frequentPatterns)
  + Past Review Issues(recentHighSeverityIssues · unresolvedIssues)
  + Past Resolutions(pastResolutions)          -> Claude / Codex
```

🔴 **Wiki 와 Review Knowledge 를 한 배열로 합치지 않는다**(→ [14. Knowledge](#14-knowledge-는-양방향이다)).
`wiki` 는 사람이 적은 것(Explicit)이고 나머지는 Review 가 남긴 것(Observed)이다 — 출처가 다르다.
**본문 전문을 주지 않는다.** 무엇을 다루는 문서인지 알아볼 만큼만 발췌한다.

🔴 **`projectSlug` 를 보냈는데 그 Workspace 에 없으면 «빈 결과 + `scope.projectResolved=false`»** 다.
Workspace 전체로 넓혀 답하면 Agent 가 그것을 그 Project 의 Knowledge 로 읽는다 —
묻지 않은 것에 답하는 쪽이 아무것도 못 찾는 쪽보다 나쁘다.
Project 를 지정해도 **Workspace 공통 규칙은 함께** 준다. 그것을 빼면 Agent 가 모르는 채로 작업한다.

🔴 **LLM 도 Vector Search 도 쓰지 않는다.** `COUNT` · `GROUP BY` · `FILTER` · `ORDER BY` ·
`LIMIT` 만으로 만든다. 🔴 **통계를 JavaScript 에서 세지 않는다** — 전체 Issue 를 가져와
`reduce` 로 세면 요청 하나가 표를 통째로 읽는다. 필요한 Column 만 조회한다.

### Error Contract

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid review payload" } }
```

`UNAUTHORIZED`(401) · `FORBIDDEN`(403) · `VALIDATION_ERROR`(400) · `NOT_FOUND`(404) ·
`CONFLICT`(409) · `INTERNAL_ERROR`(500). **Code ↔ Status 대응은 한 곳**(`src/lib/api/error-response.ts`)
이고 Route 마다 숫자를 적지 않는다. 🔴 Stack Trace · SQL · Secret · 내부 경로를 내보내지 않는다 —
알 수 없는 오류는 원인을 **서버 Log 에만** 남기고 밖으로는 `INTERNAL_ERROR` 한 줄만 나간다.


## 14. Knowledge 는 양방향이다

```text
1) Agent -> Review -> ReviewTrace
2) ReviewTrace -> Past Knowledge -> Agent
```

**2번이 장기적으로 중요하다.** Agent 가 작업·Review 를 시작하기 전에 **Repository 의 반복 문제 ·
과거 HIGH/CRITICAL Issue · 미해결 Issue · 과거 Resolution · 자주 발생하는 Pattern** 을 조회할 수
있어야 한다. `GET /api/v1/knowledge/context` 가 그 자리다(→ [13. Public Agent API](#13-public-agent-api-현재-규칙)).

### 출처가 둘이다 — 합치지 마라 【현재 규칙】

| | 무엇 | 어디서 온다 | 어디 있다 |
|---|---|---|---|
| **Wiki** | Explicit Knowledge — **정해서 적은 것** | 사람이 쓴다 | `knowledge_pages` |
| **Pattern · Resolution** | Observed Knowledge — **겪어서 쌓인 것** | Review 가 남긴다 | `review_issues` · `issue_activities` |

🔴 **둘을 같은 데이터로 억지로 합치지 않는다.** 서로 «연결»될 수는 있지만 출처가 다르다 —
우리가 정한 규칙을 `review_issues` 에 끼워 넣으면 「관측된 사실」과 섞여 통계가 거짓이 된다.

```text
Workspace Knowledge   개발 공통 규칙 · Git/PR 규칙 · Security 정책 · Agent 운영 규칙 · Architecture 원칙
Project Knowledge     업무 규칙 · Architecture Decision · 외부 연동 규칙 · 장애/해결 기록 · 특이사항
Review Knowledge      Pattern · ReviewIssue · IssueActivity · Resolution · Verification
```

Wiki 는 **Markdown 원문**으로 시작한다. 🔴 Notion 수준 Editor · Block DB · 실시간 협업 편집 ·
LLM 자동 생성·요약은 **만들지 않는다**(→ [18. Overengineering 금지](#18-overengineering-금지)).

【향후】 MCP Tool 로도 같은 Context 를 낼 수 있다.

---

## 15. GitHub Integration 【향후】

주요 SCM Provider 는 GitHub 다. 그러나 **Core Domain 을 GitHub API Model 에 직접 종속시키지 않는다.**

Repository 는 최소한 `provider · externalRepositoryId · owner · name · fullName · defaultBranch` 를 갖는다.
GitHub API 호출 코드는 **Integration Boundary 로 분리**한다.

🔴 **GitHub 에서 Source Code 전체를 DB 로 복제하는 구조를 기본값으로 만들지 않는다.** 저장 대상은 Review Knowledge 다.

---

## 16. UI 원칙 · Visual Identity 【현재 규칙】

이 제품은 **Developer Tool** 이다. Marketing SaaS 처럼 디자인하지 않는다.

**방향**: **Enterprise developer SaaS + polished modern web app**

Enterprise · Data-first · Dense · Structured · Professional · Desktop First —
그러면서 **처음 봤을 때 「잘 만든 제품」이라는 인상**을 준다.

🔴 **「개발자용이니까 무조건 dense · flat · gray」로 판단하지 마라.** ReviewTrace 는
사람이 매일 보는 화면이다. 기능성과 데이터 밀도는 지키되, 흰 바탕에 회색 선만 이어지는
내부 관리도구처럼 만들지 않는다.

> **shadcn/ui = Component Primitive**
> **ReviewTrace = Visual Design System**

shadcn/ui 는 **접근성·상호작용·기본 구조**를 위한 Primitive 로 쓴다.
🔴 **shadcn 의 기본 시각 스타일을 그대로 조합해 화면을 완성하지 않는다.**
목표는 **전형적인 shadcn / Next.js SaaS Template 처럼 보이지 않는 것**이다.

**화면의 주인공은 UI Component 가 아니라 데이터다.** 장식보다 다음을 우선한다 —
정보 계층 · 데이터 비교 · 빠른 Scan · 상태 식별 · 검색/필터 · Table 가독성 · Context 파악.

### 🔴 균형 — 무엇을 쓰고 무엇을 쓰지 않는가

| 쓰지 않는다 | 대신 |
|---|---|
| **모든** Section 을 Card 로 감싸기 · Card 중첩 | 덩어리로 읽혀야 하는 것만 올린다. 나머지는 spacing · divider · typography |
| 똑같은 KPI Card 를 넷 늘어놓기 | **한 표면 안에서 세로선으로 나눈다** — 비교할 숫자가 한 덩어리로 묶인다 |
| 모든 요소에 border | **배경 톤 차이**로 층을 만들고, 선은 구조를 가를 때만 |
| 장식용 shadow | Card 에는 **아주 약한** depth. 진짜 elevation(Dropdown·Dialog)은 더 뚜렷하게 |
| Badge 남발 · muted text 남발 | Badge 는 **상태·분류에만**. 나머지는 Typography 계층 |
| Hero · Gradient 강조 · 거대한 Illustration | — |
| 필요 없는 Description 문구 | **없어도 이해되면 쓰지 않는다** |
| 모든 Heading 앞 Icon | Icon 은 의미가 있을 때만 |

**쓴다:**

- 🔴 **Card 를 «무조건 제거»하지 않는다.** 중요한 정보·요약·목록처럼 **덩어리로 읽혀야 하는
  것**은 올라온 표면에 둔다. 약한 shadow + border + 배경 대비로 depth 를 준다
- 🔴 **Radius 를 한 값으로 고정하지 않는다.** `--radius: 0.625rem` 에서 나오는 단계를
  화면 성격에 맞게 쓴다 — 버튼 `rounded-md` · 카드 `rounded-xl`
- 🔴 **Primary/Accent 를 «제한적으로» 써서 브랜드 인상을 만든다.** 넓은 면적에 반복하지 않고
  **Primary Action · 선택 상태 · Focus · 의미 있는 강조**에만. 나머지는 Neutral 이 기본
- **버튼·Input 을 작고 딱딱하게 만들지 않는다.** 기본 높이는 `h-9` 다 —
  `h-7`·`h-8` 로 촘촘히 깔면 내부 관리도구가 된다
- **hover · selected · active 에 미묘한 transition** 을 준다

표면은 세 단계다 — 페이지(`--background`) < 옅은 면(`--surface-muted`) < 올라온 면(`--card`).

### Layout

```text
Page Header  ->  Toolbar / Filter  ->  Primary Content  ->  Secondary Information
```

불필요한 Container 중첩을 피한다.
**페이지에 독립적인 Card 가 떠 있는 느낌이 아니라, 하나의 업무 화면으로 연결된 느낌**을 만든다.

### Dashboard — Card Gallery 도, 맨 표도 아니다

```text
Overview
────────────────────────────────────
Reviews      Issues      Open      Resolved
184          427         38        389

Needs Attention
────────────────────────────────────
HIGH   SMIL    Transaction Boundary
HIGH   ERP     Race Condition

Frequent Patterns
────────────────────────────────────
MISSING_VALIDATION            31
N_PLUS_ONE                    18
```

KPI 는 **한 장의 표면 안에서 세로선으로 나눈다.** 카드 넷을 띄우면 비교해야 할 숫자끼리
멀어지고, 아무 표면도 없으면 페이지가 밋밋해진다.

계층은 셋이다 — **Label(작고 흐림) · 값(크고 진함) · Hint(가장 흐림).**
🔴 **값이 없는 것과 0 은 다르다.** 없으면 `—` 다.

🔴 **빈 공간을 너무 많이 만들지 않는다.** 데이터가 없을 때도 Empty State 가 화면 절반을
차지하게 두지 않는다.

### Table 중심

Review · Issue · Repository · Project 목록은 **Table 을 우선**한다. 장식용 Container 로 여러 번 감싸지 않는다.
중요한 정보는 **Column Alignment 와 Typography** 로 가른다.

- **한 셀 안에서 계층을 만들 수 있다** — 이름(주) 아래 보조 metadata. 열을 하나 더
  만들면 표가 옆으로 길어지고 이름이 묻힌다
- **Row hover** 를 살려 「고를 수 있는 목록」으로 읽히게 한다. 스프레드시트가 아니다
- 머리 행은 옅은 표면 + 작은 대문자로 데이터 행과 갈라 둔다

- **Row 마다 Button 을 여러 개 노출하지 않는다.** Primary 는 Row click 또는 핵심 Action 하나
- Secondary Action 은 필요하면 Dropdown Menu 로 옮긴다

### Badge · Typography · Icon · Color

- **Badge 는 실제 상태·분류에만** — `CRITICAL` `HIGH` `OPEN` `RESOLVED` `SECURITY`.
  🔴 Repository 이름 · Project 이름 · 작성자 · 날짜 같은 일반 Metadata 를 Badge 로 만들지 않는다
- **구분은 Box 보다 Typography 로 먼저** 한다. 계층이 명확해야 한다 —
  Page Title · Section Heading · Entity Heading · Primary Data · Secondary Metadata · Helper Text.
  🔴 **모든 Text 를 muted 처리하지 않는다.** 중요 정보와 보조 정보의 대비가 살아 있어야 한다
- **Icon 은 의미 전달에 도움이 될 때만.** 모든 Heading 앞에 붙이지 않는다
- **Color 는 의미에만** — 상태 · Severity · Selection · Primary Action · 중요한 Feedback.
  Primary Color 를 넓은 면적에 반복하지 않고, 일반 Container 를 색으로 가르지 않는다. **Neutral 이 기본**

### 상세 화면은 두 단이다

🔴 **데이터를 Card 여러 개로 무작정 쪼개지 않는다.** 한 단으로 늘어놓으면 「제목 +
구분선」이 끝없이 이어져 무엇이 본문이고 무엇이 도구인지 구분되지 않는다.

```text
┌ 본문(넓게) ──────────────┐ ┌ 곁 정보(좁게) ┐
│ 핵심 내용 · 이력          │ │ 상태 변경      │
│                          │ │ metadata      │
└──────────────────────────┘ └───────────────┘
```

**상단에는 entity identity 가 분명해야 한다** — 제목 · 상태 표시 · 그것에 딸린 사실 한 줄.

### Form

- 🔴 **모든 Field 를 같은 크기의 박스로 나열하지 않는다.** 관련된 것끼리 묶는다
- **Label · 설명 · 오류**의 계층이 분명해야 한다
- **Dialog 안에도 숨 쉴 여백**을 둔다

### Sidebar 는 Navigation 도구다

장식 영역이 아니다. **Workspace · Project · Navigation 세 계층이 눈으로 갈려야** 한다.

```text
[ CodeApex ▼ ]        <- Workspace Switcher (Tenant)

Dashboard
Projects
Knowledge
────────────
SMIL                  <- 현재 Project (Context)

Overview
Reviews
Issues
Knowledge
Repositories
────────────
Members               <- 가끔 여는 것은 아래로
Settings
```

- 🔴 **모든 메뉴를 같은 시각적 강도로 두지 않는다.** 현재 Workspace · 현재 Project ·
  현재 Page 가 각각 구분되어야 한다
- 🔴 **Sidebar 안에서 Badge · Card · Box 를 남발하지 않는다.** 계층은 그룹과 divider 로 드러낸다
- **Workspace 전환 = Tenant 변경**, **Project 전환 = Context 변경**. 둘의 역할을 섞지 않는다
  (→ [11. Multi-Tenant](#11-multi-tenant-현재-규칙))

### Search / Filter · Empty · Loading

- 검색·필터는 **업무 도구처럼** 만든다. 검색창을 이유 없이 페이지 전체 폭으로 넓히지 않고,
  필터마다 별도 Card 를 만들지 않는다. **한 Toolbar 안에 밀도 있게** 두고 조회 결과와의 관계가 즉시 보이게 한다
- **Empty State**: Icon 하나 · 짧은 제목 · 필요할 때만 한 줄 설명 · 필요할 때만 CTA.
  🔴 거대한 Illustration·Marketing 문구 금지. 다만 **왜 비어 있는지**는 말한다 —
  「고장난 화면」과 구분되어야 한다
- **전체 화면 Loading 대신 데이터 영역 단위 Skeleton.** Skeleton 은 실제 Layout 과 비슷한 크기를 유지하고,
  과도한 Animation 을 넣지 않는다 (→ [8. SSR 우선](#8-ssr-우선--loading-ux))

### 🔴 화면을 만들기 전에 확인한다

```text
이것이 «덩어리»로 읽혀야 하는가? (그렇다면 Card 가 맞다)
Border 없이 배경 톤과 여백으로 가를 수 없는가?
Badge 가 실제 상태·분류를 뜻하는가?
Description 이 없으면 정말 이해할 수 없는가?
이 Icon 이 실제 정보를 전달하는가?
데이터보다 Component 가 더 눈에 띄지 않는가?
전형적인 shadcn Dashboard Template · 내부 관리도구처럼 보이지 않는가?
화면 전체가 흰색 + 회색 선의 연속으로 보이지 않는가?
```

**하나라도 불필요하면 «빼는» 쪽을 먼저 고른다.**

| | |
|---|---|
| ❌ | shadcn Component 를 조립한 화면 · 내부 관리도구 · shadcn demo |
| ✅ | **ReviewTrace 디자인을 구현하는 데 shadcn Primitive 를 쓴 화면** |

감각의 참고 — Linear 의 정돈된 정보 구조 · Vercel 의 typography 와 spacing ·
Stripe Dashboard 의 polished SaaS 느낌 · GitHub 의 데이터 밀도.
🔴 **어느 하나를 그대로 복제하지 않는다.**

기능과 접근성은 shadcn 에 맡기되, **제품의 Visual Identity 를 shadcn 기본 스타일에 맡기지 않는다.**

### UI Architecture — Atomic Design + shadcn/ui 【현재 규칙】

공용 UI 는 Atomic Design 을 쓴다.

```text
src/components/
  ui/          shadcn/ui 기반 Primitive
  atoms/       최소 단위의 공용 UI
  molecules/   여러 Primitive/Atom 을 조합한 작은 기능 단위
  organisms/   여러 Molecule/Atom 을 조합한 독립적인 공용 UI 영역
```

의존 방향: `ui -> atoms -> molecules -> organisms`

| 계층 | 무엇 | 예 |
|---|---|---|
| **ui** | shadcn/ui Primitive 의 **정본** | Button · Input · Select · Table · Dialog · Badge · Skeleton |
| **atoms** | 작고 재사용 가능한 **의미 단위** | SeverityBadge · StatusBadge · CodeLocation |
| **molecules** | Primitive/Atom 을 조합한 작은 공용 기능 단위 | SearchField · FilterField · IssueMeta · RepositorySelector |
| **organisms** | 화면에서 독립적인 영역을 이루는 공용 UI | DataTable · AppHeader · AppSidebar · FilterBar |

🔴 **동일 Primitive 를 Feature 마다 다시 구현하지 않는다.**
🔴 **모든 shadcn Component 를 Atom 으로 다시 감싸지 마라.** 추가 의미나 공통 동작이 없으면 `ui` 를 **직접** 쓴다.
**필요 없는 shadcn Component 를 전부 설치하지 않는다.**

### Domain Component 는 공용 계층으로 올리지 않는다

특정 Domain 의 업무 의미를 가진 Component 는 Atomic 공용 계층에 두지 않는다.

```text
features/issues/components/IssueHistory
features/issues/components/IssueResolutionForm
features/reviews/components/ReviewSummary
features/reviews/components/ReviewIssueList
```

여러 UI Component 를 조합하더라도 해당 Feature 안에 둔다.

**Component 크기가 아니라 「재사용 범위와 Domain 의존성」으로 위치를 정한다.**

```text
공용 UI     components/ui -> atoms -> molecules -> organisms
Domain UI   features/{domain}/components
```

🔴 **미래에 재사용할 것 같다는 이유만으로 Domain Component 를 공용 계층으로 승격하지 않는다.** 실제로 **여러 Feature 에서 같은 의미와 동작으로** 쓰일 때만 승격한다.

---

## 17. AI / LLM 은 후순위

현재 Architecture 의 핵심 흐름에 **LLM 이 없다.**

```text
External Agent -> Structured Review Data -> PostgreSQL -> Search / Statistics / Knowledge
```

**이 구조만으로 제품이 동작해야 한다.**

【향후】 데이터가 충분히 쌓인 뒤 검토: Issue Normalization · Automatic Tagging · Category Classification · Duplicate Detection · Resolution Summary · Similar Issue Search · Semantic Search. 그 시점에 필요하면 LLM API · Embedding · pgvector 를 검토한다.

🔴 **LLM 을 미래에 쓸 가능성만으로 현재 Domain 이나 Database 를 복잡하게 만들지 않는다.**

### MCP 【향후】

REST API 가 최초 Integration Boundary 다. Agent Integration 이 충분히 반복되면 MCP 를 추가할 수 있다(`record_review` · `record_issue_activity` · `resolve_issue` · `search_knowledge` · `get_repository_patterns` · `get_unresolved_issues`).
**REST API 로 충분하다면 MCP 를 미리 구현하지 않는다.**

---

## 18. Overengineering 금지

이유 없이 만들지 않는다:

```text
Generic Repository Framework · BaseService · BaseRepository · 자체 DI Container
CQRS · Event Sourcing · Event Bus · Microservices · Message Queue · Cache Layer
LLM Provider Abstraction · Vector Search Abstraction · 복잡한 Plugin Architecture
```

🔴 **추상화에는 실제 두 개 이상의 구현 또는 실제 변경 이유가 있어야 한다. 「나중에 필요할 수도 있어서」는 충분한 이유가 아니다.**

### Dependency 추가 규칙

새 Library 를 추가하기 전에 답한다: **「지금 어떤 문제를 해결하기 위해 필요한가?」**

현재 Stack 으로 해결할 수 있으면 추가하지 않는다. 특히 State Management · Date Library · Utility Library · API Client · Validation Library 를 **중복 도입하지 않는다.**

---

## 19. Security 【현재 규칙 — 처음부터 지킨다】

```text
Secret 을 Client Component 에 노출 금지
NEXT_PUBLIC_* 에 API Token 저장 금지
GitHub Token 은 Server-only
Review API Key 도 Server 에서 검증
Token / API Key 원문 Logging 금지
Client 가 전달하는 User/Tenant 식별자 신뢰 금지
외부 입력은 Zod 검증
Source Code 전체를 불필요하게 저장 금지
Error Response 에 Stack Trace · 내부 DB 정보 노출 금지
Server-only Module 이 Client Bundle 로 넘어가지 않게 경계 명확히
필요 이상의 개인정보 저장 금지
```

Server Component 에서 Client Component 로 데이터를 넘길 때도 **화면에 필요한 필드만** 전달한다.

### Error Handling

사용자·Agent 에게 Stack Trace · SQL · Database Error · Secret · Internal Path 를 노출하지 않는다.
Public API 는 일관된 Error Code 와 Message 를 쓴다.

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid review payload" } }
```

**Server 내부 Log 와 Public Error Response 를 구분한다.**

### Environment

`.env.example` 을 제공하되 **실제 값을 넣지 않는다.** 실제 Secret 은 Commit 하지 않는다.
들어갈 자리: `DATABASE_URL` · GitHub OAuth Secret · Application URL · 【향후】 Agent API Secret/Configuration

---

## 20. 변경 전 확인 · 범위

### 변경 전에 흐름을 먼저 읽는다

```text
Route -> Feature -> Server/Client Boundary -> Schema -> Application Logic -> Database
```

API 작업이면:

```text
Route Handler -> Authentication -> Zod Schema -> Application Service -> Repository -> Database Schema
```

🔴 **일부 파일만 보고 Architecture 를 추측하지 않는다.**

### 요청 범위 밖 수정 금지

작업 중 발견한 다른 문제를 임의로 함께 고치지 않는다. 현재 요청과 직접 관련 없는 **Refactoring · Rename · Dependency Upgrade · Formatting · Architecture 변경 · Schema 변경** 은 **별도 Issue 또는 보고 대상**으로 남긴다.

특히 **Database Schema 와 Public API Contract 변경은 영향 범위를 먼저 확인한다.**

---

## 21. 검증

코드 수정 후 반드시 Repository Root 에서 실행한다.

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

【향후 · Database 도입 시】 `pnpm db:generate` · `pnpm db:migrate` 로 Migration 상태도 검증한다.

🔴 **`pnpm dev` 가 떠 있는 채로 `pnpm build` 를 돌리지 않는다.** 둘이 `.next` 를 함께 쓰기 때문에
빌드가 dev 서버의 산출물을 덮어쓰고, dev 서버는 **살아 있는 채로 일부 Route 만 500 을 뱉는**
좀비가 된다. 실제로 그렇게 돼서 E2E 18건이 한꺼번에 실패했고 **코드에는 아무 문제가 없었다**.
증상이 「어떤 Route 만 500」이면 코드를 뒤지기 전에 `.next` 부터 의심해라 —
서버를 내리고 `rm -rf .next` 한 뒤 다시 띄우면 된다.

🔴 **검증 실패를 「기존 문제」라고 추측하지 않는다. 원인을 확인한다.** 기존 실패가 확실하면 근거와 함께 별도로 보고한다.
🔴 **DB 가 없어 검증할 수 없는 부분은 성공했다고 추측하지 말고 그 사실을 명확히 보고한다.**

### 완료 보고

작업 일지를 길게 쓰지 않는다. 이 순서로 요약한다:

```text
변경 내용 -> Architecture/Domain 영향 -> Database/API 변경 여부 -> 검증 결과 -> 남은 문제·후속 작업
```

🔴 **실행하지 않은 Test 를 성공했다고 쓰지 않는다. 확인하지 않은 동작을 정상이라고 추측하지 않는다.**

---

## 22. Git 규칙

### 브랜치

```text
feature/* -> develop -> main
```

- PR base 는 **항상 `develop`**. `main` 으로 PR 하지 않는다
- `main` 은 develop 반영 후 배포·릴리스
- **현재 체크아웃 브랜치에서만** 작업한다. 요청 없이 `switch`/`checkout`/`branch`/`merge`/`rebase`/`reset` 금지
- 브랜치 생성·삭제·이름 변경은 사용자가 직접 한다

### 실행 시점

아래는 **사용자 명시 요청이 있을 때만** 한다.

```text
git add / commit / push · gh pr create / merge · git tag
```

코드 작성 후 자동 Commit·Push·PR·Merge 금지.

### 커밋

형식: `type: subject` — **한 줄만**

| type | 용도 |
|------|------|
| `feat` | 기능 |
| `fix` | 버그 |
| `refactor` | 리팩터 |
| `test` | 테스트 |
| `perf` | 성능 |
| `security` | 보안 |
| `migration` | 스키마 이관 |
| `docs` | 문서 |
| `style` | 스타일 |
| `chore` | 설정·빌드·패키지 |

- subject 는 **한글·명사형**, 마침표·이모지 없음. scope 는 선택 (`feat(issues): ...`)
- 🔴 **`~한다` 류 서술형 종결을 쓰지 않는다**

| | |
|---|---|
| ❌ | `feat: Workspace invitation을 추가한다` · `fix: 소수점 표기 문제를 수정한다` |
| ✅ | `feat: Workspace invitation 추가` · `fix: 소수점 표기 오류 수정` |

- **한 커밋 = 독립적으로 설명 가능한 하나의 제품 변경.** `git add .` 로 전부 뭉치지 않는다

### 🔴 Git 은 «에이전트 행동 로그»가 아니다 — 이 저장소가 그 문제를 푼다

> **Git = 제품의 의미 있는 변경 이력**
> **ReviewTrace = Review · Finding · Fix Attempt · Verification · Resolution 이력**

이 규칙은 다른 저장소에도 적용되지만(전역 `~/.claude/CLAUDE.md` 3.2),
**여기서는 특별하다 — 이 저장소가 바로 「Git 에 넣지 말라」는 그 정보를 받는 곳이다.**

```text
에이전트 수  ≠  브랜치 수  ≠  커밋 수  ≠  PR 수
```

🔴 **리뷰 진행 기록만을 위한 커밋을 만들지 않는다** (`docs: Codex R17 리뷰 결과 기록` 따위).
그 정보는 **`ReviewSession`·`ReviewIssue`·`IssueActivity`·`Resolution`** 에 남는다 —
그것이 이 제품의 존재 이유다.

**`docs:` 자체는 금지가 아니다.** 나중에도 참고할 **지속적인 문서**는 정상이다.
갈리는 자리는 **「제품 문서인가, 리뷰 과정 보존인가」**다.

**리뷰 회차가 늘어도 새 PR 을 만들지 않는다.** R1 에서 R20 까지 가더라도 **같은 변경 목적이면 같은 PR** 이다.
새 PR 은 **기존 작업과 독립적일 때만** 연다.

자세한 기준(커밋 전 판단·머지 전 이력 정리·좋은 이력의 예)은 전역 `~/.claude/CLAUDE.md` 3.2 에 있다.
**여기서 다시 적어 갈라지게 하지 마라.**

### 이슈

제목 접두: `[Feature] ` · `[Fix] ` · `[Refactor] ` · `[Docs] ` · `[Style] ` · `[Chore] `

### PR

- 제목: `[#{번호}] {Type} : {작업 내용}` — 예: `[#12] Feature : Review Ingestion API 구현`
  - 작업 내용은 **커밋과 같은 문체**다 — 명사형
- base=`develop`, head=현재 브랜치
- 본문: 작업 내용 / 관련 이슈(`Close #n`) / 변경 사항 / 테스트 / 리뷰 포인트
- 🔴 이슈·PR 본문은 **`--body-file`** 로 넣는다 (`--body @-` 는 본문이 깨진다)
- 🔴 **에이전트의 사고 과정이나 리뷰 회차 전체를 PR 본문에 옮겨 붙이지 않는다**

```bash
gh pr create --base develop --head $(git branch --show-current)
```

### 🔴 AI 제작 표기 금지

커밋·PR·이슈에 다음을 **넣지 않는다**:

```text
Co-Authored-By: Claude <noreply@anthropic.com>   (모델명이 들어간 변형 포함)
Generated with Claude Code
Made with Cursor / Built with Cursor / Co-authored-by: Cursor <cursoragent@cursor.com>
그 밖의 AI 제작 표기
```

**이 규칙은 커밋 trailer·PR 본문 서명을 자동으로 붙이는 기본 동작보다 우선한다.**

커밋 후 `git log -1 --format=full` 로 trailer 가 없는지, PR 후 본문에 표기가 없는지 확인한다.

---

## 23. 최종 원칙

가장 중요한 것은 코드 양이 아니라 이 Loop 가 정확하게 보존되는 것이다.

```text
Review -> Issue -> Fix -> Verification -> Resolution -> Knowledge -> Pattern -> Next Review
```

새 기능을 만들 때 항상 확인한다.

> **이 변경이 Review Knowledge 를 더 정확하게 축적하고 다시 활용하는 데 어떤 역할을 하는가?**

그 역할이 없다면 Core Domain 에 억지로 결합하지 않는다.
