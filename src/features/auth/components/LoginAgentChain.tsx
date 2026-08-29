import { ArrowRight } from "lucide-react";

/**
 * 왼쪽 소개 단의 마지막 한 줄 — **Coding Agent 가 어떻게 여기에 닿는가**.
 *
 * ```
 * Claude Code · Codex  ->  MCP  ->  ReviewTrace
 * ```
 *
 * ## 🔴 왜 이 한 줄이 필요한가
 *
 * 화면은 「왜 필요한가」(headline·features)와 「무엇이 남는가」(오른쪽 카드)를 이미
 * 말한다. 빠져 있던 것은 **연결 관계** 하나였다 — 처음 온 사람이 「내가 쓰는 Agent 가
 * 이것과 어떻게 이어지는가」를 알 방법이 없었다.
 *
 * ## 🔴 설명 문장을 쓰지 않는다
 *
 * 관계 «자체»가 설명이다. 「Model Context Protocol 을 통해 매끄럽게 연동됩니다」 같은
 * 문장은 화살표 두 개가 이미 말한 것을 길게 되풀이할 뿐이다(CLAUDE.md 16).
 *
 * ## 🔴 여기 있는 이름은 전부 실제로 도는 것이다
 *
 * | 낱말 | 근거 |
 * |---|---|
 * | `MCP` | `mcp/server.mjs` — stdio MCP Server. Tool 8종(`mcp/tools.mjs`) |
 * | `Claude Code` · `Codex` | 둘 다 실제로 붙는다. 설정 명령이 화면에 있다(`AgentIntegrationPanel`) |
 *
 * 🔴 **없는 것을 적지 않는다.** 다른 Client 로고를 늘어놓거나 「모든 Agent 지원」이라고
 * 쓰지 않는다 — 지금 설정 명령이 있는 것은 이 둘뿐이다. 반대로 MCP 가 «유일한» 길인
 * 것처럼도 쓰지 않는다: REST(`/api/v1`)도 그대로 열려 있고, 그쪽은 로그인 뒤 Settings 와
 * `docs/agent-api.md` 가 안내한다. 🔴 **첫 화면에 두 갈래를 다 그리면 이 줄이 관계가
 * 아니라 표가 된다** — 대부분이 쓰는 한 갈래만 남겼다.
 *
 * ## 🔴 이것은 새 hero 가 아니다
 *
 * headline · GitHub 버튼 · 오른쪽 카드보다 **약해야** 한다. 그래서 Card 도 배경도 색도
 * 없이 **작은 label 하나와 text 뿐**이고, 끝의 `ReviewTrace` 만 본문 색으로 서서
 * 「화살표가 향하는 곳」을 표시한다.
 */
export function LoginAgentChain({ label }: { label: string }) {
  return (
    <div className="mt-9">
      {/* 오른쪽 카드의 마디 제목과 같은 eyebrow 다 — 같은 자리값이라는 뜻이다. */}
      <p className="text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-muted-foreground">
        {label}
      </p>
      {/*
        🔴 **모바일에서 한 줄을 억지로 지키지 않는다.** `flex-wrap` 이라 좁아지면
        화살표 자리에서 자연스럽게 접힌다 — 가로 스크롤이 생기는 쪽이 훨씬 나쁘다.
      */}
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-muted-foreground">
        <span>Claude Code</span>
        <span aria-hidden="true" className="text-muted-foreground/50">
          ·
        </span>
        <span>Codex</span>
        <ArrowRight aria-hidden="true" className="size-3.5 shrink-0 opacity-60" />
        <span>MCP</span>
        <ArrowRight aria-hidden="true" className="size-3.5 shrink-0 opacity-60" />
        <span className="font-medium text-foreground">ReviewTrace</span>
      </p>
    </div>
  );
}
