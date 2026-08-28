@AGENTS.md

# Code Intelligence 작업 규칙

이 문서는 **이 저장소의 제품 목적·핵심 Domain·Architecture·Rendering 전략·Database 원칙·API 경계·Security·작업 규칙의 정본**이다.
Claude 사용법이나 일반적인 코딩 상식을 적는 곳이 아니다.

`AGENTS.md` 는 Next.js 가 스스로 써 넣는 프레임워크 안내다. 이 문서와 역할이 겹치지 않는다 — 프레임워크 사용법은 그쪽, 이 저장소의 규칙은 여기.

> **읽는 법 — 이 문서는 두 층으로 되어 있다**
> **【현재 규칙】** 지금 지켜야 하는 것.
> **【향후】** 아직 없는 것. **있는 것처럼 코드를 쓰거나 문서를 고치지 마라.**
> 실제 구현 현황은 아래 「0. 지금 있는 것」 이 정본이다.

---

## 0. 지금 있는 것

**Boilerplate 는 갖춰졌다. Business Feature 는 아직 하나도 없다.**
**이 절이 「무엇이 실제로 존재하는가」의 정본이다.** 무언가를 만들면 여기부터 고쳐라.

| | 상태 |
|---|---|
| Next.js 16 App Router · React 19 · TypeScript strict | 있다 |
| Tailwind CSS 4 · ESLint · pnpm | 있다 |
| shadcn/ui Primitive **11개** (`components/ui`) | 있다 — Button · Input · Textarea · Select · Badge · Table · Dialog · Dropdown Menu · Skeleton · Card · Tooltip |
| Atomic Design 계층 (`atoms` · `molecules` · `organisms`) | 있다 |
| Drizzle Schema (10 table · 8 enum) · Migration 환경(`db:generate`·`db:migrate`) | 있다 |
| Zod · React Hook Form(`zodResolver`) | 있다 |
| Feature 디렉터리 (`features/issues`) | 있다 |
| Dashboard Shell (`app/(dashboard)` + AppHeader · AppSidebar) | 있다 |
| SSR + Suspense + Skeleton 조회 골격 (`/issues`) | 있다 |
| Error Handling (`AppError` · `PublicError` · `error.tsx` · `global-error.tsx` · `not-found.tsx`) | 있다 |
| Server Action 반환 계약 (`ActionResult`) | **계약만** 있다 — Mutation 이 없어 실제 `'use server'` 파일은 없다 |
| 환경 변수 구조 (`.env.example` · Zod 검증) · `docker-compose.yml` | 있다 |
| Test(`pnpm test`, vitest) · `typecheck` script | 있다 |
| **PostgreSQL · Migration 적용** | **있다.** Docker(`code-intelligence-postgres`)로 띄워 `db:migrate` 적용·확인 완료 |
| 인증 · 세션 · Workspace 결정 | **없다.** `findCurrentWorkspace()` 가 `null` 을 돌려준다 |
| GitHub OAuth · API Key 발급 · Review API · ReviewIssue CRUD | **없다. 다음 단계** |
| Dashboard 통계 | **없다. 의도적이다** — 데이터를 쌓는 경로가 없어 숫자를 그리면 전부 거짓이다 |

### 검증된 것 (2026-08-28 실행)

`pnpm lint` · `pnpm typecheck` · `pnpm test`(16개) · `pnpm build` **네 개 모두 통과했다.**
`pnpm db:generate` 로 `src/db/migrations/0000_*.sql` 이 생성됐다 — 이것은 Database 없이 도는 명령이다.
`next start` 로 띄워 `/` 200 · `/issues` 렌더 · `/nope` 404 를 확인했고 **확인 뒤 종료했다.**

**`pnpm db:migrate` 가 실제 PostgreSQL 에서 돌았다 (2026-08-28).** `docker compose up -d` 로
`postgres:17-alpine` 을 띄우고 적용했다. 생성 결과를 직접 조회해 확인한 것:

- **10 table · 8 enum** 전부 생성 — `users` `workspaces` `workspace_members` `api_keys` `repositories`
  `review_sessions` `review_issues` `issue_activities` `tags` `issue_tags`
- `review_issues.severity`·`category`·`status` 가 **진짜 enum 컬럼**이다(`issue_severity` 등).
  JSON 속에 묻히지 않아 인덱스가 걸린다
- **JSONB 는 `review_sessions.raw_payload` 한 자리뿐**이다 (`information_schema` 전수 조회)
- 목록 화면용 복합 인덱스 `(workspace_id, status, severity, detected_at DESC)` 생성 확인.
  전체 24개 = 설계한 6개 + PK·unique 제약이 만든 것
- FK 는 전부 `ON DELETE CASCADE`

### 🔴 검증되지 않은 것

- **Drizzle Query 가 실제로 도는 것을 본 적이 없다.** Schema 는 실제 Database 에 만들어졌지만,
  인증이 없어 `findIssues()` 까지 실행이 닿지 않는다. 타입과 빌드만 통과했을 뿐이다
- **행을 넣고 읽어 본 적이 없다.** 위 확인은 전부 **Schema 조회**이고 INSERT/SELECT 는 돌리지 않았다 —
  「테이블이 있다」와 「쿼리가 돈다」는 다른 말이다
- 위를 「될 것이다」로 적지 마라. 확인한 사람이 이 표를 고쳐라

🔴 **없는 것을 있는 것처럼 쓰지 마라.** 실행하지 않은 검증을 통과했다고 적지 않는다. 확인하지 않은 동작을 정상이라고 추측하지 않는다.

---

## 1. 프로젝트 목적

**Code Intelligence** 는 Coding Agent 의 Code Review 결과를 장기간 축적하고 다시 활용하기 위한 Developer Intelligence System 이다.

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

Code Intelligence 의 책임은 Review 자체가 아니라 **수집 -> 구조화 -> 저장 -> 추적 -> 검색 -> 분석 -> 재사용** 이다.

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

### app 은 얇게 유지한다

`src/app` 에 Business Logic 을 넣지 않는다. `page.tsx` 는 Feature Screen 을 조합하거나 Server Component 를 호출하는 역할만 한다.

```text
src/app/(dashboard)/issues/page.tsx -> src/features/issues/components/IssueListScreen.tsx
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

Code Intelligence 는 **조회 중심 Developer Tool** 이다. Reviews · Issues · Knowledge · Repositories · Dashboard 는 SSR / Server Component 를 우선한다.

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
                             +-- Repository -> ReviewSession -> ReviewIssue
                                                                  |-- IssueActivity
                                                                  +-- IssueTag -- Tag
```

개인용으로 시작하더라도 **Workspace 를 Tenant Boundary 로 쓴다.**

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
Web Request    Session -> User -> Workspace Membership -> Authorized Workspace
Agent Request  API Key -> Key Lookup -> Workspace -> Authorized Workspace
```

### 화면 접근은 서버가 먼저 막는다 【향후 — 인증 도입 시】

**자격이 없으면 렌더 전에 돌려보낸다.** 경로별 접근 표는 **한 곳**에 둔다.

- 🔴 **클라이언트 판정을 「추가」하는 것으로 대신하지 않는다.** 렌더가 시작되면 상위 `loading.tsx` 골격이 먼저 스트리밍돼, 브라우저가 되돌려 보내기 전에 **보호된 화면의 뼈대가 한 번 보인다**
- 🔴 **공개 경로는 목록이고, 목록에 없으면 보호다.** 로그인 화면은 반드시 공개다 — 막으면 무한 리다이렉트가 된다
- **「로그인했다」와 「그 권한이다」는 다른 판정이다.** 권한이 필요한 화면은 권한까지 서버에서 확인하고, 읽지 못하면 열지 않는다
- 세부 권한(메뉴·기능 단위)은 서버가 요청마다 차단하는 것이 정본이다. 화면 판정은 그 앞의 편의일 뿐이다

### 세션 【향후 — 인증 도입 시】

- **Token 은 브라우저에 존재하지 않는다.** 서버 측 세션에만 두고, 세션 응답에는 **사용자 프로필만** 담는다 — Token 을 세션 콜백에 담으면 세션 조회로 브라우저에 새어 나간다
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

### 입력 정규화·권한 미러링 【향후 — 인증 도입 시】

- 이메일 등 식별 값은 보내기 직전에 **공통 정규화 함수 한 곳**에서 앞뒤 공백 제거·소문자화 한다. 형식 거부는 Schema 가 먼저 하고 **최종 판단은 서버가** 한다
- 화면의 권한 미러링(버튼 비활성 등)은 **편의일 뿐 경계가 아니다.** 서버가 같은 판정을 반드시 다시 한다
- 메뉴 키 ↔ 사이드바 항목 ↔ 라우트 대응표는 **한 파일**에 둔다. 여러 곳에 흩으면 갈라진다

---

## 12. API Key 【향후 — 구조만 준비】

```text
Authorization: Bearer rk_xxxxxxxxx
```

🔴 **API Key 원문을 Database 에 저장하지 않는다.**

```text
ApiKey: id · workspaceId · name · keyPrefix · keyHash · lastUsedAt · expiresAt · revokedAt · createdAt

발급  Secure Random Token -> 사용자에게 원문 1회 표시 -> Hash 생성 -> Hash 만 DB 저장
```

API Key 는 충분한 Entropy 를 가진 Random Secret 이므로 Hash 기반 Lookup 을 쓴다.
**Token 을 Log 에 출력하지 않는다.**

---

## 13. Public Agent API 【향후 — 경계만 준비】

Namespace 는 `/api/v1/**` 로 통일하고 Versioning 한다.

```text
POST   /api/v1/reviews
PATCH  /api/v1/issues/{id}
POST   /api/v1/issues/{id}/activities
GET    /api/v1/knowledge/context
```

**API 는 Claude/Codex 에 종속되지 않는다.** Claude · Codex · Gemini · Custom Agent · 사람이 쓰는 도구 — 어떤 Client 라도 같은 계약을 쓸 수 있어야 한다.

### Review Ingestion

```json
{
  "repository": { "provider": "GITHUB", "fullName": "owner/repository" },
  "target":     { "type": "COMMIT", "branch": "develop", "commitSha": "a81f3c2" },
  "reviewer":   { "type": "AGENT", "name": "codex" },
  "issues":     []
}
```

```text
API Key -> Workspace 결정 -> Zod Validation -> Repository 확인
  -> Transaction -> ReviewSession -> ReviewIssues -> Tags/Activities -> Commit
```

🔴 **Client 가 Workspace 를 임의 지정하도록 만들지 않는다.**

---

## 14. Knowledge 는 양방향이다

```text
1) Agent -> Review -> Code Intelligence
2) Code Intelligence -> Past Knowledge -> Agent
```

**2번이 장기적으로 중요하다.** Agent 가 작업·Review 를 시작하기 전에 **Repository 의 반복 문제 · 과거 HIGH/CRITICAL Issue · 미해결 Issue · 과거 Resolution · 자주 발생하는 Pattern** 을 조회할 수 있어야 한다.

【향후】 `GET /api/v1/knowledge/context` 또는 MCP Tool 로 제공할 수 있다.

---

## 15. GitHub Integration 【향후】

주요 SCM Provider 는 GitHub 다. 그러나 **Core Domain 을 GitHub API Model 에 직접 종속시키지 않는다.**

Repository 는 최소한 `provider · externalRepositoryId · owner · name · fullName · defaultBranch` 를 갖는다.
GitHub API 호출 코드는 **Integration Boundary 로 분리**한다.

🔴 **GitHub 에서 Source Code 전체를 DB 로 복제하는 구조를 기본값으로 만들지 않는다.** 저장 대상은 Review Knowledge 다.

---

## 16. UI 원칙 【현재 규칙】

이 제품은 **Developer Tool** 이다. Marketing SaaS 처럼 디자인하지 않는다.

**방향**: Dense · Flat · Data First · Desktop First · Clear Hierarchy · Low Decoration

| 피한다 | 우선한다 |
|---|---|
| 거대한 Hero · 과도한 Gradient · 모든 것을 Card 로 감싸기 · 불필요한 Animation · 빈 공간 과다 · 장식용 KPI | Table · Search · Filter · Code Location · Severity · Status · Pattern · Resolution · History |

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
| `docs` | 문서 |
| `style` | 스타일 |
| `chore` | 설정·빌드·패키지 |

- subject 는 **한글·명령형**, 마침표·이모지 없음. scope 는 선택 (`feat(issues): ...`)
- **한 커밋 = 한 도메인/작업.** `git add .` 로 전부 뭉치지 않는다

### 이슈

제목 접두: `[Feature] ` · `[Fix] ` · `[Refactor] ` · `[Docs] ` · `[Style] ` · `[Chore] `

### PR

- 제목: `[#{번호}] {Type} : {작업 내용}` — 예: `[#12] Feature : Review Ingestion API 구현`
- base=`develop`, head=현재 브랜치
- 본문: 작업 내용 / 관련 이슈(`Close #n`) / 변경 사항 / 테스트 / 리뷰 포인트
- 🔴 이슈·PR 본문은 **`--body-file`** 로 넣는다 (`--body @-` 는 본문이 깨진다)

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
