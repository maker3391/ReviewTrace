import { describe, expect, it } from "vitest";

import { formatMigrationFailure } from "./migration-diagnostic-output.mjs";

describe("production migration diagnostic output", () => {
  it("원본 DB 값과 SQL을 버리고 실패 위치와 안전한 분류만 남긴다", () => {
    const output = formatMigrationFailure({
      tag: "0010_add_unique_email",
      index: 2,
      total: 4,
      statement:
        "CREATE UNIQUE INDEX users_email_key ON users(email) WHERE email = 'secret@example.com'",
      error: {
        code: "23505",
        message:
          "duplicate key value violates unique constraint users_email_key",
        detail: "Key (email)=(secret@example.com) already exists.",
        hint: "credential=postgres://admin:password@example.test/db",
      },
    }).join("\n");

    expect(output).toContain("0010_add_unique_email");
    expect(output).toContain("2/4");
    expect(output).toContain("23505");
    expect(output).toContain("integrity_constraint_violation");
    expect(output).toContain("CREATE UNIQUE INDEX");
    expect(output).not.toContain("secret@example.com");
    expect(output).not.toContain("password");
    expect(output).not.toContain("users_email_key");
    expect(output).not.toContain("duplicate key");
  });

  it("비정상 code와 알 수 없는 SQL도 원문 없이 일반 분류로 좁힌다", () => {
    const output = formatMigrationFailure({
      tag: "0011_custom",
      index: 1,
      total: 1,
      statement: "SELECT 'private-row-value'",
      error: { code: "not-a-sqlstate", message: "private-row-value" },
    }).join("\n");

    expect(output).toContain("UNKNOWN");
    expect(output).toContain("postgres_error");
    expect(output).toContain("OTHER");
    expect(output).not.toContain("private-row-value");
  });
});
