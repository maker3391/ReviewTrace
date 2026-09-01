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
      <h4 className="text-[11px] font-semibold tracking-tight text-foreground">
        {labels.decision}
      </h4>

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
                  className="gap-2 [&_p]:text-[13px]"
                />
              </dd>
            </div>
          ))}
        </dl>
      )}

      {secondary.length > 0 && (
        <dl className="mt-3 grid gap-x-5 gap-y-3 sm:grid-cols-2">
          {secondary.map((entry) => (
            <div
              key={entry.label}
              className="min-w-0 border-l border-border/70 pl-2.5"
            >
              <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {entry.label}
              </dt>
              <dd className="mt-1 text-muted-foreground">
                <MarkdownContent
                  content={entry.value}
                  emptyLabel="—"
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

function compact(
  entries: { label: string; value: string | null }[],
): DecisionEntry[] {
  return entries.filter(
    (entry): entry is DecisionEntry => entry.value !== null,
  );
}
