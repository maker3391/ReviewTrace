# 배포 · 운영 구성

**공식 운영 주소는 `https://reviewtrace.app` 이다.** 문서·안내·MCP 예시가 사용자에게 보여 주는
주소는 전부 이것 하나다 — 배포 플랫폼이 주는 주소(`*.vercel.app`)를 사용자에게 노출하지 않는다.

```
Vercel (Next.js) ──► Supabase PostgreSQL
 ▲ ▲
 │ │
 git push 사람이 누르는
 (자동 배포) Migrate workflow
```

**GitHub Actions 는 배포하지 않는다.** 검증(CI)과 사람이 누르는 Migration 두 가지만 맡는다.
Vercel 이 Git 연동으로 스스로 빌드·배포한다 — 두 곳에서 배포하면 같은 커밋을 두 번 빌드하고
배포 주체가 갈린다.

---

## 1. 환경 변수

정본은 `src/lib/env.schema.ts` 다. **이 표는 그 파일에서 옮겨 적은 것이고, 추측이 없다.**

| 변수                       | 필수         | 기본값                   | 무엇                                                                                                                                                                               |
| -------------------------- | ------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`             | **필수**     | —                        | `postgres://` 또는 `postgresql://` 로 시작해야 한다                                                                                                                                |
| `AUTH_SECRET`              | **필수**     | —                        | **32자 이상.** `openssl rand -base64 32`                                                                                                                                           |
| `GITHUB_CLIENT_ID`         | **필수**     | —                        | GitHub OAuth App                                                                                                                                                                   |
| `GITHUB_CLIENT_SECRET`     | **필수**     | —                        | GitHub OAuth App                                                                                                                                                                   |
| `APP_URL`                  | 사실상 필수  | `http://localhost:3000`  | 운영은 **`https://reviewtrace.app`**. 🔴 **반드시 덮어쓴다** — Settings 화면이 Agent 에게 알려 주는 API 주소가 이 값이라, 기본값이 남으면 사용자의 Agent 가 자기 컴퓨터를 가리킨다 |
| `GITHUB_API_TOKEN`         | 선택         | 없음                     | Public Code Evidence 익명 호출의 rate limit만 높인다. Private 권한은 GitHub App installation에서 얻는다                                                                            |
| `GITHUB_API_URL`           | 선택         | `https://api.github.com` | GitHub Enterprise 를 쓸 때만. `/api/v3` base path는 허용하지만 원격 endpoint는 HTTPS여야 한다                                                                                      |
| `GITHUB_APP_ID`            | 연동 시 필수 | —                        | GitHub App ID. JWT issuer                                                                                                                                                          |
| `GITHUB_APP_CLIENT_ID`     | 연동 시 필수 | —                        | 설치 callback의 일회용 user token 교환                                                                                                                                             |
| `GITHUB_APP_CLIENT_SECRET` | 연동 시 필수 | —                        | Server-only. callback code 교환에만 사용                                                                                                                                           |
| `GITHUB_APP_PRIVATE_KEY`   | 연동 시 필수 | —                        | PEM private key. source/DB/client/log에 저장·노출하지 않는다                                                                                                                       |
| `GITHUB_APP_SLUG`          | 연동 시 필수 | —                        | `https://github.com/apps/{slug}/installations/new` 구성                                                                                                                            |
| `GITHUB_WEB_URL`           | 선택         | `https://github.com`     | OAuth/install web origin. 원격 endpoint는 HTTPS                                                                                                                                    |
| `NODE_ENV`                 | 선택         | `development`            | Vercel 이 알아서 `production` 을 넣는다                                                                                                                                            |

🔴 **`AUTH_URL` 은 넣지 않는다.** `src/lib/auth/config.ts` 가 `trustHost: true` 라 앞단이 넘긴
Host 로 콜백 URL 을 만든다. Vercel 은 그 Host 를 올바로 넘긴다.

🔴 **`NEXT_PUBLIC_*` 는 하나도 없다.** 위 값은 전부 서버 전용이라 브라우저로 나가지 않는다.

GitHub App은 `Metadata: read`와 `Contents: read`만 요청한다. webhook, Issues, Pull requests,
Checks, Actions 권한은 현재 endpoint가 사용하지 않으므로 요청하지 않는다. Callback URL은
`{APP_URL}/api/github/app/callback`, 설치 시 **Request user authorization (OAuth)** 를 켠다.
callback user token은 `GET /user/installations` 소유권 확인 후 저장하지 않는다.

---

## 2. Supabase — 어떤 연결을 어디에 쓰나

Supabase 는 **PostgreSQL 호스팅으로만** 쓴다. Auth·Storage·Realtime 을 쓰지 않으므로
**`@supabase/supabase-js` 를 넣지 않는다.** 구조는 그대로다:

```
Application ──► Drizzle ORM ──► node-postgres(pg) ──► Supabase PostgreSQL
```

Supabase 는 연결 방식을 넷 준다. 🔴 **포트로 고르지 마라 — 이름으로 고른다.**
`5432` 를 쓰는 것이 «둘»이고, 그 둘은 host 도 user 도 성격도 다르다.

| 대시보드 이름                                    | host                               | port     | user                    | IP                             | prepared stmt |
| ------------------------------------------------ | ---------------------------------- | -------- | ----------------------- | ------------------------------ | ------------- |
| **Direct connection**                            | `db.[project-id].supabase.co`      | 5432     | `postgres`              | **IPv6** (IPv4 는 유료 add-on) | 지원          |
| **Shared Pooler (Supavisor) — Session mode**     | `aws-[region].pooler.supabase.com` | 5432     | `postgres.[project-id]` | **IPv4**                       | 지원          |
| **Shared Pooler (Supavisor) — Transaction mode** | `aws-[region].pooler.supabase.com` | **6543** | `postgres.[project-id]` | **IPv4**                       | **미지원**    |
| Dedicated Pooler (PgBouncer)                     | `db.[project-id].supabase.co`      | 6543     | `postgres`              | IPv6 · 유료 전용               | 미지원        |

**이 프로젝트가 쓰는 것은 둘이다.**

| 쓰임                                                         | 고를 것                                          | 왜                                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **애플리케이션 runtime** (Vercel) → `DATABASE_URL`           | **Shared Pooler (Supavisor) — Transaction mode** | Vercel 은 instance 가 늘었다 줄었다 한다. 직접 연결을 instance 마다 잡으면 Postgres 의 연결 상한에 금방 닿는다 |
| **Migration** (`pnpm db:migrate`) → `MIGRATION_DATABASE_URL` | **Shared Pooler (Supavisor) — Session mode**     | DDL 은 세션이 유지돼야 한다. 그리고 **GitHub Actions 러너는 IPv4 전용**이다                                    |

🔴 **Migration 에 Direct connection 을 쓰지 마라.** Direct 는 **IPv6** 이고 GitHub Actions
러너는 IPv4 전용이라 **연결 자체가 되지 않는다**(IPv4 add-on 은 유료다). 세션이 필요하다는
이유로 Direct 를 고르면 그 함정에 빠진다 — 필요한 것은 「Direct」가 아니라 **「Session mode」**다.

🔴 **Transaction mode 를 Migration 에 쓰지 마라.** DDL 이 세션 경계를 넘지 못한다.

**runtime 에 Transaction mode 를 써도 되는 근거**(이 저장소 코드로 확인했다):

- `.prepare(` 가 `src/` 에 **0건**이고 `pg` 는 `name` 을 주지 않으면 named prepared statement 를
  만들지 않는다 — Transaction mode 의 유일한 제약에 걸리지 않는다
- advisory lock 이 `pg_advisory_xact_lock` 이라(`repository-upsert.ts`) **transaction 범위**다.
  COMMIT 에서 풀리므로 pooler 가 연결을 돌려써도 새지 않는다. session 범위였다면 깨진다
- `LISTEN`/`NOTIFY`·`SET SESSION` 이 **0건**이다

### 🔴 SSL — `?sslmode=require` «만» 붙이면 연결이 실패한다

`pg-connection-string@2.14.0` 은 libpq 와 다르게 해석한다. 설치된 파서로 직접 돌려 확인한 값이다:

| URL 파라미터                              | `pg` 에 넘어가는 `ssl`          | 뜻                                                        |
| ----------------------------------------- | ------------------------------- | --------------------------------------------------------- |
| (없음)                                    | `undefined`                     | **TLS 를 아예 쓰지 않는다**                               |
| `?sslmode=require`                        | `{}`                            | TLS + **완전 검증**(Node 기본 `rejectUnauthorized: true`) |
| `?sslmode=verify-full`                    | `{}`                            | 위와 같다                                                 |
| `?uselibpqcompat=true&sslmode=require`    | `{ rejectUnauthorized: false }` | TLS 를 쓰되 **인증서를 검증하지 않는다**                  |
| `?sslmode=no-verify`                      | `{ rejectUnauthorized: false }` | 위와 같다                                                 |
| `?sslmode=verify-full&sslrootcert=<파일>` | `{ ca: "…" }`                   | **그 CA 로 완전 검증**                                    |

🔴 **그래서 `?sslmode=require` 로 Supabase 에 붙으면 이렇게 죽는다:**

```
code : SELF_SIGNED_CERT_IN_CHAIN
message: self-signed certificate in certificate chain
```

Supabase 의 인증서는 **자체 CA(`prod-ca-2021.crt`)로 서명돼 있어** Node 의 기본 신뢰 목록에 없다.
연결도 비밀번호도 SQL 도 문제가 아니다 — **검증에 쓸 CA 가 없는 것**이다.

**고르는 법 — 두 가지뿐이고 보안 수준이 다르다:**

1. **`?sslmode=verify-full&sslrootcert=<prod-ca-2021.crt 경로>` — 권장.**
   Supabase 대시보드(**Project Settings → Database → SSL Configuration**)에서 CA 를 내려받아
   저장소에 둔다. 🔴 **그 파일은 비밀이 아니다** — 공개 인증서라 커밋해도 된다.
   경로는 프로세스의 **cwd 기준 상대 경로**로도 읽힌다(확인했다)
2. `?uselibpqcompat=true&sslmode=require` — **검증을 끄는 것과 같다.**
   위 표대로 `rejectUnauthorized: false` 로 풀린다. 「libpq 호환」이라는 이름 때문에
   더 안전해 보이지만 **암호화만 하고 상대가 누구인지 확인하지 않는다.**
   🔴 1번을 쓸 수 없을 때의 임시 수단으로만 쓴다

🔴 **`ssl` 옵션을 코드에 박지 않는다.** `src/db/index.ts` 는 `new Pool({ connectionString })`,
`drizzle.config.ts` 는 `dbCredentials: { url }` 뿐이라 **URL 이 유일한 정본**이다(전수 확인:
저장소에 `ssl:` 를 주는 코드가 0곳). 코드에 박으면 로컬 Docker 연결까지 함께 바뀐다.

### 🔴 연결 고갈 — 확인된 위험이다

`src/db/index.ts` 는 `new Pool({ connectionString })` 로 만들고 **`max` 를 정하지 않는다.**
`pg-pool` 의 기본값은 **10** 이다(`node_modules` 에서 확인). Vercel instance 하나마다 최대 10개를
잡으므로, instance 가 늘면 pooler 쪽 상한에 먼저 닿는다.

**아직 고치지 않았다.** 고치는 방법은 둘이고, 어느 쪽이든 값을 정하는 것은 운영 판단이다:

1. `Pool` 에 `max` 를 낮게(1~3) 준다 — Vercel 에서는 한 instance 가 동시에 여러 요청을 받지 않는다
2. Supabase pooler 의 상한을 올린다

지금 값(10)으로도 **소규모에서는 문제가 나지 않는다.** 실제로 `too many connections` 를 보면
1번을 먼저 한다 — 근거 없이 Index 를 더하지 않는 것과 같은 기준이다.

---

## 3. Migration 전략

**사람이 누른다.** `.github/workflows/migrate-production.yml` 의 `workflow_dispatch` 다.

```
1) Migrate workflow 실행 (confirm 에 "migrate" 입력)
2) 초록 확인
3) merge/push -> Vercel 이 배포
```

🔴 **이 순서를 바꾸지 마라.** 배포가 먼저 나가면 새 코드가 아직 없는 Column 을 읽는다.
Vercel 은 push 에 자동 배포하므로, **Migration 을 먼저 눌러 두는 것 말고는 순서를 강제할 방법이
없다.** 그래서 workflow 는 세 가지를 스스로 지킨다:

- `confirm` 에 `migrate` 를 정확히 적지 않으면 첫 step 에서 멈춘다
- `if: github.ref == 'refs/heads/main'` — production Secret 으로 도는 코드는 보호된 `main` 뿐이다
- 🔴 **`db:migrate` 가 깨져도 job 이 그 자리에서 끝나지 않는다.** `continue-on-error: true` 로
  다음 step(`diagnose-db-connection.mjs`)이 돌 기회를 주고, 마지막 step 이 `steps.migrate.outcome`
  을 보고 **실패를 다시 세운다** — 진단 로그를 얻으면서 결과는 빨갛게 남는다.
  `drizzle-kit` 이 실패 이유를 삼켜 「비밀번호가 틀렸다」와 「SQL 이 깨졌다」가 **같은 출력**이라
  이 장치가 필요하다

**어디서 깨지는지 먼저 보고 싶으면** `.github/workflows/diagnose-migration.yml` 을 누른다.
`BEGIN … ROLLBACK` 안에서 재생만 하고 Migration 이력은 읽기만 해서 **Database 를 바꾸지 않는다** —
그래서 확인 입력도 요구하지 않는다. 🔴 **그것이 실제 적용을 대신하지는 않는다.**

🔴 **왜 자동이 아닌가**

- **애플리케이션 요청 중에 돌리지 않는다.** 첫 요청이 스키마를 바꾸는 구조는 실패가 사용자에게 그대로 드러난다
- **배포마다 startup 에서 돌리지 않는다.** Vercel 은 instance 를 여럿 띄우므로 **같은 Migration 이 동시에 시작**한다
- Vercel 은 push 에 자동 배포하므로 「CI 성공 후 배포」로 순서를 강제할 수 없다. 그래서 **Migration 을 먼저 눌러 두는 쪽**을 택했다

🔴 **순서가 어긋나도 견디게 쓴다.** 더하는 변경(새 Column·표)을 먼저 배포하고, 지우는 변경은
옛 코드가 완전히 빠진 뒤에 적용한다 — `0002` → `0003` 을 나눈 것이 그 예다.

### 🔴 Column 을 더할 때는 commit 을 «둘로» 나눈다

「더하는 변경이니 먼저 배포해도 된다」가 **Drizzle Schema 에는 통하지 않는다.**
`db.insert(table).values(...)` 는 값을 주지 않은 Column 까지 **전부 나열한다** — 그래서
`schema/*.ts` 에 Column 을 더한 코드가 Migration 보다 먼저 배포되면, 그 표에 쓰는 모든
요청이 `42703 column ... does not exist` 로 죽는다.

🔴 **추측이 아니다.** `0015`(`issue_activities.ordinal`) 를 넣을 때 Column 이 없는 `0014`
모양의 Database 에 새 코드를 물려 통합시험을 돌렸고, Activity 를 쓰는 시험 20여 건이
실제로 `42703` 으로 실패했다. `SELECT` 는 우리 코드가 Column 을 일일이 적어서 무사하지만
`INSERT` 는 그렇지 않다.

그래서 Column 추가는 **한 commit 이 아니라 세 걸음**이다.

```
1) migration 산출물만 담은 commit 을 main 에 push
     -> Vercel 이 배포한다. 애플리케이션 코드가 그대로라 아무것도 깨지지 않는다
2) 사람이 migrate-production 을 누른다
     -> Column 이 실제로 생긴다
3) schema/*.ts 변경과 그것을 쓰는 코드를 push
```

🔴 **1번을 건너뛸 수 없다.** `migrate-production.yml` 은 `main` 에서만 돌아서,
Migration 파일이 이미 `main` 에 있어야 적용할 것을 찾는다 — 「Migration 을 먼저 누른다」는
위 3단계 순서는 **파일이 이미 올라가 있는 경우**의 이야기다.

새 Column 을 **`NOT NULL` 로 잠그지 않는다.** 1번과 3번 사이에 들어오는 행은 그 칸을 비운
채 저장되고, `NOT NULL` 이면 그 창에서 모든 쓰기가 실패한다. 좁히는 것은 채우는 코드가
배포되고 남은 `NULL` 을 정리한 뒤다.

🔴 **`0006` 을 아직 적용하지 않은 Database 는 그냥 통과하지 못한다.** 아래
「0006 복구 절차」를 먼저 읽어라 — 살아 있는 초대가 중복된 배포에서 `23505` 로 멈춘다.

---

## 4. Vercel 설정

- **Framework**: Next.js (자동 인식). Build `pnpm build`, Install `pnpm install --frozen-lockfile`
- **`output` 설정을 넣지 않는다.** `next.config.ts` 에 `standalone` 을 넣는 것은 컨테이너 배포용이고,
  Vercel 에서는 오히려 방해가 된다
- **Node**: 로컬과 같은 **24** 를 고른다
- `next.config.ts` 의 보안 헤더(CSP `frame-ancestors 'none'` · HSTS · `X-Content-Type-Options` 등)는
  이미 서 있다 — Vercel 에서 따로 할 일이 없다

---

## 5. 지금 실제로 서 있는 것 (2026-09-02 확인)

🔴 **여기는 「준비했다」가 아니라 「확인했다」만 적는다.**

| | 상태 |
| --- | --- |
| **Vercel 배포** | **살아 있다.** `https://reviewtrace.app` 이 `200` 을 돌려준다 |
| **운영 Migration** | **돌았다.** 운영 Database 는 **`0012` 까지** 적용돼 있다 — `diagnose-migration.yml` 로 확인 |
| **`npm publish`** | **했다.** `reviewtrace-mcp` 가 registry 에 있고 `latest` 는 **`0.2.0`** 이다(`0.1.0` 도 남아 있다) |

🔴 **저장소의 Migration 은 `0014` 까지 있다.** 즉 **`0013`·`0014` 가 아직 운영에 적용되지
않았다** — `0013` 은 `issue_code_evidences.source_state`(+ `evidence_source_state` enum),
`0014` 는 `issue_activities_reviewed_again_idx` 다. 새 코드를 배포하기 전에
**3장 순서대로 Migrate workflow 를 먼저 누른다.**

### 아직 하지 않은 것

- **운영 환경 smoke** — 배포된 화면과 Agent API 를 운영 주소로 눌러 확인하지 않았다.
  확인한 것은 `200` 응답과 Migration 이력까지다
- **Dockerfile** — Vercel 배포라 필요 없다. `docker-compose.yml` 은 **로컬 PostgreSQL 전용**이고 그대로 둔다
- **Supabase SDK** — PostgreSQL 만 쓰므로 넣지 않는다
- **연결 고갈 대응** — 위 「연결 고갈」 절 그대로다. `Pool` 의 `max` 는 아직 기본값(10)이다
