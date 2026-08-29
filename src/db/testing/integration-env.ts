/**
 * 통합시험이 Database 설정을 얻는 자리.
 *
 * ## 무엇이 문제였는가
 *
 * 통합시험은 `process.loadEnvFile(".env")` 를 그냥 불렀다. Node 는 파일이 없으면
 * **`ENOENT` 를 그대로 던진다.** 그러면 CI 처럼 `DATABASE_URL` 이 이미 주입돼 있어
 * **돌 수 있는** 자리에서도 시험이 통째로 터지고, 화면에는 「제품 코드가 실패했다」와
 * 구분되지 않는 빨간불이 뜬다.
 *
 * ```
 * .env 있으면        -> 읽는다
 * .env 없어도        -> 환경 변수로 충분하면 그냥 돈다
 * DB 설정 자체 없음  -> «설정 오류»라고 분명히 말하고 실패한다
 * ```
 *
 * ## 🔴 삼키는 것은 «파일 없음» 하나뿐이다
 *
 * 나머지는 전부 그대로 올려보낸다. 잘못된 `DATABASE_URL`·접속 실패·Migration 실패는
 * **계속 실패해야 하는 진짜 통합 실패**다 — 그것까지 `try/catch` 로 덮으면
 * 「초록인데 아무것도 확인하지 않은」 시험이 된다.
 *
 * `.env` 는 local 편의일 뿐 필수 의존이 아니다. 그래서 파일이 없다는 사실 자체는
 * 실패가 아니고, **`DATABASE_URL` 이 끝내 없는 것**이 실패다.
 */

/** 파일이 없어서 난 오류인가. 그 외의 실패(권한·형식)는 삼키지 않는다. */
function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

/**
 * 통합시험이 쓸 Database 설정을 확보한다.
 *
 * @throws {Error} `.env` 에도 환경 변수에도 `DATABASE_URL` 이 없으면 — 설정 오류다.
 */
export function loadIntegrationDbEnv(): void {
  // 이미 주입돼 있으면 `.env` 로 덮지 않는다. CI 가 정한 값이 local 파일에 밀리지 않게.
  if (!hasDatabaseUrl()) {
    try {
      // drizzle.config.ts 와 같은 방식이다. 이것 하나 때문에 dotenv 를 더 넣지 않는다.
      process.loadEnvFile(".env");
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }
  }

  if (!hasDatabaseUrl()) {
    throw new Error(
      "DB_INTEGRATION=true 인데 DATABASE_URL 이 없다. " +
        ".env 에 적거나 환경 변수로 넣어라 (설정 오류이지 시험 실패가 아니다).",
    );
  }
}

function hasDatabaseUrl(): boolean {
  const value = process.env.DATABASE_URL;
  return typeof value === "string" && value !== "";
}
