import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const WORKFLOWS = ["migrate-production.yml", "diagnose-migration.yml"];

describe.each(WORKFLOWS)("%s", (workflow) => {
  it("🔴 production Secret 을 main 의 정확한 Commit 에서만 사용한다", () => {
    const source = readFileSync(
      resolve(process.cwd(), ".github", "workflows", workflow),
      "utf8",
    );

    expect(source).toContain("permissions:\n  contents: read");
    expect(source).toContain("if: github.ref == 'refs/heads/main'");
    expect(source).toContain("ref: ${{ github.sha }}");
    expect(source).toContain("persist-credentials: false");
  });
});
