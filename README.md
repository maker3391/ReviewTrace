# Code Intelligence

Coding Agent(Claude Code · Codex CLI · 그 밖의 Agent · 사람)의 **Code Review 결과를 장기간
축적하고 다시 활용**하기 위한 Developer Intelligence System.

```text
Code Change -> External Agent Review -> ReviewSession -> ReviewIssue
  -> Fix Attempt -> Verification -> Resolution -> Pattern / Knowledge
  -> 다음 개발 및 Review 에서 재사용
```

🔴 **이 프로젝트는 AI Code Reviewer 를 만들지 않는다.** Review 는 외부 Agent 가 한다.
여기의 책임은 **수집 → 구조화 → 저장 → 추적 → 검색 → 분석 → 재사용** 이다.

작업 규칙·Domain·Architecture 의 정본은 [`CLAUDE.md`](./CLAUDE.md) 다.
**무엇이 실제로 존재하는지는 그 문서 0절이 정본이다.**

---

## 1. 지금 이 저장소는 Boilerplate 다

Business Feature 는 아직 없다. 있는 것은 **그것을 올릴 바닥**이다.

| 있다 | 없다 (다음 단계) |
|---|---|
| Next.js 16 App Router · React 19 · TypeScript strict | GitHub OAuth · 세션 |
| Tailwind 4 · shadcn/ui(11개) · Atomic Design 계층 | Agent Review Ingestion API (`POST /api/v1/reviews`) |
| PostgreSQL + Drizzle Schema · Migration 환경 | API Key 발급·검증 |
| Zod · React Hook Form | ReviewIssue CRUD · Resolution 기록 |
| SSR + Suspense + Skeleton 조회 골격 (`/issues`) | Repositories · Knowledge 화면 |
| Error Handling · `ActionResult` 계약 | Dashboard 통계 |
| Lint · Typecheck · Test · Build | |

🔴 **Dashboard 에 통계 숫자가 없는 것은 미완성이 아니라 의도다.** 데이터를 쌓는 경로가 아직
없으므로 숫자를 그리면 전부 거짓이다.

---

## 2. 시작하기

### 2.1 요구 사항

- Node.js 20.9 이상 (개발·검증은 Node 24 에서 했다)
- pnpm 11
- PostgreSQL 17 — 로컬에 없으면 아래 Docker 로 띄운다

### 2.2 설치

```bash
pnpm install
cp .env.example .env   # 값을 채운다
```

`.env` 에 반드시 있어야 하는 값은 `DATABASE_URL` 하나다.
**없으면 기동 대신 실패한다** — 기본값을 두지 않았다(`src/lib/env.schema.ts`).

### 2.3 PostgreSQL

이 저장소는 **띄우는 방법만 제공한다. 실행은 사장님이 직접 한다.**

```bash
# .env 에 POSTGRES_PASSWORD 를 먼저 채운다 (DATABASE_URL 과 같은 값)
docker compose up -d
docker compose down     # 정지 (데이터는 볼륨에 남는다)
docker compose down -v  # 정지 + 데이터 삭제
```

컨테이너 이름은 `code-intelligence-postgres`, 볼륨은 `code-intelligence-postgres-data` 다.
**다른 프로젝트의 컨테이너와 섞이지 않는다.**

### 2.4 Migration

```bash
pnpm db:generate   # Schema 변경 -> SQL 파일 생성 (Database 없이 돈다)
pnpm db:migrate    # 생성된 SQL 을 Database 에 적용 (Database 필요)
```

- 정본은 `src/db/schema/**` 이고, 산출물은 `src/db/migrations/**` 다. **둘 다 커밋한다**
- `drizzle-kit push` 는 쓰지 않는다 — 생성된 SQL 을 사람이 읽고 리뷰한 뒤에 적용한다

### 2.5 개발 서버

```bash
pnpm dev     # http://localhost:3000
```

---

## 3. 검증

코드를 고쳤으면 저장소 루트에서 **네 개 모두** 돌린다.

```bash
pnpm lint
pnpm typecheck   # next typegen && tsc --noEmit
pnpm test        # vitest run
pnpm build
```

`typecheck` 가 `next typegen` 을 먼저 부르는 이유: `typedRoutes` 로 생성되는 Route 타입과
`PageProps` / `LayoutProps` 가 없으면 `tsc` 만으로는 실제 빌드와 같은 것을 보지 못한다.

---

## 4. 구조

```text
src/
  app/                     Routing / Layout / Composition — 얇게 유지한다
    (dashboard)/           Dashboard Shell (Header + Sidebar)
    error.tsx              화면 단위 Error Boundary
    global-error.tsx       Root Layout 이 깨졌을 때
  features/                Domain Feature
    issues/                components/ schemas/ server/ types/
  components/
    ui/                    shadcn/ui Primitive (정본)
    atoms/                 SeverityBadge · StatusBadge · CodeLocation
    molecules/             SearchField · FilterSelectField
    organisms/             AppHeader · AppSidebar
  db/
    schema/                Drizzle Schema (정본)
    migrations/            생성된 SQL
    index.ts               Lazy Drizzle Client
  lib/
    action/                Server Action 반환 계약 (ActionResult)
    auth/                  Workspace Context — 인증이 붙을 자리
    env.schema.ts          환경 변수 Zod Schema (순수)
    env.ts                 검증된 환경 변수 로더 (server-only)
    errors.ts              AppError · PublicError
  config/                  navigation(메뉴 ↔ 라우트 대응표) · app
  types/                   Domain 값 집합 (Database Enum 과 같은 배열을 본다)
```

의존 방향은 `ui -> atoms -> molecules -> organisms` 다.
**Domain 의 의미를 가진 Component 는 공용 계층으로 올리지 않고** `features/{domain}/components` 에 둔다.

---

## 5. 이 Boilerplate 가 못 박은 것

### 조회는 SSR

`/issues` 가 그 본보기다.

```text
Search/Filter -> URL Search Params 변경 -> Server Component 재실행
  -> Suspense Boundary -> Table Skeleton -> 새 Result
```

- Filter·Search·Pagination 상태는 **URL 에만** 있다. 새로고침·URL 공유·뒤로가기가 된다
- 🔴 조회 중에도 **Header · Search · Filter 는 남고 Table 영역만** 바뀐다.
  그래서 `loading.tsx` 를 쓰지 않고 Table 만 감싸는 `<Suspense>` 를 쓴다
- Skeleton 은 실제 Table 과 **같은 열·같은 행 높이**로 그린다 (Layout Shift 방지)

### Server Action 은 Transport

```text
브라우저 폼 -> Server Action -> Application Service -> Repository -> PostgreSQL
                   |
                   +-> revalidatePath — 서버가 목록을 다시 그린다
```

- 업무 규칙·검증·트랜잭션은 Application Layer 의 몫이다
- 🔴 **실패는 예외로 던지지 않고 `ActionResult` 로 돌려준다.** 프로덕션 빌드에서 Server Action 의
  예외는 **메시지가 지워진 채** 도착해 화면이 이유를 보여 줄 수 없다.
  계약과 헬퍼는 `src/lib/action/action-result.ts` 에 있다
- 아직 **Mutation 이 하나도 없어 실제 Server Action 파일은 없다.** 계약만 준비돼 있다

### 외부 입력은 Zod

- **URL Search Params** 는 `.catch()` 로 기본값에 떨어뜨린다 — 주소창의 오타가 화면을 500 으로 만들지 않는다
- **Form** 은 같은 값이라도 별도 Schema 로 검증해 사용자에게 알린다 (React Hook Form + `zodResolver`)
- **환경 변수**도 외부 입력이다. 형식이 틀리면 읽는 순간 실패한다

### Multi-Tenant 는 Workspace

```text
Web Request    Session -> User -> Workspace Membership -> Authorized Workspace
Agent Request  API Key -> Key Lookup -> Workspace       -> Authorized Workspace
```

🔴 **Client 가 보낸 `userId`·`workspaceId` 로 접근 권한을 정하지 않는다.**
판정은 `src/lib/auth/workspace-context.ts` 한 곳에서 한다 — 인증이 붙을 때 고칠 자리가 하나다.

지금은 인증이 없어 이 함수가 `null` 을 돌려주고, `/issues` 는
「Workspace 를 결정할 수 없습니다」를 그린다. **없는 것을 있는 것처럼 흉내내지 않았다.**

### 오류는 code 와 message 만 나간다

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid review payload" } }
```

Stack Trace · SQL · Driver 오류 원문 · 내부 경로는 밖으로 나가지 않는다.
알 수 없는 오류는 `INTERNAL_ERROR` 로 뭉갠다 — Driver 는 접속 문자열을 message 에 실어 던진다.

---

## 6. Database

```text
User -> WorkspaceMember -> Workspace
                             |-- ApiKey
                             +-- Repository -> ReviewSession -> ReviewIssue
                                                                  |-- IssueActivity
                                                                  +-- IssueTag -- Tag
```

- 🔴 **검색·Filter·Statistics 에 쓰는 값은 JSONB 에 몰아넣지 않는다.**
  `severity` `category` `status` `patternKey` `filePath` 는 전부 Column 이고 Enum 으로 못 박혀 있다.
  JSONB 는 Agent 원본 Payload(`review_sessions.raw_payload`) 한 자리에만 쓴다
- 🔴 **Index 는 조회 패턴이 있는 것만 만들었다.** 각 Index 옆에 어떤 화면이 쓰는지 적어 두었다
- `ReviewSession` 의 대상은 PR 에 한정하지 않는다 — `PULL_REQUEST · COMMIT · BRANCH · REPOSITORY · MANUAL`.
  **PR 번호는 Optional Metadata 일 뿐 Domain Root 가 아니다**

---

## 7. 다음 단계

순서대로다.

1. **인증 · Workspace 결정** — `findCurrentWorkspace()` 를 실제로 구현한다. 이것이 없으면 나머지가 전부 못 돈다
2. **Agent Review Ingestion API** (`POST /api/v1/reviews`) — API Key 인증 + Zod + 한 Transaction 안 Batch Insert
3. **API Key 발급·검증** — 원문 1회 표시, Hash 만 저장
4. **Issue 상세 · IssueActivity · Resolution 기록**
5. **Knowledge 조회** (`GET /api/v1/knowledge/context`)

---

## 8. Git

```text
feature/* -> develop -> main
```

- PR base 는 항상 `develop`. `main` 으로 직접 PR 하지 않는다
- 커밋: `type: subject` 한 줄, 한글 명령형 (`feat` `fix` `refactor` `docs` `style` `chore`)
- **한 커밋 = 한 작업.** `git add .` 로 전부 뭉치지 않는다
