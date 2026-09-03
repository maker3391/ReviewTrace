import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * 🔴 **page 마다 문서 최상위 heading 이 «정확히 하나» 있어야 한다.**
 *
 * `<h1>` 을 내는 자리가 `PageHeader` 하나뿐이었고 그것을 쓰는 화면은 전부 상세라,
 * 목록 화면은 heading 이 0개이고 설정·멤버는 `<h2>` 부터 시작했다. 타입도 통과하고
 * 화면도 정상으로 보여서 **무너진 것이 DOM 계층뿐**이라 오래 남았다.
 *
 * ## 무엇을 붙드는가
 *
 * 화면 하나를 렌더링해 heading 배열을 읽는 것이 가장 정확하지만, 이 화면들은 세션과
 * Database 를 요구하는 async Server Component 라 시험 안에서 조립되지 않는다.
 * 그래서 **「`PageContainer` 로 page 를 세운 파일은 제목을 정확히 하나 낸다」** 를 본다.
 *
 * 🔴 **문자열 검사로는 부족했다.** `source.includes("<PageTitle")` 은 주석 속의 그것도
 * 세고, 「하나 이상 있다」와 「정확히 하나다」를 구분하지 못한다 — reviewer 가 주석으로만
 * 남은 제목 · `<h1>` 이 둘인 화면 · 제목을 잃은 delegate 를 모두 통과시켜 보였다.
 * 그래서 **JSX opening element 를 AST 로 센다.** `typescript` 는 이미 devDependency 다.
 *
 * 🔴 **목록을 손으로 적지 않는다.** `src` 를 훑어 `<PageContainer` 를 쓰는 파일을 모으므로,
 * 새 화면을 만들면서 제목을 빠뜨리면 그 화면이 **자동으로** 이 시험에 걸린다.
 */
function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [path] : [];
  });
}

/** 그 파일이 실제로 여는 JSX 요소 이름들. 주석·문자열은 parser 가 이미 갈라 놓는다. */
export function jsxElementNames(source: string): string[] {
  const file = ts.createSourceFile(
    "probe.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      names.push(node.tagName.getText(file));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
}

/** 문서 최상위 heading 을 «내는» 것들. 셋 중 하나가 정확히 한 번 나와야 한다. */
const PROVIDERS = ["PageHeader", "PageTitle", "h1"];

const countProviders = (source: string) =>
  jsxElementNames(source).filter((name) => PROVIDERS.includes(name)).length;

/**
 * 제목을 «자기가 부르는 컴포넌트»에 맡긴 화면 → 그 컴포넌트.
 *
 * 🔴 **예외를 그냥 건너뛰지 않는다.** 맡긴 쪽이 실제로 제목을 내는지 그 파일을 열어 센다 —
 * 그러지 않으면 delegate 가 제목을 잃어도 아무도 모른다.
 *
 * 🔴 **자라게 두지 마라.** 한 칸이 늘 때마다 「그 화면에 제목이 있는가」를 이 시험이 아니라
 * 사람이 확인해야 한다.
 */
const DELEGATES_TITLE: Record<string, string> = {
  "KnowledgePageFormScreen.tsx":
    "src/features/knowledge/components/KnowledgePageForm.tsx",
};

describe("page 의 문서 최상위 heading", () => {
  const screens = tsxFiles("src")
    .map((path) => ({ path, source: readFileSync(path, "utf8") }))
    .filter(({ source }) => jsxElementNames(source).includes("PageContainer"));

  it("훑을 화면을 실제로 찾았다", () => {
    // 🔴 0건이면 아래 시험이 «아무것도 검사하지 않은 채» 초록이 된다.
    expect(screens.length).toBeGreaterThanOrEqual(10);
  });

  it("🔴 PageContainer 로 세운 화면은 페이지 제목을 «정확히 하나» 낸다", () => {
    const wrong = screens
      .map(({ path, source }) => {
        const delegate = Object.entries(DELEGATES_TITLE).find(([name]) =>
          path.endsWith(name),
        );
        const target = delegate
          ? readFileSync(delegate[1], "utf8")
          : source;
        return { path, count: countProviders(target) };
      })
      .filter(({ count }) => count !== 1);

    expect(wrong).toEqual([]);
  });

  /*
 🔴 **검사 자체가 이 finding 의 대상이라, 검사를 검사한다.** 아래 셋은 reviewer 가
 문자열 검사에서 «실제로 통과시킨» 입력이다.
  */
  it("🔴 주석 속 제목과 중복 제목을 통과시키지 않는다", () => {
    const cases: Array<[string, string, number]> = [
      [
        "주석으로만 남은 제목",
        `const S = () => <PageContainer>{/* <PageTitle>제목</PageTitle> */}<div /></PageContainer>;`,
        0,
      ],
      [
        "문자열 안의 제목",
        `const S = () => <PageContainer>{"<h1>제목</h1>"}</PageContainer>;`,
        0,
      ],
      [
        "제목이 둘",
        `const S = () => <PageContainer><PageTitle>a</PageTitle><h1>b</h1></PageContainer>;`,
        2,
      ],
      [
        "제목이 하나",
        `const S = () => <PageContainer><PageTitle>a</PageTitle></PageContainer>;`,
        1,
      ],
    ];

    for (const [label, source, expected] of cases) {
      expect(countProviders(source), label).toBe(expected);
    }
  });
});
