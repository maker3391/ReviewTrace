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

| 변수                   | 필수        | 기본값                   | 무엇                                                                                                                                                                               |
| ---------------------- | ----------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | **필수**    | —                        | `postgres://` 또는 `postgresql://` 로 시작해야 한다                                                                                                                                |
| `AUTH_SECRET`          | **필수**    | —                        | **32자 이상.** `openssl rand -base64 32`                                                                                                                                           |
| `GITHUB_CLIENT_ID`     | **필수**    | —                        | GitHub OAuth App                                                                                                                                                                   |
| `GITHUB_CLIENT_SECRET` | **필수**    | —                        | GitHub OAuth App                                                                                                                                                                   |
| `APP_URL`              | 사실상 필수 | `http://localhost:3000`  | 운영은 **`https://reviewtrace.app`**. 🔴 **반드시 덮어쓴다** — Settings 화면이 Agent 에게 알려 주는 API 주소가 이 값이라, 기본값이 남으면 사용자의 Agent 가 자기 컴퓨터를 가리킨다 |
| `GITHUB_API_TOKEN`     | 선택        | 없음                     | Code Evidence 를 GitHub 실제 코드와 대조할 때 쓴다. 없으면 그 확인만 못 한다                                                                                                       |
| `GITHUB_API_URL`       | 선택        | `https://api.github.com` | GitHub Enterprise 를 쓸 때만                                                                                                                                                       |
| `NODE_ENV`             | 선택        | `development`            | Vercel 이 알아서 `production` 을 넣는다                                                                                                                                            |

🔴 **`AUTH_URL` 은 넣지 않는다.** `src/lib/auth/config.ts` 가 `trustHost: true` 라 앞단이 넘긴
Host 로 콜백 URL 을 만든다. Vercel 은 그 Host 를 올바로 넘긴다.

🔴 **`NEXT_PUBLIC_*` 는 하나도 없다.** 위 값은 전부 서버 전용이라 브라우저로 나가지 않는다.

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

🔴 **왜 자동이 아닌가**

- **애플리케이션 요청 중에 돌리지 않는다.** 첫 요청이 스키마를 바꾸는 구조는 실패가 사용자에게 그대로 드러난다
- **배포마다 startup 에서 돌리지 않는다.** Vercel 은 instance 를 여럿 띄우므로 **같은 Migration 이 동시에 시작**한다
- Vercel 은 push 에 자동 배포하므로 「CI 성공 후 배포」로 순서를 강제할 수 없다. 그래서 **Migration 을 먼저 눌러 두는 쪽**을 택했다

🔴 **순서가 어긋나도 견디게 쓴다.** 더하는 변경(새 Column·표)을 먼저 배포하고, 지우는 변경은
옛 코드가 완전히 빠진 뒤에 적용한다 — `0002` → `0003` 을 나눈 것이 그 예다.

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

## 5. 하지 않은 것

- **실제 배포 · `npm publish` · 운영 Migration 실행** — 준비까지만 했다
- **Dockerfile** — Vercel 배포라 필요 없다. `docker-compose.yml` 은 **로컬 PostgreSQL 전용**이고 그대로 둔다
- **Supabase SDK** — PostgreSQL 만 쓰므로 넣지 않는다
