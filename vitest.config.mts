import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * 규모에 맞는 최소 구성.
 *
 * 지금 테스트가 지키는 것은 **Schema·계약** 이다 — 외부 입력 해석, 오류 표현, Action 결과 형태.
 * 실제 Database·Browser 가 필요한 검증은 여기 두지 않는다. 필요가 생기면 그때 늘린다.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
