import { describe, expect, it } from "vitest";

import {
  authEnvSchema,
  githubAppEnvSchema,
  githubEnvSchema,
  serverEnvSchema,
} from "@/lib/env.schema";

/**
 * 환경 변수도 「외부 입력」이다.
 *
 * 🔴 이 시험이 지키는 것은 **「없으면 반쯤 도는 대신 아예 뜨지 않는다」** 이다.
 * 값이 빠진 채로 뜨면 배포 시점에 알아채지 못하고, 로그인이 조용히 꺼진 상태로 남는다.
 */

/** 형식만 맞춘 자리표시자. 🔴 실제 값을 시험에 적지 않는다. */
const VALID = {
  DATABASE_URL: "postgresql://user:pw@localhost:5432/code_intelligence",
};

const AUTH_VALID: Record<string, string | undefined> = {
  AUTH_SECRET: "x".repeat(32),
  GITHUB_CLIENT_ID: "client-id",
  GITHUB_CLIENT_SECRET: "client-secret",
};

describe("serverEnvSchema", () => {
  it("필수 값이 모두 있으면 통과한다", () => {
    const result = serverEnvSchema.safeParse(VALID);

    expect(result.success).toBe(true);
  });

  it("DATABASE_URL 이 없으면 실패한다", () => {
    const result = serverEnvSchema.safeParse({});

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toContain(
      "DATABASE_URL",
    );
  });

  it("postgres 가 아닌 접속 문자열을 거부한다", () => {
    const result = serverEnvSchema.safeParse({
      ...VALID,
      DATABASE_URL: "mysql://localhost:3306/x",
    });

    expect(result.success).toBe(false);
  });

  it("APP_URL 을 비우면 기본값으로 채운다", () => {
    const result = serverEnvSchema.safeParse(VALID);

    expect(result.success).toBe(true);
    expect(result.data?.APP_URL).toBe("http://localhost:3000");
    expect(result.data?.NODE_ENV).toBe("development");
  });

  it("APP_URL 이 절대 URL 이 아니면 거부한다", () => {
    const result = serverEnvSchema.safeParse({
      ...VALID,
      APP_URL: "/dashboard",
    });

    expect(result.success).toBe(false);
  });

  it("인증 값은 여기서 요구하지 않는다 — Database 만 쓰는 코드가 OAuth Secret 을 요구하면 안 된다", () => {
    expect(serverEnvSchema.safeParse(VALID).success).toBe(true);
  });
});

describe("githubAppEnvSchema", () => {
  const app = {
    GITHUB_APP_ID: "123456",
    GITHUB_APP_CLIENT_ID: "Iv1.test",
    GITHUB_APP_CLIENT_SECRET: "secret",
    GITHUB_APP_PRIVATE_KEY:
      "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
    GITHUB_APP_SLUG: "reviewtrace",
  };

  it("GitHub App credential은 한 벌이 모두 있어야 통과한다", () => {
    expect(githubAppEnvSchema.safeParse(app).success).toBe(true);
    for (const key of [
      "GITHUB_APP_ID",
      "GITHUB_APP_CLIENT_ID",
      "GITHUB_APP_CLIENT_SECRET",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_APP_SLUG",
    ] as const) {
      const missing = { ...app };
      delete missing[key];
      expect(githubAppEnvSchema.safeParse(missing).success, key).toBe(false);
    }
  });

  it("App ID와 slug를 임의 문자열로 받지 않는다", () => {
    expect(
      githubAppEnvSchema.safeParse({ ...app, GITHUB_APP_ID: "app-1" }).success,
    ).toBe(false);
    expect(
      githubAppEnvSchema.safeParse({ ...app, GITHUB_APP_SLUG: "Bad Slug" })
        .success,
    ).toBe(false);
  });
});

describe("authEnvSchema", () => {
  it("인증 값이 모두 있으면 통과한다", () => {
    expect(authEnvSchema.safeParse(AUTH_VALID).success).toBe(true);
  });

  it("GitHub OAuth 값이 없으면 실패한다 — 로그인이 조용히 꺼지지 않는다", () => {
    for (const key of ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"] as const) {
      const rest = { ...AUTH_VALID };
      delete rest[key];
      const result = authEnvSchema.safeParse(rest);

      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.path[0])).toContain(key);
    }
  });

  it("AUTH_SECRET 이 없거나 짧으면 거부한다 — 짧으면 세션을 위조할 수 있다", () => {
    expect(
      authEnvSchema.safeParse({ ...AUTH_VALID, AUTH_SECRET: undefined })
        .success,
    ).toBe(false);
    expect(
      authEnvSchema.safeParse({ ...AUTH_VALID, AUTH_SECRET: "short" }).success,
    ).toBe(false);
    expect(
      authEnvSchema.safeParse({ ...AUTH_VALID, AUTH_SECRET: "y".repeat(31) })
        .success,
    ).toBe(false);
  });
});

describe("githubEnvSchema credential URL", () => {
  it.each([
    ["https://api.github.com", "https://api.github.com"],
    ["https://github.example/api/v3/", "https://github.example/api/v3"],
    ["http://localhost:4000", "http://localhost:4000"],
    ["http://127.0.0.1:4000/api/v3", "http://127.0.0.1:4000/api/v3"],
    ["http://[::1]:4000", "http://[::1]:4000"],
  ])("GitHub Enterprise HTTPS와 loopback HTTP를 허용한다", (input, output) => {
    const result = githubEnvSchema.safeParse({ GITHUB_API_URL: input });

    expect(result.success).toBe(true);
    expect(result.data?.GITHUB_API_URL).toBe(output);
  });

  it.each([
    "http://github.example/api/v3",
    "ftp://github.example/api/v3",
    "https://user:pass@github.example/api/v3",
    "https://github.example/api/v3?token=value",
    "https://github.example/api/v3#fragment",
  ])(
    "credential이나 검증 결과를 안전하게 보낼 수 없는 URL을 거절한다",
    (value) => {
      expect(githubEnvSchema.safeParse({ GITHUB_API_URL: value }).success).toBe(
        false,
      );
    },
  );
});
