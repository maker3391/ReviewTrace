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
 * `pg` Driver 는 SQLSTATE 를 `code` 에 담아 던진다. 타입을 믿지 않고 형태만 본다 —
 * Driver 를 바꿔도 여기 한 곳만 보면 된다.
 */
const UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}
