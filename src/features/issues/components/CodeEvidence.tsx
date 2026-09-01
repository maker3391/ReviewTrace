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
}

const VERIFICATION_CLASS: Record<EvidenceVerification, string> = {
  UNVERIFIED: "border-border bg-background text-muted-foreground",
  VERIFIED: "border-border bg-muted/70 text-foreground",
  MISMATCH: "border-destructive/30 bg-destructive/10 text-destructive",
  UNAVAILABLE: "border-border bg-muted text-muted-foreground",
};

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

        return (
          <div key={`${before.id}:${after.id}`} className="flex flex-col gap-2">
            <CodeEvidenceBlock
              evidence={before}
              displaySnapshot={beforeDisplay?.code ?? null}
              displayLineStructureChanged={
                beforeDisplay?.lineStructureChanged ?? false
              }
              changedLines={diff?.beforeChanged}
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
  repositoryFullName,
  labels,
}: {
  evidence: IssueEvidenceEntry;
  /** EvidenceList가 서버에서 만든 표시용 문자열. DB snapshot과는 별개다. */
  displaySnapshot?: string | null;
  /** true면 gutter는 실제 source line이 아니라 1부터 시작하는 상대 display line이다. */
  displayLineStructureChanged?: boolean;
  changedLines?: ReadonlySet<number>;
  repositoryFullName: string;
  labels: EvidenceLabels;
}) {
  const snapshot = displaySnapshot ?? evidence.snapshot;
  const language = detectEvidenceLanguage(evidence.filePath);
  const lineCount = snapshot?.split(/\r\n|\r|\n/u).length ?? 0;
  const firstLine = displayLineStructureChanged ? 1 : (evidence.startLine ?? 1);
  const preview =
    snapshot === null ? null : buildEvidencePreview(snapshot, changedLines);

  return (
    <article className="min-w-0 overflow-hidden rounded-md border border-border/70">
      <header className="bg-surface-muted/40 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
            {evidence.kind === "BEFORE" ? labels.before : labels.after}
          </span>
          {language !== null && (
            <span className="text-[10px] font-medium text-muted-foreground">
              {language.label}
            </span>
          )}
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-medium",
              VERIFICATION_CLASS[evidence.verification],
            )}
          >
            {labels.verification[evidence.verification]}
          </span>
        </div>
        <span
          className="mt-1.5 block min-w-0 truncate font-mono text-[11px] text-foreground"
          title={evidenceLocation(evidence)}
        >
          {evidenceLocation(evidence)}
        </span>
        <div className="mt-1 flex min-w-0 items-center justify-between gap-3">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
            <span className="font-mono">{evidence.commitSha.slice(0, 7)}</span>
            {evidence.verifiedAt !== null && (
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
            {labels.viewCode}
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

  return (
    <div className="max-w-full overflow-x-auto bg-muted/30">
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
