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

function render(
  overrides: {
    repositories?: { id: string; fullName: string }[];
    repositoryId?: string;
  } = {},
): string {
  return renderToStaticMarkup(
    createElement(IssueFilterBar, {
      basePath: "/w/acme/p/smil/issues" as never,
      filter: {
        q: "",
        repositoryId: overrides.repositoryId ?? "ALL",
        severity: "ALL",
        category: "ALL",
        status: "ALL",
        page: 1,
        pageSize: 25,
      } as never,
      repositories: overrides.repositories ?? [
        { id: "repo-1", fullName: "acme/smil-be" },
      ],
      labels,
    }),
  );
}

/**
 * 🔴 **선택된 값이 «길 때»가 이 배치의 시험대다.**
 *
 * `w-fit` 은 내용만큼 넓어지므로, 고른 저장소 이름이 길면 묶음이 부모를 밀어 화면이
 * 가로로 스크롤할 수 있다. 폭을 잡는 것은 두 겹이다 — 묶음의 `max-w-full` 과 Trigger
 * 자신의 고정 폭(`sm:w-56`) + `line-clamp-1`.
 */
const LONG_REPOSITORY = `acme/${"very-long-repository-name-".repeat(4)}end`;

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
    /*
 🔴 **있어야 할 것만 보면 «무효로 만드는 것»을 놓친다.** `w-full` 은 `w-fit` 을 덮어
 묶음이 늘 부모 폭이 되게 하고, `mx-0` 는 `mx-auto` 를 지운다 — 둘 중 하나만 들어와도
 가운데 배치가 조용히 꺼지는데 위의 `toContain` 들은 그대로 통과한다.
    */
    const tokens = groupClass.split(" ");
    expect(tokens).not.toContain("w-full");
    expect(tokens.some((token) => /^mx-\d/.test(token))).toBe(false);

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
    /*
 🔴 **`true|false` 를 허용하면 «늘 도는 중»도 통과한다.** 갓 그린 화면은 아직 아무것도
 조회하지 않았으므로 정확히 `false` 다 — 그러지 않으면 낭독기가 계속 「바쁨」을 읽는다.
    */
    expect(markup).toContain('aria-busy="false"');
    expect(markup).not.toContain('aria-busy="true"');
    // 저장소 Select 는 이름표를 갖는다 — 그러지 않으면 「콤보 상자」로만 읽힌다.
    expect(markup).toContain(`aria-label="${labels.repository}"`);
  });
});

/**
 * 🔴 **긴 이름이 묶음을 밀지 못하게 하는 것은 «두 겹»이다.**
 *
 * 묶음의 `max-w-full` 이 부모를 상한으로 삼고, 저장소 Trigger 자신이 `sm:w-56` 으로
 * 서서 넓은 화면에서도 자라지 않으며, 넘치는 글자는 `line-clamp-1` 로 그 안에서 잘린다.
 *
 * 🔴 **여기서 «고른 이름»을 그려 확인할 수는 없다.** Radix Select 는 정적 렌더에서
 * 선택된 값의 글자를 내지 않는다(hydration 뒤에 채운다) — 그래서 이 시험이 붙드는 것은
 * **폭을 잡는 장치가 제자리에 있는가**까지다. 실제로 밀리는지는 브라우저로 잰다.
 */
describe("긴 저장소 이름을 담을 자리", () => {
  it("폭을 잡는 세 장치가 함께 서 있다", () => {
    const markup = render({
      repositories: [{ id: "repo-long", fullName: LONG_REPOSITORY }],
      repositoryId: "repo-long",
    });

    const groupClass =
      /^<form [^>]*>\s*<div class="([^"]*)">/.exec(markup)?.[1] ?? "";
    expect(groupClass).toContain("max-w-full");
    expect(markup).toContain("sm:w-56");
    expect(markup).toContain("line-clamp-1");
  });

  it("저장소 목록이 길어져도 다른 Filter 의 폭 규칙은 그대로다", () => {
    const markup = render({
      repositories: [
        { id: "repo-long", fullName: LONG_REPOSITORY },
        { id: "repo-2", fullName: "acme/second" },
      ],
    });

    // 심각도·분류·상태·검색은 데이터와 무관하게 같은 폭이다.
    for (const width of ["sm:w-64", "sm:w-56", "sm:w-52", "sm:w-40"]) {
      expect(markup, width).toContain(width);
    }
  });
});
