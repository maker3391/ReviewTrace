/**
 * 왼쪽 소개 단의 **맺음 한 줄** — 쓰던 Coding Agent 가 그대로 붙는다는 «사실» 하나.
 *
 * ```
 * ┌──────────────────────────────────────────────┐
 * │ 사용하는 Coding Agent와 연결됩니다   Claude Code · Codex · MCP │
 * └──────────────────────────────────────────────┘
 * ```
 *
 * ## 🔴 이것은 마디(section)가 아니라 features 의 «바닥»이다
 *
 * 앞선 모양은 `CODING AGENT 연결` 이라는 대문자 eyebrow 아래
 * `Claude Code · Codex → MCP → ReviewTrace` 를 늘어놓았다. eyebrow 는 오른쪽 카드의
 * 마디 제목과 같은 문법이라 **왼쪽 단에 마디가 하나 더 생긴 것처럼** 읽혔고, 화살표
 * 두 개는 로그인 화면이 설명할 이유가 없는 **연결 «구조»**를 그렸다.
 *
 * 그래서 제목을 없애고 **한 줄짜리 옅은 띠** 하나로 바꿨다. 띠는
 * 오른쪽 미리보기 카드의 머리 띠(`Review · codex · COMMIT · 3 Issues`)와 **같은 문법**이다
 * — 왼쪽에 이름, 오른쪽에 mono metadata, 배경은 `--surface-muted`. 같은 문법이 왼쪽 단의
 * 바닥과 오른쪽 카드의 머리에서 한 번씩 나타나므로, 이 줄이 **급조된 설명이 아니라
 * 제품 UI 의 일부**로 읽힌다.
 *
 * ## 🔴 표면 하나를 «더하는» 것이 아니라 층을 하나 «닫는» 것이다
 *
 * 왼쪽 단은 headline → subhead → features 까지 아무 표면 없이 글자만으로 내려온다.
 * 맨 아래에 페이지(`--background`)보다 한 단 밝은 면(`--surface-muted`)이 한 번 오면
 * 단이 허공에서 끝나지 않고 닫힌다. 🔴 **Card(`--card`)로 올리지 않는다** — 올리면
 * 가운데 로그인 Card·오른쪽 미리보기와 같은 층이 되어 CTA 와 시선을 다툰다.
 * 표면 세 단(page < surface-muted < card) 중 **가운데 것**이 이 자리의 값이다(CLAUDE.md 16).
 *
 * ## 🔴 사실만 적는다
 *
 * | 낱말 | 근거 |
 * |---|---|
 * | `Claude Code` · `Codex` | 둘 다 실제로 붙는다. 설정 명령이 화면에 있다(`AgentIntegrationPanel`) |
 * | `MCP` | `mcp/server.mjs` — stdio MCP Server. Tool 8종(`mcp/tools.mjs`) |
 *
 * 🔴 **없는 것을 적지 않는다.** 「모든 Agent 지원」도, 「설치 한 줄」도 쓰지 않는다 —
 * MCP Server 는 이 저장소의 파일을 절대 경로로 가리켜 쓰는 것이고 npm 배포가 없다
 * (CLAUDE.md 0). 로고를 늘어놓지도 않는다: 지금 설정 명령이 있는 것은 이 둘뿐이다.
 *
 * 🔴 **Agent 이름이 MCP 보다 진하다.** 처음 온 사람이 찾는 것은 「내 Agent 가 되는가」이고
 * MCP 는 그 답의 «수단»이다 — 셋을 같은 세기로 늘어놓으면 프로토콜 목록이 된다.
 */
export function LoginAgentSupport({ label }: { label: string }) {
  return (
    // 🔴 `max-w-[32rem]` 은 subhead 와 같은 값이다 — 왼쪽 단의 오른쪽 끝을 맞춘다.
    <div className="mt-8 flex max-w-[32rem] flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-xl border border-border/70 bg-surface-muted/50 px-4 py-3">
      {/* 🔴 대문자 eyebrow 를 쓰지 않는다 — 그것이 「마디 제목」으로 읽히던 원인이다. */}
      <p className="text-[0.8125rem] break-keep text-foreground/75">{label}</p>
      {/*
        🔴 **모바일에서 한 줄을 억지로 지키지 않는다.** `flex-wrap` 이라 좁아지면
        가운뎃점 자리에서 접힌다 — 가로 스크롤이 생기는 쪽이 훨씬 나쁘다.
      */}
      <p className="flex flex-wrap items-center gap-x-1.5 font-mono text-[0.6875rem] text-muted-foreground">
        <span className="text-foreground/75">Claude Code</span>
        <span aria-hidden="true" className="text-muted-foreground/50">
          ·
        </span>
        <span className="text-foreground/75">Codex</span>
        <span aria-hidden="true" className="text-muted-foreground/50">
          ·
        </span>
        <span>MCP</span>
      </p>
    </div>
  );
}
