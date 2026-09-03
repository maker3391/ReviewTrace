import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/**
 * 저장된 Markdown 원문에서 **목록 한 줄로 읽을 평문**을 뽑는다.
 *
 * ## 왜 필요한가
 *
 * 서술 field(`resolutionSummary` 등)는 Markdown 원문으로 저장된다 — 상세 화면은
 * `MarkdownView` 가 그것을 문서 구조로 그린다. 그런데 Dashboard 의 「최근 해결」처럼
 * **두 줄로 접히는 compact preview** 는 문서가 아니라 «한 줄»이다. 원문을 그대로 두면
 * `##` · `**` · 백틱 같은 표기가 그 두 줄의 절반을 차지한다.
 *
 * 🔴 **`MarkdownView` 로 대신하지 않는다.** heading·list·table·code block 을 그대로
 * 그리면 행 높이가 제각각이 되어 목록의 밀도가 무너진다(스펙 16). 이 자리에 필요한 것은
 * 「무엇을 고쳤는지 훑을 한 줄」이지 문서가 아니다.
 *
 * ## 왜 정규식이 아닌가
 *
 * `#`·`**`·백틱을 지우는 정규식은 **본문에 그 글자가 들어 있는 경우**와 구분하지 못하고,
 * fenced code block 안의 표기·중첩 list·table 을 손도 대지 못한다. 그래서 실제 Markdown
 * parser 로 **문서를 해석한 뒤** 텍스트만 다시 모은다.
 *
 * 🔴 **새 Library 를 들이지 않았다**(스펙 18). `remark-parse` · `unified` 는 이미
 * `react-markdown` 이 끌고 있어 lockfile 에 있던 것을 직접 의존으로 올렸을 뿐이고,
 * GFM 확장은 **화면이 쓰는 그 `remark-gfm`** 을 그대로 쓴다 — 미리보기와 상세가
 * 같은 문법으로 같은 문서를 읽는다.
 */
const processor = unified().use(remarkParse).use(remarkGfm);

/**
 * mdast Node 의 구조 최소치.
 *
 * 🔴 **`@types/mdast` 를 직접 의존으로 올리지 않으려고** 이름 대신 모양으로 받는다 —
 * 여기서 보는 칸은 넷뿐이고, 그 넷은 mdast 가 바뀌어도 흔들리지 않는다.
 */
interface MarkdownNode {
  type: string;
  value?: string;
  alt?: string | null;
  children?: MarkdownNode[];
}

/**
 * 안이 다시 block 인 것들. 표기(`>` · `-` · `1.`)만 사라지고 내용은 살아남는다.
 */
const CONTAINER_BLOCKS = new Set([
  "blockquote",
  "list",
  "listItem",
  "table",
  "tableRow",
]);

/**
 * 읽을 문장이 아니라 **문서의 뼈대나 참조**인 것들. 통째로 버린다.
 *
 * `thematicBreak` 는 애초에 글자가 없고, `definition`(`[a]: url`) ·
 * `footnoteDefinition` 은 본문 밑에 붙는 참조라 요약 한 줄에 끼어들 자리가 아니다.
 * `html` 은 `MarkdownView` 가 **렌더하지 않고 글자 그대로** 두는 값이라(그쪽 주석 참고)
 * 미리보기에 넣으면 `<div>` 같은 것이 그대로 보인다.
 */
const DROPPED_BLOCKS = new Set([
  "thematicBreak",
  "html",
  "definition",
  "footnoteDefinition",
  "yaml",
]);

/** Inline 을 글자로 편다. link 는 문구만 남고 URL 은 버린다. */
function inlineText(node: MarkdownNode): string {
  switch (node.type) {
    case "text":
    // 백틱은 표기일 뿐 값의 일부가 아니다 — `foo` 는 foo 로 읽힌다.
    case "inlineCode":
      return node.value ?? "";
    // 그림은 미리보기에 뜨지 않는다. 사람이 읽을 것은 대체 문구뿐이다.
    case "image":
    case "imageReference":
      return node.alt ?? "";
    // 강제 개행은 compact preview 에서 낱말 사이 공백이다.
    case "break":
      return " ";
    case "html":
    case "footnoteReference":
      return "";
    default:
      return (node.children ?? []).map(inlineText).join("");
  }
}

/**
 * block 을 훑어 「읽을 한 덩어리」씩 모은다.
 *
 * @param includeEvidence code block·table 까지 담을지. 평소에는 `false` 다 — 아래 설명 참고.
 */
function collectBlocks(
  nodes: readonly MarkdownNode[],
  includeEvidence: boolean,
  out: string[],
): void {
  for (const node of nodes) {
    if (node.type === "code") {
      if (includeEvidence) out.push(node.value ?? "");
      continue;
    }
    if (node.type === "table") {
      if (includeEvidence) collectBlocks(node.children ?? [], true, out);
      continue;
    }
    if (DROPPED_BLOCKS.has(node.type)) continue;
    if (CONTAINER_BLOCKS.has(node.type)) {
      collectBlocks(node.children ?? [], includeEvidence, out);
      continue;
    }
    // paragraph · heading · tableCell 처럼 안이 inline 인 것.
    out.push(inlineText(node));
  }
}

/** 줄바꿈·들여쓰기·연속 공백을 한 칸으로 접는다. */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Markdown 원문 -> compact preview 용 평문.
 *
 * ## 무엇을 버리고 무엇을 남기나
 *
 * heading · paragraph · list · blockquote · inline code · link 는 **문구를 살리고
 * 표기 기호만** 없앤다. 문서의 층은 사라지지만 「무엇을 말했는가」는 남는다.
 *
 * 🔴 **fenced code block 과 table 은 버린다.** 둘은 요약 문장이 아니라 **근거**다 —
 * 식별자와 구분선으로 이루어져 있어 두 줄짜리 미리보기에 들어오면 그 두 줄을 통째로
 * 먹고도 읽히지 않는다. 그것을 볼 자리는 상세 화면이고, 거기서는 `MarkdownView` 가
 * 원문 그대로 그린다.
 *
 * 🔴 **다만 그 결과로 미리보기가 «비지는» 않게 한다.** 본문이 code block 이나 table
 * 하나뿐인 문서라면 위 규칙만으로 빈 줄이 남아 「고장난 화면」처럼 보인다 —
 * 남는 것이 없을 때만 그 둘까지 펴서 한 번 더 만든다.
 *
 * 🔴 **길이를 자르지 않는다.** 이 자리의 truncation 은 예나 지금이나 화면의
 * `line-clamp` 가 한다 — 서버에서 미리 자르면 폭에 따라 달라지는 그 판단을 빼앗는다.
 */
export function markdownToPlainText(markdown: string): string {
  const root = processor.parse(markdown) as MarkdownNode;
  const children = root.children ?? [];

  const readable: string[] = [];
  collectBlocks(children, false, readable);
  const text = collapseWhitespace(readable.join(" "));
  if (text !== "") return text;

  const everything: string[] = [];
  collectBlocks(children, true, everything);
  return collapseWhitespace(everything.join(" "));
}
