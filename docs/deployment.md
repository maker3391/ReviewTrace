# 배포 · 운영 구성

```
Vercel (Next.js)  ──►  Supabase PostgreSQL
      ▲                        ▲
      │                        │
  git push                 사람이 누르는
  (자동 배포)          Migrate workflow
```

**GitHub Actions 는 배포하지 않는다.** 검증(CI)과 사람이 누르는 Migration 두 가지만 맡는다.
Vercel 이 Git 연동으로 스스로 빌드·배포한다 — 두 곳에서 배포하면 같은 커밋을 두 번 빌드하고
배포 주체가 갈린다.

---

## 1. 환경 변수

정본은 `src/lib/env.schema.ts` 다. **이 표는 그 파일에서 옮겨 적은 것이고, 추측이 없다.**

| 변수 | 필수 | 기본값 | 무엇 |
|---|---|---|---|
| `DATABASE_URL` | **필수** | — | `postgres://` 또는 `postgresql://` 로 시작해야 한다 |
| `AUTH_SECRET` | **필수** | — | **32자 이상.** `openssl rand -base64 32` |
| `GITHUB_CLIENT_ID` | **필수** | — | GitHub OAuth App |
| `GITHUB_CLIENT_SECRET` | **필수** | — | GitHub OAuth App |
| `APP_URL` | 사실상 필수 | `http://localhost:3000` | 🔴 **운영에서 반드시 덮어쓴다.** Settings 화면이 Agent 에게 알려 주는 API 주소가 이 값이다 — 기본값이 남으면 사용자의 Agent 가 자기 컴퓨터를 가리킨다 |
| `GITHUB_API_TOKEN` | 선택 | 없음 | Code Evidence 를 GitHub 실제 코드와 대조할 때 쓴다. 없으면 그 확인만 못 한다 |
| `GITHUB_API_URL` | 선택 | `https://api.github.com` | GitHub Enterprise 를 쓸 때만 |
| `NODE_ENV` | 선택 | `development` | Vercel 이 알아서 `production` 을 넣는다 |

🔴 **`AUTH_URL` 은 넣지 않는다.** `src/lib/auth/config.ts` 가 `trustHost: true` 라 앞단이 넘긴
Host 로 콜백 URL 을 만든다. Vercel 은 그 Host 를 올바로 넘긴다.

🔴 **`NEXT_PUBLIC_*` 는 하나도 없다.** 위 값은 전부 서버 전용이라 브라우저로 나가지 않는다.

---

## 2. Supabase — 어떤 연결을 어디에 쓰나

Supabase 는 **PostgreSQL 호스팅으로만** 쓴다. Auth·Storage·Realtime 을 쓰지 않으므로
**`@supabase/supabase-js` 를 넣지 않는다.** 구조는 그대로다:

```
Application  ──►  Drizzle ORM  ──►  node-postgres(pg)  ──►  Supabase PostgreSQL
```

Supabase 는 주소를 여러 개 준다. **쓰임이 다르므로 섞지 않는다.**

| 쓰임 | 어떤 주소 | 왜 |
|---|---|---|
| **애플리케이션 runtime** (Vercel) | **Transaction pooler** (포트 `6543`) | Vercel 은 요청마다 새 instance 가 뜰 수 있다. 매 instance 가 직접 연결을 잡으면 Postgres 의 연결 상한을 금방 넘는다 |
| **Migration** (`pnpm db:migrate`) | **Direct** (포트 `5432`) 또는 **Session pooler** | DDL 은 세션이 유지돼야 한다. Transaction pooler 로 DDL 을 돌리지 마라 |

🔴 **SSL 은 URL 로 켠다** — `?sslmode=require` 를 붙인다. 코드를 고칠 필요가 없다:
`pg-connection-string@2.14.0` 이 연결 문자열의 `sslmode` 를 해석해 `pg` 에 넘긴다
(직접 열어 확인했다). 🔴 **`ssl` 옵션을 코드에 박지 않는다** — 그러면 로컬 Docker 연결까지 함께 바뀐다.

### 🔴 연결 고갈 — 확인된 위험이다

`src/db/index.ts` 는 `new Pool({ connectionString })` 로 만들고 **`max` 를 정하지 않는다.**
`pg-pool` 의 기본값은 **10** 이다(`node_modules` 에서 확인). Vercel instance 하나마다 최대 10개를
잡으므로, instance 가 늘면 pooler 쪽 상한에 먼저 닿는다.

**아직 고치지 않았다.** 고치는 방법은 둘이고, 어느 쪽이든 값을 정하는 것은 운영 판단이다:

1. `Pool` 에 `max` 를 낮게(1~3) 준다 — Vercel 에서는 한 instance 가 동시에 여러 요청을 받지 않는다
2. Supabase pooler 의 상한을 올린다

지금 값(10)으로도 **소규모에서는 문제가 나지 않는다.** 실제로 `too many connections` 를 보면
1번을 먼저 한다 — 근거 없이 Index 를 더하지 않는 것과 같은 기준이다(CLAUDE.md 10).

---

## 3. Migration 전략

**사람이 누른다.** `.github/workflows/migrate-production.yml` 의 `workflow_dispatch` 다.

```
1) Migrate workflow 실행 (confirm 에 "migrate" 입력)
2) 초록 확인
3) merge/push  ->  Vercel 이 배포
```

🔴 **왜 자동이 아닌가**

- **애플리케이션 요청 중에 돌리지 않는다.** 첫 요청이 스키마를 바꾸는 구조는 실패가 사용자에게 그대로 드러난다
- **배포마다 startup 에서 돌리지 않는다.** Vercel 은 instance 를 여럿 띄우므로 **같은 Migration 이 동시에 시작**한다
- Vercel 은 push 에 자동 배포하므로 「CI 성공 후 배포」로 순서를 강제할 수 없다. 그래서 **Migration 을 먼저 눌러 두는 쪽**을 택했다

🔴 **순서가 어긋나도 견디게 쓴다.** 더하는 변경(새 Column·표)을 먼저 배포하고, 지우는 변경은
옛 코드가 완전히 빠진 뒤에 적용한다 — `0002` → `0003` 을 나눈 것이 그 예다(CLAUDE.md 0장).

🔴 **`0006` 을 아직 적용하지 않은 Database 는 그냥 통과하지 못한다.** CLAUDE.md 0장의
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
