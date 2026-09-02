import "server-only";

import { Fragment, type ReactNode } from "react";
import { common, createLowlight } from "lowlight";

import {
  allEvidenceLines,
  buildEvidencePreview,
  diffEvidenceLines,
  pairEvidenceByFile,
  type EvidenceDisplayLine,
} from "@/features/issues/components/code-evidence-diff";
import type { IssueEvidenceEntry } from "@/features/issues/server/issue-detail-query";
import { cn } from "@/lib/utils";
import { Timestamp } from "@/components/atoms/Timestamp";
import type { EvidenceVerification } from "@/types/review";

const highlighter = createLowlight(common);

const LANGUAGE_BY_EXTENSION = {
  ts: { highlighter: "typescript", label: "TS", prettier: true },
  tsx: { highlighter: "tsx", label: "TSX", prettier: true },
  js: { highlighter: "javascript", label: "JS", prettier: true },
  jsx: { highlighter: "jsx", label: "JSX", prettier: true },
  java: { highlighter: "java", label: "Java", prettier: false },
  sql: { highlighter: "sql", label: "SQL", prettier: false },
  json: { highlighter: "json", label: "JSON", prettier: true },
  yaml: { highlighter: "yaml", label: "YAML", prettier: false },
  yml: { highlighter: "yaml", label: "YAML", prettier: false },
  bash: { highlighter: "bash", label: "Shell", prettier: false },
  sh: { highlighter: "bash", label: "Shell", prettier: false },
  css: { highlighter: "css", label: "CSS", prettier: false },
  html: { highlighter: "xml", label: "HTML", prettier: false },
  htm: { highlighter: "xml", label: "HTML", prettier: false },
  md: { highlighter: "markdown", label: "Markdown", prettier: false },
  markdown: { highlighter: "markdown", label: "Markdown", prettier: false },
} as const;

export type EvidenceLanguage =
  (typeof LANGUAGE_BY_EXTENSION)[keyof typeof LANGUAGE_BY_EXTENSION];

/** filePath 만 보고 언어를 정한다. 모르는 확장자는 추측하지 않는다. */
export function detectEvidenceLanguage(
  filePath: string,
): EvidenceLanguage | null {
  const cleanPath = filePath.split(/[?#]/u, 1)[0] ?? filePath;
  const fileName = cleanPath.split(/[\\/]/u).at(-1) ?? cleanPath;
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || dot === fileName.length - 1) {
    return null;
  }

  const extension = fileName.slice(dot + 1).toLowerCase();
  return (
    LANGUAGE_BY_EXTENSION[extension as keyof typeof LANGUAGE_BY_EXTENSION] ??
    null
  );
}

/**
 * Evidence 원본을 바꾸지 않고 화면에 보여 줄 문자열만 정돈한다.
 *
 * Prettier가 안정적으로 파싱할 수 있는 JS 계열과 JSON만 대상이다. Evidence는 파일 전체가
 * 아니라 일부 줄일 수 있으므로 parser가 거절하면 정상적인 fallback으로 보고 원문을 쓴다.
 * Java/SQL/YAML/Bash/unknown은 formatter runtime을 더 붙이지 않고 원문을 그대로 보존한다.
 */
export interface EvidenceDisplaySnapshot {
  code: string;
  /** 원문과 다른 display formatting 결과인지. DB snapshot 변경 여부와는 무관하다. */
  formatted: boolean;
  /** formatter가 newline 수를 바꿔 source line과 1:1 대응할 수 없는지. */
  lineStructureChanged: boolean;
}

export async function formatEvidenceSnapshot(
  snapshot: string,
  filePath: string,
): Promise<EvidenceDisplaySnapshot> {
  const language = detectEvidenceLanguage(filePath);
  if (language === null || !language.prettier) {
    return { code: snapshot, formatted: false, lineStructureChanged: false };
  }

  try {
    const { format } = await import("prettier");
    const formatted = await format(snapshot, {
      filepath: filePath,
      printWidth: 40,
      tabWidth: 2,
      useTabs: false,
      endOfLine: "lf",
    });

    // Prettier가 항상 붙이는 마지막 newline은 빈 line-number 한 줄을 만들므로 display에서만 뺀다.
    const code = formatted.replace(/\n$/u, "");
    const normalizedSource = snapshot
      .replace(/\r\n|\r/gu, "\n")
      .replace(/\n$/u, "");
    return {
      code,
      formatted: code !== normalizedSource,
      lineStructureChanged:
        code.split("\n").length !== normalizedSource.split("\n").length,
    };
  } catch {
    return { code: snapshot, formatted: false, lineStructureChanged: false };
  }
}

interface HighlightTextNode {
  type: "text";
  value: string;
}

interface HighlightElementNode {
  type: "element";
  tagName: string;
  properties: { className?: unknown };
  children: HighlightNode[];
}

type HighlightNode = HighlightTextNode | HighlightElementNode;

/**
 * lowlight 가 만든 HAST 를 React node 로 옮긴다.
 *
 * raw HTML 문자열을 만들거나 주입하지 않는다. highlighter 가 내놓은 span의 `hljs-*`
 * class와 text만 React에 전달하므로 snapshot 안의 `<script>` 같은 문자열도 text로 escape된다.
 */
function renderHighlightNode(node: HighlightNode, key: string): ReactNode {
  if (node.type === "text") {
    return <Fragment key={key}>{node.value}</Fragment>;
  }

  const rawClasses = node.properties.className;
  const className = (Array.isArray(rawClasses) ? rawClasses : [rawClasses])
    .filter(
      (value): value is string =>
        typeof value === "string" && value.startsWith("hljs-"),
    )
    .join(" ");

  return (
    <span key={key} className={className || undefined}>
      {node.children.map((child, index) =>
        renderHighlightNode(child, `${key}-${index}`),
      )}
    </span>
  );
}

export interface EvidenceLabels {
  before: string;
  after: string;
  viewCode: string;
  noSnapshot: string;
  deletedLines: string;
  addedLines: string;
  checkedAt: string;
  showAllLines: (count: number) => string;
  verification: Record<EvidenceVerification, string>;
  /** 상시 노출하지 않는다 — 상태 낱말의 `title` 로만 붙는다. */
  verificationHint: Record<EvidenceVerification, string>;
  /**
   * 아직 커밋되지 않은 근거의 낱말.
   *
   * 🔴 **`UNAVAILABLE` 과 같은 문구를 쓰지 않는다.** 저장된 결과는 둘 다 `UNAVAILABLE` 이지만
   * 사람이 알아야 할 것은 다르다 — 저쪽은 「읽지 못했다」이고 이쪽은 **「아직 맞대 볼 원본이
   * 없다」**다. 같은 낱말로 그리면 「우리 저장소를 못 읽는 건가」로 읽힌다.
   */
  workingTree: string;
  workingTreeHint: string;
  /** 🔴 `WORKING_TREE` 의 링크는 이 코드가 아니라 **바탕 commit** 을 연다. 그렇게 말한다. */
  viewBaseCommit: string;
}

/*
 🔴 **한 카드 안에 서로 다른 두 가지 축이 있다. 같은 모양으로 그리지 않는다.**

 | 축 | 무엇을 말하는가 | 어디에 그리는가 |
 |---|---|---|
 | 역할·변경 비교 | 이 조각이 고침의 «전»인가 «후»인가, 짝과 견줘 어느 줄이 바뀌었나 | 머리의 알약 + 코드 줄의 −/+ |
 | 원본 검증 | 저장된 조각이 **표시된 commit 의 원본**과 같은가 | commit SHA 옆의 점 + 낱말 |

 둘을 나란한 알약 두 개로 두면 「수정 코드인데 왜 코드 불일치인가」라는 질문이 생긴다 —
 둘은 **애초에 다른 질문에 대한 답**이라 견줄 것이 아니다. 그래서 검증 결과를 그것이
 가리키는 **commit SHA 바로 옆**으로 내렸다. 무엇과 무엇을 맞대 본 것인지가 자리로 보인다.

 🔴 **red/green 은 검증이 아니다.** diff 계열 색은 «짝이 있어 줄을 견줄 수 있었을 때»만
 나온다(`hasLineComparison`) — 그래야 초록이 `VERIFIED`, 빨강이 `MISMATCH` 로 읽히지 않는다.
 짝이 없는 근거는 알약도 코드도 diff 색을 쓰지 않아 「왜 얘만 색이 없지」가 답을 갖는다.
*/
const VERIFICATION_TEXT_CLASS: Record<EvidenceVerification, string> = {
  UNVERIFIED: "text-muted-foreground",
  VERIFIED: "text-foreground",
  MISMATCH: "text-destructive",
  UNAVAILABLE: "text-muted-foreground",
};

const VERIFICATION_DOT_CLASS: Record<EvidenceVerification, string> = {
  UNVERIFIED: "bg-muted-foreground/35",
  VERIFIED: "bg-foreground/60",
  MISMATCH: "bg-destructive",
  // 🔴 「보지 못했다」는 채워진 점이 아니다 — 결과가 없다는 것을 빈 고리로 말한다.
  UNAVAILABLE: "border border-muted-foreground/50",
};

/**
 * 검증 자리에 무엇을 그릴지.
 *
 * 🔴 **저장된 `verification` 을 그대로 낱말로 바꾸지 않는다.** 아직 커밋되지 않은 근거는
 * 결과가 `UNAVAILABLE` 이지만 그 뜻이 다르다 — 「읽지 못했다」가 아니라 **「맞대 볼 원본이
 * 아직 없다」**다. 사람에게는 그 차이가 전부다.
 *
 * 🔴 **그렇다고 검증된 것처럼 그리지 않는다.** 점은 `UNAVAILABLE` 과 같은 빈 고리이고
 * 글자도 강조하지 않는다. 확인한 적이 없다는 사실은 그대로 남는다.
 */
export function evidenceVerificationView(
  evidence: Pick<IssueEvidenceEntry, "verification" | "sourceState">,
  labels: EvidenceLabels,
): { text: string; hint: string; textClass: string; dotClass: string } {
  if (evidence.sourceState === "WORKING_TREE") {
    return {
      text: labels.workingTree,
      hint: labels.workingTreeHint,
      textClass: "text-muted-foreground",
      dotClass: "border border-muted-foreground/50",
    };
  }
  return {
    text: labels.verification[evidence.verification],
    hint: labels.verificationHint[evidence.verification],
    textClass: VERIFICATION_TEXT_CLASS[evidence.verification],
    dotClass: VERIFICATION_DOT_CLASS[evidence.verification],
  };
}

/** 알약의 톤. diff 색은 실제로 줄을 견준 짝에만 쓴다. */
function roleClass(
  kind: IssueEvidenceEntry["kind"],
  hasLineComparison: boolean,
): string {
  if (!hasLineComparison) {
    return "bg-primary/10 text-primary";
  }
  return kind === "BEFORE"
    ? "bg-destructive/10 text-destructive"
    : "bg-diff-addition text-diff-addition-foreground";
}

export async function EvidenceList({
  evidence,
  repositoryFullName,
  labels,
}: {
  evidence: IssueEvidenceEntry[];
  repositoryFullName: string;
  labels: EvidenceLabels;
}) {
  const displaySnapshots = await Promise.all(
    evidence.map((item) =>
      item.snapshot === null
        ? Promise.resolve(null)
        : formatEvidenceSnapshot(item.snapshot, item.filePath),
    ),
  );
  const groups = pairEvidenceByFile(evidence);

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => {
        if (group.type === "single") {
          const item = evidence[group.index];
          if (item === undefined) return null;
          return (
            <CodeEvidenceBlock
              key={item.id}
              evidence={item}
              displaySnapshot={displaySnapshots[group.index]?.code ?? null}
              displayLineStructureChanged={
                displaySnapshots[group.index]?.lineStructureChanged ?? false
              }
              repositoryFullName={repositoryFullName}
              labels={labels}
            />
          );
        }

        const before = evidence[group.beforeIndex];
        const after = evidence[group.afterIndex];
        if (before === undefined || after === undefined) return null;
        const beforeDisplay = displaySnapshots[group.beforeIndex];
        const afterDisplay = displaySnapshots[group.afterIndex];
        const diff =
          beforeDisplay !== null &&
          beforeDisplay !== undefined &&
          afterDisplay !== null &&
          afterDisplay !== undefined
            ? diffEvidenceLines(beforeDisplay.code, afterDisplay.code)
            : null;

        /*
 🔴 **두 카드가 «한 비교»라는 것만 보이면 된다.**
 BEFORE 와 AFTER 는 짝인데, 여러 짝이 이어지면 어디까지가 한 쌍인지 간격만으로는
 읽히지 않았다. 그렇다고 바깥에 큰 Card 를 한 겹 더 씌우면 안쪽 카드가 이중 테두리
 안에 갇힌다 — **왼쪽에 가는 선 하나**로 묶는 쪽이 계층을 늘리지 않는다.

 🔴 **pairing 규칙 자체는 손대지 않았다**(`code-evidence-diff.ts` 의
 같은 Activity · 같은 filePath · FIFO 1:1). 여기서 바꾼 것은 그 결과를 그리는 방식뿐이다.
 */
        return (
          <div
            key={`${before.id}:${after.id}`}
            className="flex flex-col gap-2 border-l-2 border-primary/20 pl-2.5"
          >
            <CodeEvidenceBlock
              evidence={before}
              displaySnapshot={beforeDisplay?.code ?? null}
              displayLineStructureChanged={
                beforeDisplay?.lineStructureChanged ?? false
              }
              changedLines={diff?.beforeChanged}
              hasLineComparison={diff !== null}
              repositoryFullName={repositoryFullName}
              labels={labels}
            />
            <CodeEvidenceBlock
              evidence={after}
              displaySnapshot={afterDisplay?.code ?? null}
              displayLineStructureChanged={
                afterDisplay?.lineStructureChanged ?? false
              }
              changedLines={diff?.afterChanged}
              hasLineComparison={diff !== null}
              repositoryFullName={repositoryFullName}
              labels={labels}
            />
          </div>
        );
      })}
    </div>
  );
}

export function CodeEvidenceBlock({
  evidence,
  displaySnapshot,
  displayLineStructureChanged = false,
  changedLines = new Set(),
  hasLineComparison = false,
  repositoryFullName,
  labels,
}: {
  evidence: IssueEvidenceEntry;
  /** EvidenceList가 서버에서 만든 표시용 문자열. DB snapshot과는 별개다. */
  displaySnapshot?: string | null;
  /** true면 gutter는 실제 source line이 아니라 1부터 시작하는 상대 display line이다. */
  displayLineStructureChanged?: boolean;
  changedLines?: ReadonlySet<number>;
  /**
   * 짝이 있어 **줄 단위 비교를 실제로 했는가**. 🔴 `changedLines.size > 0` 로 대신하지
   * 않는다 — 바뀐 줄이 하나도 없는 짝도 「비교했다」가 사실이다. 이 값이 false 면 −/+ 도
   * diff 색도 그리지 않는다: 없는 비교 결과를 만들어 내지 않기 위해서다.
   */
  hasLineComparison?: boolean;
  repositoryFullName: string;
  labels: EvidenceLabels;
}) {
  const snapshot = displaySnapshot ?? evidence.snapshot;
  const language = detectEvidenceLanguage(evidence.filePath);
  const lineCount = snapshot?.split(/\r\n|\r|\n/u).length ?? 0;
  const firstLine = displayLineStructureChanged ? 1 : (evidence.startLine ?? 1);
  const preview =
    snapshot === null ? null : buildEvidencePreview(snapshot, changedLines);
  const view = evidenceVerificationView(evidence, labels);

  return (
    <article className="min-w-0 overflow-hidden rounded-md border border-border/70">
      <header className="bg-surface-muted/40 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
              roleClass(evidence.kind, hasLineComparison),
            )}
          >
            {hasLineComparison && (
              // 🔴 코드 줄의 cue 와 **같은 글자**다. 색이 아니라 이 기호가 뜻을 나른다.
              <span aria-hidden="true" className="font-mono">
                {evidence.kind === "BEFORE" ? "−" : "+"}
              </span>
            )}
            {evidence.kind === "BEFORE" ? labels.before : labels.after}
          </span>
          {language !== null && (
            <span className="text-[10px] font-medium text-muted-foreground">
              {language.label}
            </span>
          )}
        </div>
        <span
          className="mt-1.5 block min-w-0 truncate font-mono text-[11px] text-foreground"
          title={evidenceLocation(evidence)}
        >
          {evidenceLocation(evidence)}
        </span>
        <div className="mt-1 flex min-w-0 items-center justify-between gap-3">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
            {/*
 🔴 **`WORKING_TREE` 에서 이 SHA 의 뜻이 바뀐다.** 「이 코드가 있는 commit」이 아니라
 「이 작업이 그 위에서 이뤄진 바탕 commit」이다. 뒤의 `+` 가 그 차이를 말한다 —
 낱말을 더 늘리지 않고도 「그 commit 자체는 아니다」가 보인다.
 */}
            <span className="font-mono">
              {evidence.commitSha.slice(0, 7)}
              {evidence.sourceState === "WORKING_TREE" && (
                <span aria-hidden="true">+</span>
              )}
            </span>
            {/*
 🔴 **검증 결과는 그것이 가리키는 commit 바로 옆에 선다.** 「무엇과 무엇이 다르다는
 말인가」의 답이 자리로 드러난다 — 저장된 조각과 **이 commit 의 원본**이다.
 긴 설명은 화면에 상시로 두지 않고 `title` 로만 붙인다.
 */}
            <span
              className={cn("inline-flex items-center gap-1", view.textClass)}
              title={view.hint}
              data-verification={evidence.verification}
              data-source-state={evidence.sourceState}
            >
              <span
                aria-hidden="true"
                className={cn("size-1.5 rounded-full", view.dotClass)}
              />
              {view.text}
            </span>
            {/*
 🔴 **「확인 <시각>」은 맞대 본 근거에만 붙는다.** 아직 커밋 전인 근거에도 붙이면
 「아직 맞대 볼 원본이 없다」 옆에 확인 시각이 서서 서로를 부정한다.
 */}
            {evidence.verifiedAt !== null &&
              evidence.sourceState !== "WORKING_TREE" && (
              <span className="tabular-nums">
                {labels.checkedAt}{" "}
                <Timestamp value={evidence.verifiedAt} variant="exact" />
              </span>
            )}
          </span>
          <a
            href={githubEvidenceUrl(repositoryFullName, evidence)}
            target="_blank"
            rel="noreferrer noopener"
            className="shrink-0 text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {evidence.sourceState === "WORKING_TREE"
              ? labels.viewBaseCommit
              : labels.viewCode}
          </a>
        </div>
      </header>

      {snapshot === null ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">
          {labels.noSnapshot}
        </p>
      ) : (
        <>
          {changedLines.size > 0 && (
            <span className="sr-only">
              {evidence.kind === "BEFORE"
                ? labels.deletedLines
                : labels.addedLines}
            </span>
          )}
          <CodeViewport
            lines={preview?.lines ?? []}
            language={language}
            firstLine={firstLine}
            lineNumberKind={displayLineStructureChanged ? "relative" : "source"}
            changeKind={evidence.kind}
          />
          {preview?.truncated === true && (
            <details className="border-t border-border/60 bg-surface-muted/20">
              <summary className="cursor-pointer px-3 py-2 text-[11px] font-medium text-muted-foreground hover:text-foreground">
                {labels.showAllLines(lineCount)}
              </summary>
              <CodeViewport
                lines={allEvidenceLines(snapshot, changedLines)}
                language={language}
                firstLine={firstLine}
                lineNumberKind={
                  displayLineStructureChanged ? "relative" : "source"
                }
                changeKind={evidence.kind}
              />
            </details>
          )}
        </>
      )}
    </article>
  );
}

function CodeViewport({
  lines,
  language,
  firstLine,
  lineNumberKind,
  changeKind,
}: {
  lines: EvidenceDisplayLine[];
  language: EvidenceLanguage | null;
  firstLine: number;
  lineNumberKind: "source" | "relative";
  changeKind: IssueEvidenceEntry["kind"];
}) {
  const code = lines.map((line) => line.text).join("\n");
  const highlighted =
    language === null
      ? null
      : highlighter.highlight(language.highlighter, code);

  /*
 🔴 **가로 스크롤을 유지한다.** 긴 코드 줄을 자르거나 wrap 으로 접으면 그 줄이 원본과
 다른 것이 되어 근거로서의 값이 사라진다. 다만 막대를 «얇게» 만든다 —
 기본 굵기가 서너 줄짜리 근거에서는 코드보다 먼저 눈에 들어왔다(`globals.css`).
 */
  return (
    <div className="scroll-thin max-w-full overflow-x-auto bg-muted/30">
      <div className="grid min-w-max grid-cols-[auto_1fr] text-xs leading-5">
        <ol
          aria-hidden="true"
          data-line-number-kind={lineNumberKind}
          className="select-none border-r border-border/60 bg-surface-muted/35 py-3 text-right font-mono text-[10px] text-muted-foreground/70"
        >
          {lines.map((line, index) => (
            <li
              key={`${line.sourceIndex ?? "gap"}-${index}`}
              className={cn(
                "grid h-5 grid-cols-[0.75rem_1fr] gap-1 px-2 tabular-nums",
                line.changed &&
                  (changeKind === "BEFORE"
                    ? "bg-destructive/[0.08] text-destructive"
                    : "bg-diff-addition text-diff-addition-foreground"),
              )}
              data-change-kind={
                line.changed
                  ? changeKind === "BEFORE"
                    ? "deletion"
                    : "addition"
                  : "unchanged"
              }
            >
              <span>
                {line.changed ? (changeKind === "BEFORE" ? "−" : "+") : ""}
              </span>
              <span>
                {line.sourceIndex === null ? "…" : firstLine + line.sourceIndex}
              </span>
            </li>
          ))}
        </ol>
        <pre className="relative m-0 min-w-full overflow-visible p-3 font-mono text-xs leading-5 text-muted-foreground">
          {lines.map((line, index) =>
            line.changed ? (
              <span
                aria-hidden="true"
                key={`highlight-${line.sourceIndex ?? index}`}
                className={cn(
                  "pointer-events-none absolute inset-x-0 h-5",
                  changeKind === "BEFORE"
                    ? "bg-destructive/[0.08]"
                    : "bg-diff-addition",
                )}
                style={{ top: `${0.75 + index * 1.25}rem` }}
              />
            ) : null,
          )}
          <code
            className={cn(
              "relative whitespace-pre",
              "[&_.hljs-comment]:text-muted-foreground/70 [&_.hljs-comment]:italic",
              "[&_.hljs-quote]:text-muted-foreground/70 [&_.hljs-quote]:italic",
              "[&_.hljs-keyword]:font-medium [&_.hljs-keyword]:text-primary",
              "[&_.hljs-literal]:text-primary [&_.hljs-type]:text-primary",
              "[&_.hljs-built_in]:text-primary [&_.hljs-meta]:text-primary",
              "[&_.hljs-title]:font-semibold [&_.hljs-title]:text-foreground",
              "[&_.hljs-string]:text-foreground [&_.hljs-number]:text-foreground",
              "[&_.hljs-regexp]:text-foreground [&_.hljs-variable]:text-foreground",
              "[&_.hljs-tag]:text-muted-foreground [&_.hljs-name]:font-medium",
              "[&_.hljs-name]:text-primary [&_.hljs-attr]:text-primary/80",
              "[&_.hljs-attribute]:text-primary/80 [&_.hljs-params]:text-foreground",
            )}
          >
            {highlighted === null
              ? code
              : (highlighted.children as HighlightNode[]).map((node, index) =>
                  renderHighlightNode(node, `token-${index}`),
                )}
          </code>
        </pre>
      </div>
    </div>
  );
}

export function evidenceLocation(evidence: IssueEvidenceEntry): string {
  if (evidence.startLine === null) {
    return evidence.filePath;
  }
  if (evidence.endLine === null || evidence.endLine === evidence.startLine) {
    return `${evidence.filePath}:${evidence.startLine}`;
  }
  return `${evidence.filePath}:${evidence.startLine}-${evidence.endLine}`;
}

export function githubEvidenceUrl(
  repositoryFullName: string,
  evidence: IssueEvidenceEntry,
): string {
  const repository = repositoryFullName
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const filePath = evidence.filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const lines =
    evidence.startLine === null
      ? ""
      : evidence.endLine === null || evidence.endLine === evidence.startLine
        ? `#L${evidence.startLine}`
        : `#L${evidence.startLine}-L${evidence.endLine}`;

  return `https://github.com/${repository}/blob/${encodeURIComponent(evidence.commitSha)}/${filePath}${lines}`;
}
