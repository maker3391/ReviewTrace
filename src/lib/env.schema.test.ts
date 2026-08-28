import { describe, expect, it } from "vitest";

import { serverEnvSchema } from "@/lib/env.schema";

describe("serverEnvSchema", () => {
  it("DATABASE_URL 이 없으면 실패한다", () => {
    const result = serverEnvSchema.safeParse({});

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toContain(
      "DATABASE_URL",
    );
  });

  it("postgres 가 아닌 접속 문자열을 거부한다", () => {
    const result = serverEnvSchema.safeParse({
      DATABASE_URL: "mysql://localhost:3306/x",
    });

    expect(result.success).toBe(false);
  });

  it("APP_URL 을 비우면 기본값으로 채운다", () => {
    const result = serverEnvSchema.safeParse({
      DATABASE_URL: "postgresql://user:pw@localhost:5432/code_intelligence",
    });

    expect(result.success).toBe(true);
    expect(result.data?.APP_URL).toBe("http://localhost:3000");
    expect(result.data?.NODE_ENV).toBe("development");
  });

  it("APP_URL 이 절대 URL 이 아니면 거부한다", () => {
    const result = serverEnvSchema.safeParse({
      DATABASE_URL: "postgresql://user:pw@localhost:5432/code_intelligence",
      APP_URL: "/dashboard",
    });

    expect(result.success).toBe(false);
  });
});
