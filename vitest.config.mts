import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * 규모에 맞는 최소 구성.
 *
 * 대부분의 시험이 지키는 것은 **Schema·계약** 이다 — 외부 입력 해석, 오류 표현, Action 결과 형태.
 *
 * 실제 Database 가 필요한 시험(`*.integration.test.ts`)은 **기본 실행에서 건너뛴다.**
 * Tenant 격리와 가입 흐름은 제약·Transaction 이 지키는 것이라 Fake 로는 증명되지 않아
 * 따로 두었다 — 실행 방법은 그 파일 머리에 적혀 있다.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      /**
       * `server-only` 는 import 되는 것만으로 예외를 던지는 표식 패키지다.
       * Next.js 는 Server Component 조건에서 빈 모듈로 바꿔치기하지만 vitest 에는 그 조건이
       * 없다. 서버 전용 모듈을 시험하려면 같은 자리를 빈 모듈로 채워야 한다.
       */
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
});
