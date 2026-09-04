import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MetaDot } from "@/components/molecules/PageHeader";

/**
 * 🔴 **구분점이 줄 끝이나 다음 줄 첫머리에 «홀로» 서지 않게 하는 것이 이 컴포넌트의 전부다.**
 *
 * 규칙은 글자 두 개에 담겨 있다 — 점 «앞»은 줄바꿈하지 않는 공백(U+00A0)이라 끊길 자리가
 * 없고, 끊길 수 있는 것은 점 «뒤»의 보통 공백(U+0020) 하나뿐이다. 그래서 점은 앞 조각에
 * 붙어 함께 움직인다.
 *
 * 🔴 **눈으로 보면 두 공백이 똑같이 생겼다.** NBSP 가 보통 공백으로 되돌아가도 화면은
 * 그대로이고 좁은 화면에서만 드러난다 — 그래서 **codepoint 를 직접** 못 박는다.
 */
describe("MetaDot", () => {
  const markup = renderToStaticMarkup(createElement(MetaDot));

  it("🔴 점 앞은 줄바꿈하지 않는 공백, 뒤는 보통 공백이다", () => {
    // ` ` 다음에 점, 그 다음에 ` `. 순서가 뒤집히면 점이 줄 첫머리에 설 수 있다.
    expect(markup).toBe(
      ' <span aria-hidden="true" class="mx-0.5 text-border">·</span> ',
    );
  });

  it("읽어 주는 기계에는 들리지 않는다", () => {
    // 점은 장식이다 — 앞뒤 사실을 나누는 공백은 실제 text node 로 남는다.
    expect(markup).toContain('aria-hidden="true"');
    expect(markup.startsWith(" ")).toBe(true);
    expect(markup.endsWith(" ")).toBe(true);
  });
});

/**
 * 🔴 **`truncate` 는 `white-space: nowrap` 을 포함해 `wrap-anywhere` 를 덮는다.**
 *
 * 그러면 빈칸 없는 저장소 이름이 끊기지 못하고, 조상 `Section` 의 `overflow-hidden` 이
 * 넘친 부분을 잘라 낸다 — 실측으로 390px 에서 **459px** 가 사라졌다. 접어서 두 줄이 되는
 * 편이 값이 사라지는 것보다 낫다.
 *
 * 🔴 **이 시험은 «잘리는가»를 재지 못한다.** 그것은 조상의 `overflow` 까지 얽힌 layout
 * 결과라 배치 엔진이 있어야 한다 — 여기서는 **원인이 되는 class 가 돌아오지 않는지**만
 * 붙들고, 실제 폭은 브라우저로 잰다.
 */
describe("Dashboard 의 metadata 줄", () => {
  const metadataLine = (path: string) => {
    const source = readFileSync(path, "utf8");
    const line = source
      .split("\n")
      .find((text) => text.includes("wrap-anywhere") && text.includes("<p "));
    return line ?? "";
  };

  it("🔴 긴 이름을 자르지 않고 접는다", () => {
    for (const path of [
      "src/features/dashboard/components/ProjectDashboardScreen.tsx",
      "src/features/dashboard/components/WorkspaceDashboardScreen.tsx",
    ]) {
      const line = metadataLine(path);
      expect(line, path).not.toBe("");
      expect(line, path).toContain("wrap-anywhere");
      expect(line, path).not.toContain("truncate");
    }
  });
});
