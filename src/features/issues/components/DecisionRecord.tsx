import { MarkdownContent } from "@/features/issues/components/MarkdownContent";
import type { IssueActivityEntry } from "@/features/issues/server/issue-detail-query";

export interface DecisionRecordLabels {
  decision: string;
  solution: string;
  decisionReason: string;
  alternatives: string;
  tradeOff: string;
  verification: string;
  regressionTest: string;
  residualRisk: string;
}

interface DecisionEntry {
  label: string;
  value: string;
}

export function DecisionRecord({
  activity,
  labels,
}: {
  activity: IssueActivityEntry;
  labels: DecisionRecordLabels;
}) {
  const primary = compact([
    { label: labels.solution, value: activity.solution },
    { label: labels.decisionReason, value: activity.decisionReason },
    { label: labels.verification, value: activity.verification },
  ]);
  const secondary = compact([
    { label: labels.alternatives, value: activity.alternativesConsidered },
    { label: labels.tradeOff, value: activity.tradeOff },
    { label: labels.regressionTest, value: activity.regressionTest },
    { label: labels.residualRisk, value: activity.residualRisk },
  ]);

  if (primary.length === 0 && secondary.length === 0) {
    return null;
  }

  return (
    <section
      aria-label={labels.decision}
      className="mt-3 rounded-md border border-border/70 bg-surface-muted/25 px-3 py-3"
    >
      {/*
 🔴 **`<h3>` 이지 `<h4>` 가 아니다.** 이 블록을 감싼 가장 가까운 heading 은 History
 `Section` 의 제목(`<h2>`)이고, 그 사이에 heading 이 하나도 없다 — `<h4>` 로 두면
 한 층이 비어 낭독기가 「빠진 층」으로 읽는다. 크기는 class 가 정하므로 tag 를
 내려도 **화면은 한 픽셀도 달라지지 않는다.**
 */}
      <h3 className="text-[11px] font-semibold tracking-tight text-foreground">
        {labels.decision}
      </h3>

      {primary.length > 0 && (
        <dl className="mt-2 divide-y divide-border/60 border-y border-border/60">
          {primary.map((entry) => (
            <div key={entry.label} className="py-2.5">
              <dt className="text-[11px] font-semibold text-foreground">
                {entry.label}
              </dt>
              <dd className="mt-1 min-w-0">
                <MarkdownContent
                  content={entry.value}
                  emptyLabel="—"
                  baseHeadingLevel={3}
                  className="gap-2 [&_p]:text-[13px]"
                />
              </dd>
            </div>
          ))}
        </dl>
      )}

      {secondary.length > 0 && (
        <dl className="mt-3 grid gap-x-5 gap-y-3 sm:grid-cols-2">
          {secondary.map((entry, index) => (
            <div
              key={entry.label}
              className="min-w-0 border-l border-border/70 pl-2.5"
            >
              <dt className="flex items-baseline gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {/* 읽기 순서 표시일 뿐 데이터가 아니다. 그려진 칸에 이어서 매기므로
                    비어 있는 field 가 있어도 번호가 건너뛰지 않는다. */}
                <span
                  aria-hidden
                  className="shrink-0 font-normal tabular-nums text-muted-foreground/70"
                >
                  {sectionIndex(index)}
                </span>
                <span className="min-w-0">{entry.label}</span>
              </dt>
              <dd className="mt-1 text-muted-foreground">
                <MarkdownContent
                  content={entry.value}
                  emptyLabel="—"
                  baseHeadingLevel={3}
                  className="gap-1.5 text-muted-foreground [&_p]:text-xs"
                />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function sectionIndex(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function compact(
  entries: { label: string; value: string | null }[],
): DecisionEntry[] {
  return entries.filter(
    (entry): entry is DecisionEntry => entry.value !== null,
  );
}
