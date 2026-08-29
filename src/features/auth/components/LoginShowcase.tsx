import { FileText, ShieldCheck, TrendingUp } from "lucide-react";
import type { ComponentType } from "react";

/**
 * 로그인 화면 오른쪽의 제품 미리보기.
 *
 * ## 🔴 이것은 장식이 아니라 **제품의 한 문장**이다
 *
 * ```
 * Review  →  Issue  →  Code Evidence  →  Decision  →  Verified
 * ```
 *
 * ReviewTrace 가 남기는 것이 정확히 이 줄기다. 그래서 카드를 여러 장 띄우지 않고
 * **하나로 이어 붙였다** — 따로 떠 있으면 「대시보드 흉내」로 읽히고, 이어져 있으면
 * 「이 Review 가 이 코드를 이렇게 고쳤고 그것을 확인했다」로 읽힌다.
 *
 * ## 🔴 여기 있는 낱말은 전부 실제 schema 에 있는 것이다
 *
 * | 화면 | 어디에 있는가 |
 * |---|---|
 * | `Review` · `codex` · `COMMIT` | `review_sessions.reviewer_name` · `target_type` |
 * | `3 Issues` | 한 Session 에 딸린 `review_issues` |
 * | `RESOLVED` | `review_issues.status` (`issue_status` enum) |
 * | `HIGH` · `TRANSACTION` | `review_issues.severity` · `category` (둘 다 enum) |
 * | 파일·줄·BEFORE/AFTER | `issue_code_evidences.file_path` · `start_line` · `kind` |
 * | `Decision` 한 줄 | `issue_activities.decision_reason` (🔴 Issue 가 아니라 **행위**에 붙는다) |
 * | `Verified` · commit | `issue_code_evidences.verification` · `commit_sha` |
 *
 * 🔴 **없는 것을 만들어 내지 않는다.** ReviewSession 에는 상태 Column 이 없으므로
 * 상단에 상태 Badge 를 달지 않았다 — `RESOLVED` 는 **Issue 의 것**이라 Issue 마디에 붙였다.
 *
 * 🔴 **위의 `RESOLVED` 와 아래의 `Verified` 는 다른 말이다.** 위는 「이 문제가 닫혔다」이고
 * 아래는 「Agent 가 보낸 코드가 GitHub 의 그 Commit 과 같았다」다. 한쪽을 지우면 나머지
 * 하나가 두 가지를 뜻하는 것처럼 읽힌다.
 *
 * 🔴 **일반적인 SaaS 차트를 두지 않는다.** 막대 그래프는 어떤 제품에나 붙일 수 있어
 * 이 제품이 무엇인지 아무것도 말하지 않는다(CLAUDE.md 16).
 *
 * 🔴 **그림 파일을 두지 않는다.** 전부 실제 DOM 이라 테마를 따라가고 폭에 맞춰 접힌다.
 *
 * 🔴 **여기 값은 예시다.** 로그인 전이라 읽을 수 있는 데이터가 없다 — 사람 이름이나
 * 실제 저장소처럼 진짜로 보일 수 있는 것은 넣지 않는다.
 */
/**
 * 예시 diff 의 BEFORE·AFTER 한 줄씩. `issue_code_evidences.kind` 자리다.
 *
 * 🔴 **들여쓰기는 NBSP(` `)다.** 일반 공백은 접히거나 줄바꿈 자리가 되어
 * diff 의 계단이 무너진다.
 *
 * 🔴 **잘라내지 않고 접는다.** 카드 폭(diff 안쪽 237px)보다 긴 줄이 있어 `truncate` 로
 * 두면 `async (tx) => {` 가 「…」에 먹혀 **무엇으로 바꿨는지가 사라진다** — 실제로
 * 그렇게 그려졌다. 줄 수가 늘어 카드가 자라는 것은 콘텐츠의 결과이지 디자인 변경이 아니다.
 */
const REMOVED_LINES: readonly (readonly [number, string])[] = [
  [143, "await saveResolution(issue);"],
  [144, "await appendActivity(activity);"],
];

const ADDED_LINES: readonly (readonly [number, string])[] = [
  [143, "await db.transaction(async (tx) => {"],
  [144, "  await saveResolution(tx, issue);"],
  [145, "  await appendActivity(tx, activity);"],
  [146, "});"],
];

export function LoginShowcase({
  issue,
  decision,
}: {
  /** 예시 Issue 의 제목. `review_issues.title` 자리다. */
  issue: string;
  /** 🔴 상태값이 아니라 **왜 그 수정을 골랐는가**. `issue_activities.decision_reason` 자리다. */
  decision: string;
}) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none relative hidden select-none xl:block"
    >
      {/*
        배경. 「보이지만 신경 쓰이지 않는」 선까지만 — 아주 옅은 radial glow 하나와
        점 격자다. 페이지 전체를 보라색으로 덮지 않는다.

        🔴 **가로 번짐은 페이지 좌우 여백(`sm:px-8` = 32px)을 넘지 못한다.** 이 단은 격자의
        오른쪽 끝이라, 넘는 만큼이 그대로 문서 폭이 되어 **가로 스크롤바가 생긴다** —
        `-inset-x-10`(40px)일 때 1280 에서 `scrollWidth` 가 1288 이었다. 실제로 그랬다.
      */}
      <div
        className="absolute -inset-x-7 -inset-y-14 -z-10 rounded-[3rem] opacity-70"
        style={{
          backgroundImage:
            "radial-gradient(closest-side, color-mix(in oklch, var(--primary) 14%, transparent), transparent)",
        }}
      />
      <div
        className="absolute -inset-x-6 -inset-y-8 -z-10 rounded-[2.5rem] opacity-[0.35]"
        style={{
          backgroundImage: "radial-gradient(currentColor 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          color: "var(--border)",
          maskImage: "radial-gradient(closest-side, black, transparent 78%)",
        }}
      />

      <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-card/95 shadow-[0_1px_2px_0_oklch(0_0_0/0.04),0_18px_44px_-24px_oklch(0_0_0/0.22)] backdrop-blur">
        {/*
          머리 — 한 번의 Review.

          🔴 **마디로 두지 않고 띠로 둔다.** 아래 넷은 「이 Issue 에게 일어난 일」이고
          이것은 **그것들을 담고 있는 그릇**이다. 같은 점을 달아 다섯 마디로 만들면
          Review 가 Issue 와 같은 층위로 읽힌다.
        */}
        <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-surface-muted/50 px-5 py-3">
          <p className="text-[0.8125rem] font-semibold tracking-tight">Review</p>
          <p className="truncate font-mono text-[0.6875rem] text-muted-foreground">
            codex · COMMIT · 3 Issues
          </p>
        </div>

        <div className="relative">
          {/*
            🔴 **네 마디를 하나로 묶는 것은 이 왼쪽 세로 선이다.**
            선이 없으면 「카드 안에 토막이 몇 개 있다」로 읽히고, 있으면
            「이 문제를 → 이 코드에서 → 이렇게 판단해 → 이렇게 확인했다」로 읽힌다.
          */}
          <span className="absolute bottom-[1.875rem] left-[1.4375rem] top-6 w-px bg-gradient-to-b from-primary/50 via-primary/25 to-primary/50" />

          {/* 1. 무엇이 문제였나 — 이 줄기의 주인공이다(CLAUDE.md 2). */}
          <div className="relative pl-11 pr-5 pt-4">
            <span className="absolute left-[1.1875rem] top-[1.1875rem] size-2.5 rounded-full bg-primary ring-4 ring-card" />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-muted-foreground">
                Issue
              </span>
              {/* `issue_status` enum 값. 색은 StatusBadge 와 같은 규칙이다. */}
              <span className="shrink-0 rounded-md bg-emerald-500/15 px-2 py-0.5 font-mono text-[0.625rem] font-medium tracking-wide text-emerald-700 dark:text-emerald-400">
                RESOLVED
              </span>
            </div>
            {/* 🔴 `break-keep` — 한국어는 낱말 안에서 끊기면 읽기가 무너진다. */}
            <p className="mt-1.5 text-[0.9375rem] font-semibold leading-snug break-keep">
              {issue}
            </p>
            <p className="mt-2 flex items-center gap-1.5 font-mono text-[0.6875rem]">
              {/* Severity 는 SeverityBadge 의 HIGH 와 같은 색을 쓴다. */}
              <span className="font-medium text-destructive">HIGH</span>
              <span className="text-muted-foreground/50">·</span>
              <span className="text-muted-foreground">TRANSACTION</span>
            </p>
          </div>

          {/*
            2. 그 근거가 된 코드. 🔴 저장소를 복제하지 않는다 — 줄 범위뿐이다.

            🔴 **마디 사이에 가로선을 긋지 않는다.** 그으면 「토막 넷이 쌓인 표」가 되고,
            그것은 세로 선이 하려던 말과 정확히 반대다. 가르는 일은 여백과 점이 한다
            (CLAUDE.md 16 — 선은 구조를 가를 때만).
          */}
          <div className="relative pl-11 pr-5 pt-5">
            <span className="absolute left-[1.28125rem] top-[1.5625rem] size-1.5 rounded-full bg-primary/60 ring-4 ring-card" />
            <span className="text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-muted-foreground">
              Code Evidence
            </span>
            <p className="mt-1.5 truncate font-mono text-[0.6875rem] text-muted-foreground">
              review-service.ts · L143
            </p>
            {/*
              🔴 **diff 를 카드 밖으로 흘리지 않고 한 덩어리로 가둔다.** 전면으로 깔면
              색 띠가 카드를 가로질러 「여기서 단계가 끊겼다」로 읽힌다. 갇혀 있어야
              Code Evidence 마디에 «딸린» 것으로 읽힌다.
            */}
            <div className="mt-2 overflow-hidden rounded-md border border-border/60 font-mono text-[0.75rem] leading-[1.65]">
              {REMOVED_LINES.map(([lineNumber, code]) => (
                <div
                  key={lineNumber}
                  className="flex items-start gap-2.5 bg-destructive/10 px-2.5 py-1"
                >
                  <span className="w-6 shrink-0 text-right text-[0.6875rem] text-muted-foreground/70">
                    {lineNumber}
                  </span>
                  <span className="shrink-0 text-destructive">-</span>
                  <span className="whitespace-pre-wrap">{code}</span>
                </div>
              ))}
              {ADDED_LINES.map(([lineNumber, code]) => (
                <div
                  key={lineNumber}
                  className="flex items-start gap-2.5 bg-emerald-500/10 px-2.5 py-1"
                >
                  <span className="w-6 shrink-0 text-right text-[0.6875rem] text-muted-foreground/70">
                    {lineNumber}
                  </span>
                  <span className="shrink-0 text-emerald-600 dark:text-emerald-400">
                    +
                  </span>
                  <span className="whitespace-pre-wrap">{code}</span>
                </div>
              ))}
            </div>
          </div>

          {/*
            3. 🔴 **이 한 줄이 ReviewTrace 의 차별점이다.**

            다른 도구도 「고쳤다」는 남긴다. 남지 않는 것은 **왜 그것을 골랐는가**다 —
            그것이 다음 Review 에서 재사용되는 Knowledge 라 여기에 세운다.
          */}
          <div className="relative pl-11 pr-5 pt-5">
            <span className="absolute left-[1.28125rem] top-[1.5625rem] size-1.5 rounded-full bg-primary/60 ring-4 ring-card" />
            <span className="text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-muted-foreground">
              Decision
            </span>
            <p className="mt-1.5 text-[0.8125rem] leading-relaxed break-keep text-foreground/85">
              {decision}
            </p>
          </div>

          {/*
            4. 끝 마디. 🔴 **여기만 제목 줄이 없다** — 앞의 셋과 같은 모양이면 「또 한
            단계」로 읽힌다. 한 줄로 끝나야 줄기가 여기서 닫힌 것으로 읽힌다.
          */}
          <div className="relative flex items-center justify-between gap-3 pb-5 pl-11 pr-5 pt-5">
            <span className="absolute left-[1.1875rem] top-[1.5625rem] size-2.5 rounded-full bg-primary ring-4 ring-card" />
            <span className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium">
              <ShieldCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              Verified
            </span>
            <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
              commit{" "}
              <span className="font-mono text-foreground/70">a1b2c3d</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 왼쪽 소개 단의 한 줄. Icon 은 의미가 있을 때만 쓴다(CLAUDE.md 16). */
const FEATURE_ICONS: readonly ComponentType<{ className?: string }>[] = [
  FileText,
  ShieldCheck,
  TrendingUp,
];

export function LoginFeatureList({
  features,
}: {
  features: readonly { title: string; body: string }[];
}) {
  return (
    <ul className="mt-10 flex flex-col gap-6">
      {features.map((feature, index) => {
        const Icon = FEATURE_ICONS[index] ?? FileText;

        return (
          <li key={feature.title} className="flex items-start gap-4">
            <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/10">
              <Icon className="size-[1.125rem] text-primary" />
            </span>
            <div className="min-w-0">
              <p className="text-[0.9375rem] font-semibold">{feature.title}</p>
              {/*
                🔴 `break-keep` 이다. 한국어는 낱말 안에서 끊기면 읽기가 무너진다 —
                기본값은 「과정 / 을」 처럼 조사를 떼어 놓는다.
              */}
              <p className="mt-1 text-sm leading-relaxed break-keep text-muted-foreground">
                {feature.body}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
