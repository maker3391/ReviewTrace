/**
 * KPI 한 줄.
 *
 * 🔴 **KPI 를 Card 여러 개로 늘어놓지 않는다**(CLAUDE.md 16). Card 를 쓰면 화면에 상자가
 * 넷 떠 있고, 정작 비교해야 할 **숫자끼리는 멀어진다.**
 *
 * ```
 * Reviews      Issues      Open      Resolved
 * 184          427         38        389
 * ```
 *
 * 숫자·Label·정렬만으로 충분하다 — 테두리도 배경도 그림자도 두지 않는다.
 * 값은 `tabular-nums` 로 자릿수를 맞춰 세로로 읽히게 한다.
 */
export interface Stat {
  label: string;
  /** 🔴 값이 없는 것과 0 은 다르다. 없으면 `—` 다 — 0 으로 그리면 거짓말이 된다. */
  value: number | string | null;
  /** 관찰 구간 등. 없으면 적지 않는다 — 설명이 없어도 읽히면 설명을 붙이지 않는다. */
  hint?: string;
}

export function StatRow({ stats }: { stats: readonly Stat[] }) {
  return (
    <dl className="flex flex-wrap gap-x-10 gap-y-4">
      {stats.map((stat) => (
        <div key={stat.label} className="flex flex-col">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {stat.label}
          </dt>
          <dd className="text-2xl font-semibold leading-tight tabular-nums">
            {stat.value === null ? "—" : stat.value}
          </dd>
          {stat.hint !== undefined && (
            <span className="text-[10px] text-muted-foreground">{stat.hint}</span>
          )}
        </div>
      ))}
    </dl>
  );
}
