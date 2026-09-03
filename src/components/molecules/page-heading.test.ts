import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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
 * 그래서 **「`PageContainer` 로 page 를 세운 파일은 제목을 낼 자리를 갖는다」** 를 본다.
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

/**
 * 제목을 «자기가 부르는 컴포넌트»에 맡긴 화면.
 *
 * 🔴 **자라게 두지 마라.** 한 칸이 늘 때마다 「그 화면에 제목이 있는가」를 이 시험이 아니라
 * 사람이 확인해야 한다. 지금 하나뿐이고, 그 하나는 `KnowledgePageForm`(→ `PageHeader`)이
 * 제목을 갖는다.
 */
const DELEGATES_TITLE = ["KnowledgePageFormScreen.tsx"];

describe("page 의 문서 최상위 heading", () => {
  const screens = tsxFiles("src")
    .map((path) => ({ path, source: readFileSync(path, "utf8") }))
    .filter(({ source }) => source.includes("<PageContainer"));

  it("훑을 화면을 실제로 찾았다", () => {
    // 🔴 0건이면 아래 시험이 «아무것도 검사하지 않은 채» 초록이 된다.
    expect(screens.length).toBeGreaterThanOrEqual(10);
  });

  it("🔴 PageContainer 로 세운 화면은 모두 페이지 제목을 갖는다", () => {
    const missing = screens
      .filter(({ path, source }) => {
        if (DELEGATES_TITLE.some((name) => path.endsWith(name))) return false;
        return (
          !source.includes("<PageHeader") &&
          !source.includes("<PageTitle") &&
          !source.includes("<h1")
        );
      })
      .map(({ path }) => path);

    expect(missing).toEqual([]);
  });
});
