import "server-only";

/**
 * PostgreSQL 의 unique 제약 위반(SQLSTATE `23505`)인가.
 *
 * 🔴 **「INSERT/UPDATE 가 실패했다」와 「그 slug 는 이미 쓰이고 있다」는 다른 말이다.**
 * 질의 Promise 전체에 `.catch` 를 걸어 무엇이 오든 `CONFLICT` 로 바꾸면, 접속 끊김 ·
 * statement timeout · `NOT NULL` 위반 · Pool 고갈까지 **「같은 이름이 이미 있습니다」로
 * 둔갑한다.** 사용자는 멀쩡한 이름을 계속 바꿔 가며 다시 시도하고 매번 같은 이유로
 * 실패하는데, 진짜 원인은 화면에도 로그에도 남지 않는다.
 *
 * 그래서 **`23505` 일 때만** 업무 오류로 바꾸고 나머지는 그대로 위로 올린다 —
 * 위에서 `INTERNAL_ERROR` 로 뭉개지되 원인은 서버 로그에 남는다(CLAUDE.md 19).
 *
 * ## 🔴 왜 `cause` 를 따라 내려가는가
 *
 * `pg` 는 SQLSTATE 를 `DatabaseError.code` 에 담는다(`pg-protocol` 의 `message.code = fields.C`).
 * **그런데 우리에게 그 오류가 그대로 오지 않는다** — Drizzle 이 질의 오류를 전부
 * `DrizzleQueryError` 로 감싸고 원본을 `cause` 에 넣는다
 * (`drizzle-orm/pg-core/session.js` 의 `queryWithCache`).
 *
 * 그래서 맨 바깥만 보면 `code` 가 `undefined` 라 **진짜 unique 위반조차 «아니다»로 판정된다.**
 * 그러면 정상 사용자가 이미 쓰이는 slug 를 넣었을 때 「같은 이름이 있습니다」 대신
 * **500 을 본다** — 무엇이든 `CONFLICT` 로 접던 예전보다 오히려 나쁜 과차단이다.
 *
 * 감싸는 겹은 라이브러리 사정이라 언제든 늘 수 있다. 그래서 **모양만 보고 `cause` 를
 * 따라 내려간다** — Driver 나 ORM 을 바꿔도 여기 한 곳만 보면 된다.
 *
 * 깊이에 상한을 두는 것은 `cause` 가 서로를 가리키는 경우에 멈추기 위해서다.
 */
const UNIQUE_VIOLATION = "23505";

/** `cause` 사슬을 따라갈 최대 깊이. 순환 참조에서 멈추기 위한 안전판이다. */
const MAX_CAUSE_DEPTH = 5;

export function isUniqueViolation(cause: unknown): boolean {
  let current = cause;

  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null) {
      return false;
    }

    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) {
      return true;
    }

    if (!("cause" in current)) {
      return false;
    }

    const next = (current as { cause?: unknown }).cause;
    if (next === current) {
      return false;
    }
    current = next;
  }

  return false;
}
