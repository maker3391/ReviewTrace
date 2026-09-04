import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * 🔴 **두 단으로 갈리는 자리를 `lg`(1024) 에 두면 «창을 넓혔는데 본문이 좁아진다».**
 *
 * 사이드바(256px)와 여백을 빼고 나면 1024px 창의 content 영역은 705px 뿐이다. 거기서
 * 다시 둘로 나누면 한 단이 341~365px 이 되는데, 한 단으로 서는 900px 창에서는 579px 다.
 *
 * ```
 * 창          1280  1152  1024 | 900
 * Issue 본문   605   493   365 | 581   <- lg 였을 때
 * Dashboard    461   405   341 | 579
 * ```
 *
 * 실측으로 그 폭에서 Decision Record 본문이 102px 넘쳐 잘리고 Pattern Key 5건이
 * 잘려 나갔다. 갈리는 시점을 `xl`(1280) 로 늦추면 두 목록 모두 회복된다.
 *
 * 🔴 **이 시험은 «폭»을 재지 못한다.** vitest 는 node 환경이라 layout 이 없다 —
 * 여기서 붙드는 것은 **어느 breakpoint 에서 갈리는가**이고, 실제 폭은 브라우저로 잰다.
 */
describe("상세·Dashboard 가 두 단으로 갈리는 폭", () => {
  const sources = {
    "Issue 상세": "src/features/issues/components/IssueDetailScreen.tsx",
    "Workspace Dashboard":
      "src/features/dashboard/components/WorkspaceDashboardScreen.tsx",
  } as const;

  it("🔴 `lg` 가 아니라 `xl` 에서 갈린다", () => {
    for (const [name, path] of Object.entries(sources)) {
      const source = readFileSync(path, "utf8");
      const gridClasses = [...source.matchAll(/\b(\w+):grid-cols-[^\s"]+/gu)].map(
        (match) => match[1],
      );

      expect(gridClasses, name).not.toHaveLength(0);
      // 🔴 `lg` 로 되돌리면 1024 에서 한 단이 900 보다 좁아진다.
      expect(gridClasses, name).not.toContain("lg");
      expect(gridClasses, name).toContain("xl");
    }
  });
});

/**
 * 🔴 **Pattern Key 는 그 행의 «정체»다 — 좁다고 잘라 내면 행이 무엇인지 사라진다.**
 *
 * 넓은 화면의 한 줄 밀도는 이 목록의 값이므로 `sm` 부터는 그대로 자르고, 좁은 폭에서만
 * 접는다. `_` 로 이어진 식별자라 어디서 끊겨도 읽힌다.
 */
describe("반복 패턴의 Pattern Key", () => {
  const source = readFileSync(
    "src/features/dashboard/components/WorkspaceDashboardScreen.tsx",
    "utf8",
  );
  /** Pattern Key 를 그리는 `<p>` 의 className 줄. JSX 라 tag 와 다른 줄에 있다. */
  const line =
    source
      .split("\n")
      .map((text) => text.trim())
      .find(
        (text) =>
          text.startsWith("className=") &&
          text.includes("font-mono") &&
          text.includes("wrap-anywhere"),
      ) ?? "";

  it("좁은 폭에서는 접고 `sm` 부터 한 줄로 자른다", () => {
    expect(line).not.toBe("");
    expect(line).toContain("wrap-anywhere");
    expect(line).toContain("sm:truncate");
    // 🔴 조건 없는 `truncate` 가 돌아오면 좁은 폭에서 다시 잘린다.
    expect(line).not.toMatch(/(^|\s)truncate(\s|"|$)/u);
  });

  it("잘릴 때를 대비해 전체 이름을 title 로 남긴다", () => {
    expect(source).toContain("title={pattern.patternKey}");
  });
});
