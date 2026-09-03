import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const { IssueFilterBar } = await import(
  "@/features/issues/components/IssueFilterBar"
);

const labels = {
  search: "검색",
  searchPlaceholder: "제목 · 파일 · 패턴",
  repository: "저장소",
  allRepository: "전체 저장소",
  severity: "심각도",
  category: "분류",
  status: "상태",
  allSeverity: "전체 심각도",
  allCategory: "전체 분류",
  allStatus: "전체 상태",
  severityOptions: {
    CRITICAL: "치명",
    HIGH: "높음",
    MEDIUM: "보통",
    LOW: "낮음",
    INFO: "정보",
  },
  categoryOptions: {
    ARCHITECTURE: "아키텍처",
    SECURITY: "보안",
    PERFORMANCE: "성능",
    DATABASE: "데이터베이스",
    TRANSACTION: "트랜잭션",
    CONCURRENCY: "동시성",
    API: "API",
    VALIDATION: "검증",
    EXCEPTION_HANDLING: "예외 처리",
    TESTING: "테스트",
    CLEAN_CODE: "코드 품질",
    RELIABILITY: "안정성",
  },
  statusOptions: {
    OPEN: "미해결",
    IN_PROGRESS: "진행 중",
    RESOLVED: "해결됨",
    IGNORED: "무시",
    FALSE_POSITIVE: "오탐",
    REOPENED: "재발",
  },
  submit: "조회",
  submitting: "조회 중",
  reset: "초기화",
} as const;

function render(): string {
  return renderToStaticMarkup(
    createElement(IssueFilterBar, {
      basePath: "/w/acme/p/smil/issues" as never,
      filter: {
        q: "",
        repositoryId: "ALL",
        severity: "ALL",
        category: "ALL",
        status: "ALL",
        page: 1,
        pageSize: 25,
      } as never,
      repositories: [{ id: "repo-1", fullName: "acme/smil-be" }],
      labels,
    }),
  );
}

describe("IssueFilterBar toolbar layout", () => {
  it("검색부터 초기화까지를 «한 덩어리»로 감싸 그 묶음만 가운데 세운다", () => {
    const markup = render();

    // form 은 테두리와 여백만 갖고, 도구를 늘어놓는 flex 줄은 그 안의 묶음이다.
    const shell = /^<form [^>]*class="([^"]*)"[^>]*>/.exec(markup);
    expect(shell).not.toBeNull();
    expect(shell?.[1]).toContain("border-b");
    expect(shell?.[1]).not.toContain("flex");

    const group = /^<form [^>]*>\s*<div class="([^"]*)">/.exec(markup);
    expect(group).not.toBeNull();
    const groupClass = group?.[1] ?? "";
    // 남는 자리를 좌우로 나누는 것은 `mx-auto` 이고, 그것이 실제로 일하려면
    // 묶음의 폭이 내용만큼이어야 한다(`w-fit`).
    expect(groupClass).toContain("mx-auto");
    expect(groupClass).toContain("w-fit");
    /*
 🔴 **`max-w-full` 이 `w-fit` 을 안전하게 만든다.** `w-fit` 은 «내용만큼» 넓어지므로,
 상한이 없으면 저장소 이름처럼 긴 내용이 들어왔을 때 묶음이 부모보다 넓어져 화면이
 가로로 스크롤한다. 좁아지는 쪽은 이 한 줄이 잡는다.
    */
    expect(groupClass).toContain("max-w-full");
    expect(groupClass).toContain("flex-wrap");
    expect(groupClass).toContain("items-end");
    // 도구 사이 간격은 form 이 아니라 이 묶음이 갖는다 — 옮기면서 잃지 않았다.
    expect(groupClass).toContain("gap-3");

    // 그 묶음이 form 의 유일한 자식이다 — 도구 중 일부만 가운데로 가지 않는다.
    expect(markup.endsWith("</div></form>")).toBe(true);
  });

  it("Filter 하나하나를 따로 가운데 정렬하지 않는다", () => {
    const markup = render();

    // `mx-auto` 는 묶음 하나에만 있다. 개별 control 에 붙으면 각자 가운데로 흩어진다.
    expect(markup.match(/mx-auto/g)).toHaveLength(1);

    /*
 🔴 묶음을 `justify-*` 로 세우지 않는다. 그러면 좁은 화면에서 «접힌 줄들까지» 가운데로
 모여, 지금 왼쪽으로 쌓이는 모양이 함께 바뀐다.
 */
    const groupClass = /^<form [^>]*>\s*<div class="([^"]*)">/.exec(markup)?.[1];
    expect(groupClass).toBeDefined();
    expect(groupClass).not.toMatch(/\bjustify-/);
  });

  it("control 의 순서와 폭 규칙을 바꾸지 않는다", () => {
    const markup = render();

    const order = [
      labels.search,
      labels.repository,
      labels.severity,
      labels.category,
      labels.status,
      labels.submit,
      labels.reset,
    ].map((text) => markup.indexOf(text));

    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));

    // 빈 자리를 채우려고 폭을 늘리거나 서로 같게 맞추지 않는다.
    expect(markup).toContain("sm:w-64");
    expect(markup).toContain("sm:w-56");
    expect(markup).toContain("sm:w-52");
    expect(markup).toContain("sm:w-40");
  });

  it("조회는 주 동작, 초기화는 보조 동작으로 남는다", () => {
    const markup = render();

    const buttons = markup
      .split("<button")
      .map((chunk) => `<button${chunk}`)
      .filter((chunk) => chunk.includes('data-slot="button"'));

    const submit = buttons.find((chunk) => chunk.includes('type="submit"'));
    expect(submit).toContain('data-variant="default"');
    expect(submit).toContain(labels.submit);

    const reset = buttons.find((chunk) => chunk.includes(labels.reset));
    expect(reset).toContain('data-variant="outline"');
    // 되돌릴 것이 없으면 누를 수 없다 — 보조 동작이 늘 서 있되 늘 눌리지는 않는다.
    expect(reset).toContain("disabled");
  });

  /**
   * 🔴 **묶음으로 감싸면서 접근성 속성을 잃지 않았다.**
   *
   * 이 변경은 배치만 바꿨다고 말하지만, 도구를 통째로 한 겹 안으로 옮기는 일이라
   * 옮기다 빠뜨린 것이 있으면 화면은 멀쩡해 보이고 낭독기만 잃는다.
   */
  it("검색 입력과 조회 버튼의 상태를 기계가 읽을 수 있다", () => {
    const markup = render();

    // 검색은 «지금 유효한지»를 늘 말한다 — 오류가 없을 때도 `false` 로 서 있다.
    expect(markup).toContain('aria-invalid="false"');
    // 조회는 «지금 도는 중인지»를 말한다. 정지 상태에서도 속성 자체는 남는다.
    expect(markup).toMatch(/aria-busy="(true|false)"/);
    // 저장소 Select 는 이름표를 갖는다 — 그러지 않으면 「콤보 상자」로만 읽힌다.
    expect(markup).toContain(`aria-label="${labels.repository}"`);
  });
});
