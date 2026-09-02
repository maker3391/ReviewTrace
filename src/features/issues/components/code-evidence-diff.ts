import type { IssueEvidenceEntry } from "@/features/issues/server/issue-detail-query";

const MAX_DIFF_LINES = 500;
const DEFAULT_CONTEXT_LINES = 3;
const DEFAULT_PREVIEW_LINES = 24;

export interface EvidenceLineDiff {
  beforeChanged: ReadonlySet<number>;
  afterChanged: ReadonlySet<number>;
}

export interface EvidenceDisplayLine {
  sourceIndex: number | null;
  text: string;
  changed: boolean;
}

export interface EvidencePreview {
  lines: EvidenceDisplayLine[];
  truncated: boolean;
}

export type EvidenceGroup =
  | { type: "pair"; beforeIndex: number; afterIndex: number }
  | { type: "single"; index: number };

/**
 * 현재 domain에는 명시적 pair id가 없다. 같은 EvidenceList 안에서 filePath가 정확히 같은
 * BEFORE/AFTER만 입력 순서대로 1:1 대응시킨다. 다른 Activity를 넘나들거나 basename만
 * 같은 파일은 추측해서 묶지 않는다.
 */
export function pairEvidenceByFile(
  evidence: readonly Pick<IssueEvidenceEntry, "filePath" | "kind">[],
): EvidenceGroup[] {
  const afterByPath = new Map<string, number[]>();
  evidence.forEach((item, index) => {
    if (item.kind !== "AFTER") return;
    const queue = afterByPath.get(item.filePath) ?? [];
    queue.push(index);
    afterByPath.set(item.filePath, queue);
  });

  /**
   * 🔴 **짝짓기를 «먼저» 끝내고 그 다음에 순서대로 내보낸다.**
   *
   * 한 번의 순회로 하면 배열에서 `AFTER` 가 `BEFORE` 보다 앞설 때 그 `AFTER` 가
   * standalone 으로 «확정»돼 버리고, 뒤에 오는 짝은 쓸 것이 없어 둘 다 홀로 남는다.
   *
   * 🔴 **그 순서는 우리가 정하는 것이 아니다.** 목록은 `(createdAt, id)` 로 정렬되는데
   * 한 Transaction 에서 들어온 근거들은 `createdAt` 이 전부 같다 — 즉 **무작위 UUID 가
   * diff 를 그릴지 말지를 정하고 있었다.** 같은 Activity 의 같은 파일인데도 어떤 화면에는
   * red/green 이 나오고 어떤 화면에는 안 나왔다.
   *
   * 규칙 자체는 그대로다 — 같은 목록·정확히 같은 `filePath`·FIFO 1:1. 다른 Activity 를
   * 넘나들거나 basename 만 같은 파일을 묶지 않는다.
   */
  const used = new Set<number>();
  /** 짝을 «먼저 나오는 쪽» 자리에 놓아 화면 순서를 흔들지 않는다. */
  const pairAt = new Map<number, { beforeIndex: number; afterIndex: number }>();

  evidence.forEach((item, index) => {
    if (item.kind !== "BEFORE") return;
    const afterIndex = afterByPath
      .get(item.filePath)
      ?.find((candidate) => !used.has(candidate));
    if (afterIndex === undefined) return;
    used.add(index);
    used.add(afterIndex);
    pairAt.set(Math.min(index, afterIndex), {
      beforeIndex: index,
      afterIndex,
    });
  });

  const groups: EvidenceGroup[] = [];
  evidence.forEach((_item, index) => {
    const pair = pairAt.get(index);
    if (pair !== undefined) {
      groups.push({ type: "pair", ...pair });
      return;
    }
    if (used.has(index)) return;
    groups.push({ type: "single", index });
  });

  return groups;
}

/** 줄 단위 LCS. 너무 큰 입력은 화면 요청 비용을 제한하기 위해 diff하지 않는다. */
export function diffEvidenceLines(
  before: string,
  after: string,
): EvidenceLineDiff | null {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  if (
    beforeLines.length > MAX_DIFF_LINES ||
    afterLines.length > MAX_DIFF_LINES
  ) {
    return null;
  }

  const width = afterLines.length + 1;
  const matrix = new Uint16Array((beforeLines.length + 1) * width);
  const readMatrix = (index: number) => matrix[index] ?? 0;
  for (
    let beforeIndex = beforeLines.length - 1;
    beforeIndex >= 0;
    beforeIndex -= 1
  ) {
    for (
      let afterIndex = afterLines.length - 1;
      afterIndex >= 0;
      afterIndex -= 1
    ) {
      const cell = beforeIndex * width + afterIndex;
      matrix[cell] =
        beforeLines[beforeIndex] === afterLines[afterIndex]
          ? readMatrix((beforeIndex + 1) * width + afterIndex + 1) + 1
          : Math.max(
              readMatrix((beforeIndex + 1) * width + afterIndex),
              readMatrix(beforeIndex * width + afterIndex + 1),
            );
    }
  }

  const beforeChanged = new Set<number>();
  const afterChanged = new Set<number>();
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
    if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
      beforeIndex += 1;
      afterIndex += 1;
    } else if (
      readMatrix((beforeIndex + 1) * width + afterIndex) >=
      readMatrix(beforeIndex * width + afterIndex + 1)
    ) {
      beforeChanged.add(beforeIndex);
      beforeIndex += 1;
    } else {
      afterChanged.add(afterIndex);
      afterIndex += 1;
    }
  }
  while (beforeIndex < beforeLines.length) beforeChanged.add(beforeIndex++);
  while (afterIndex < afterLines.length) afterChanged.add(afterIndex++);

  return { beforeChanged, afterChanged };
}

export function buildEvidencePreview(
  source: string,
  changedLines: ReadonlySet<number> = new Set(),
  contextLines = DEFAULT_CONTEXT_LINES,
  maxPreviewLines = DEFAULT_PREVIEW_LINES,
): EvidencePreview {
  const sourceLines = splitLines(source);
  if (sourceLines.length <= maxPreviewLines) {
    return {
      lines: sourceLines.map((text, sourceIndex) => ({
        sourceIndex,
        text,
        changed: changedLines.has(sourceIndex),
      })),
      truncated: false,
    };
  }

  const included = new Set<number>();
  if (changedLines.size > 0) {
    for (const changed of changedLines) {
      for (
        let index = Math.max(0, changed - contextLines);
        index <= Math.min(sourceLines.length - 1, changed + contextLines);
        index += 1
      ) {
        included.add(index);
      }
    }
  } else {
    for (let index = 0; index < maxPreviewLines; index += 1)
      included.add(index);
  }

  const indexes = [...included].sort((left, right) => left - right);
  const lines: EvidenceDisplayLine[] = [];
  if ((indexes[0] ?? 0) > 0) {
    lines.push({ sourceIndex: null, text: "⋯", changed: false });
  }
  indexes.forEach((sourceIndex, index) => {
    const previous = indexes[index - 1];
    if (previous !== undefined && sourceIndex > previous + 1) {
      lines.push({ sourceIndex: null, text: "⋯", changed: false });
    }
    lines.push({
      sourceIndex,
      text: sourceLines[sourceIndex] ?? "",
      changed: changedLines.has(sourceIndex),
    });
  });
  if ((indexes.at(-1) ?? sourceLines.length - 1) < sourceLines.length - 1) {
    lines.push({ sourceIndex: null, text: "⋯", changed: false });
  }

  return { lines, truncated: true };
}

export function allEvidenceLines(
  source: string,
  changedLines: ReadonlySet<number> = new Set(),
): EvidenceDisplayLine[] {
  return splitLines(source).map((text, sourceIndex) => ({
    sourceIndex,
    text,
    changed: changedLines.has(sourceIndex),
  }));
}

function splitLines(source: string): string[] {
  return source.split(/\r\n|\r|\n/u);
}
