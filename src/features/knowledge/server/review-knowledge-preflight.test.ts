import { describe, expect, it } from "vitest";

import { rankKnowledgeCandidates } from "@/features/knowledge/server/review-knowledge-preflight";

const NOW = new Date("2026-09-02T00:00:00.000Z");

function candidate(
  overrides: Partial<Parameters<typeof rankKnowledgeCandidates>[0][number]> = {},
): Parameters<typeof rankKnowledgeCandidates>[0][number] {
  return {
    issueId: "00000000-0000-4000-8000-000000000001",
    title: "Candidate",
    status: "RESOLVED",
    severity: "MEDIUM",
    category: "RELIABILITY",
    patternKey: "REPOSITORY_CONTEXT",
    filePath: "src/features/repositories/context.ts",
    repositoryFullName: "acme/app",
    resolutionSummary: "Repository scope를 고정했다.",
    encounters: 1,
    lastEncounterAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("rankKnowledgeCandidates", () => {
  it("same file, same directory, status, severity, recurrence 순서가 결정론적이다", () => {
    const rows = [
      candidate({
        issueId: "00000000-0000-4000-8000-000000000003",
        filePath: "src/other.ts",
        status: "OPEN",
        severity: "CRITICAL",
      }),
      candidate({
        issueId: "00000000-0000-4000-8000-000000000002",
        filePath: "src/features/repositories/other.ts",
        status: "OPEN",
      }),
      candidate({
        issueId: "00000000-0000-4000-8000-000000000001",
        filePath: "src/features/repositories/context.ts",
      }),
    ];

    const ranked = rankKnowledgeCandidates(
      rows,
      ["src/features/repositories/context.ts"],
      NOW,
    );

    expect(ranked.map((row) => row.issueId)).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
    ]);
    expect(ranked[0]?.relevanceReasons).toContain("SAME_FILE");
    expect(ranked[1]?.relevanceReasons).toContain("SAME_DIRECTORY");
  });

  it("반복·최근 재발·미해결·해결 precedent 이유를 설명한다", () => {
    const ranked = rankKnowledgeCandidates(
      [
        candidate({
          issueId: "open",
          status: "REOPENED",
          severity: "HIGH",
          encounters: 3,
          lastEncounterAt: new Date("2026-09-01T00:00:00.000Z"),
          resolutionSummary: null,
        }),
        candidate({ issueId: "resolved" }),
      ],
      [],
      NOW,
    );

    expect(ranked[0]?.relevanceReasons).toEqual([
      "REPEATED_PATTERN",
      "HIGH_SEVERITY",
      "RECENTLY_RECURRED",
      "UNRESOLVED",
    ]);
    expect(ranked[1]?.relevanceReasons).toContain("RESOLVED_PRECEDENT");
  });

  /**
   * 🔴 prefix 문자열만 보면 `src/foo` 와 `src/foo2` 가 같은 directory 로 읽힌다.
   * 마지막 `/` 앞을 통째로 비교해야 그 착각이 생기지 않는다.
   */
  it("같은 prefix 를 가진 다른 directory 를 SAME_DIRECTORY 로 세지 않는다", () => {
    const ranked = rankKnowledgeCandidates(
      [
        candidate({ issueId: "sibling", filePath: "src/foo2/b.ts" }),
        candidate({ issueId: "nested", filePath: "src/foo/deep/c.ts" }),
        candidate({ issueId: "same", filePath: "src/foo/b.ts" }),
      ],
      ["src/foo/a.ts"],
      NOW,
    );

    const reasonsOf = (id: string) =>
      ranked.find((row) => row.issueId === id)?.relevanceReasons ?? [];
    expect(reasonsOf("same")).toContain("SAME_DIRECTORY");
    expect(reasonsOf("sibling")).not.toContain("SAME_DIRECTORY");
    // 하위 directory 는 같은 directory 가 아니다.
    expect(reasonsOf("nested")).not.toContain("SAME_DIRECTORY");
  });

  it("Windows 구분자와 ./ 접두를 같은 경로로 읽는다", () => {
    const ranked = rankKnowledgeCandidates(
      [candidate({ issueId: "win", filePath: "src\\auth\\token.ts" })],
      [".\\src\\auth\\token.ts"],
      NOW,
    );

    expect(ranked[0]?.relevanceReasons).toContain("SAME_FILE");
  });

  it("root 파일은 SAME_FILE 만 얻고 저장소 전체를 같은 directory 로 묶지 않는다", () => {
    const ranked = rankKnowledgeCandidates(
      [
        candidate({ issueId: "root-hit", filePath: "README.md" }),
        candidate({ issueId: "root-other", filePath: "package.json" }),
      ],
      ["README.md"],
      NOW,
    );

    const reasonsOf = (id: string) =>
      ranked.find((row) => row.issueId === id)?.relevanceReasons ?? [];
    expect(reasonsOf("root-hit")).toContain("SAME_FILE");
    expect(reasonsOf("root-other")).not.toContain("SAME_DIRECTORY");
  });

  /**
   * 🔴 절대 경로와 `..` 는 이 Repository 의 경로가 아니다. 그것으로 SAME_FILE 을 얻으면
   * 바꾸지도 않은 파일의 과거 Issue 가 후보 맨 앞에 선다.
   */
  it("절대 경로와 상위 경로 탈출은 파일 일치로 세지 않는다", () => {
    const ranked = rankKnowledgeCandidates(
      [
        candidate({ issueId: "absolute", filePath: "/etc/passwd" }),
        candidate({ issueId: "escape", filePath: "../secret/a.ts" }),
      ],
      ["/etc/passwd", "../secret/a.ts"],
      NOW,
    );

    for (const row of ranked) {
      expect(row.relevanceReasons).not.toContain("SAME_FILE");
      expect(row.relevanceReasons).not.toContain("SAME_DIRECTORY");
    }
  });

  it("모든 비교가 같으면 issueId 로 매번 같은 순서를 낸다", () => {
    const ids = ["c", "a", "b"].map(
      (suffix) => `00000000-0000-4000-8000-00000000000${suffix}`,
    );
    const rows = ids.map((issueId) => candidate({ issueId }));

    const first = rankKnowledgeCandidates(rows, [], NOW).map(
      (row) => row.issueId,
    );
    const second = rankKnowledgeCandidates([...rows].reverse(), [], NOW).map(
      (row) => row.issueId,
    );

    expect(first).toEqual([...ids].sort());
    expect(second).toEqual(first);
  });
});

