/**
 * 왼쪽 소개 단의 **맺음 한 줄** — 쓰던 Coding Agent 가 그대로 붙는다는 «사실» 하나.
 *
 * ```
 * ┌──────────────────────────────────────────────────┐
 * │ Coding Agent 연동 [Claude Code] [Codex] │ MCP │
 * └──────────────────────────────────────────────────┘
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
 * — 왼쪽에 이름, 오른쪽에 metadata, 배경은 `--surface-muted`. 같은 문법이 왼쪽 단의
 * 바닥과 오른쪽 카드의 머리에서 한 번씩 나타나므로, 이 줄이 **급조된 설명이 아니라
 * 제품 UI 의 일부**로 읽힌다.
 *
 * ## 🔴 표면 하나를 «더하는» 것이 아니라 층을 하나 «닫는» 것이다
 *
 * 왼쪽 단은 headline → subhead → features 까지 아무 표면 없이 글자만으로 내려온다.
 * 맨 아래에 페이지(`--background`)보다 한 단 밝은 면(`--surface-muted`)이 한 번 오면
 * 단이 허공에서 끝나지 않고 닫힌다. 🔴 **Card(`--card`)로 올리지 않는다** — 올리면
 * 가운데 로그인 Card·오른쪽 미리보기와 같은 층이 되어 CTA 와 시선을 다툰다.
 * 표면 세 단(page < surface-muted < card) 중 **가운데 것**이 이 자리의 값이다.
 *
 * ## 🔴 Agent 는 «항목»이고 MCP 는 그 항목이 아니다
 *
 * 셋을 `Claude Code · Codex · MCP` 로 늘어놓으면 **가운뎃점이 셋을 같은 종류로 묶는다** —
 * 읽는 사람에게는 「지원 목록 세 개」이고, 그중 하나가 프로토콜이라는 사실이 사라진다.
 *
 * | | 무엇 | 이 띠에서의 모양 |
 * |---|---|---|
 * | `Claude Code` · `Codex` | **Coding Agent** — 실제로 붙는 대상 | 옅은 면 위의 작은 tile · 본문 글꼴 |
 * | `MCP` | **Protocol** — 그 붙음이 지나는 길 | 면 없는 mono 글자 · 세로선 뒤 |
 *
 * 가운뎃점 대신 **세로선**을 쓴 것이 그 판단의 전부다. 가운뎃점은 「그리고」이고
 * 세로선은 「범주가 바뀐다」다 — 낱말을 더하지 않고 둘을 가른다.
 * 🔴 **「via MCP」 같은 설명 문구를 새로 만들지 않는다.** 로그인 화면이 답할 것은
 * 「쓰던 Agent 가 붙는가」까지이고, 경로 설명은 Settings 와 `docs/agent-integration.md`
 * 의 몫이다.
 *
 * ## 🔴 마크는 붙이되 «아무 아이콘»으로 대신하지 않는다
 *
 * Agent 이름을 그림으로 알아보게 하려면 **그 제품의 마크**여야 한다. 🔴 아무 Lucide
 * 아이콘(`Bot`·`Terminal`·`Plug` 따위)을 골라 그 자리에 세우지 않는다 — **그것이 그
 * 제품의 표식인 것처럼** 읽혀, 없는 것을 있는 것처럼 그리는 일이 된다.
 *
 * 세 마크는 `AgentMarks` 한 파일에 모아 두었다. 🔴 **출처와 라이선스, 특히 Codex 마크가
 * 공식 배포가 아니라는 사실이 그 파일 머리에 적혀 있다** — 읽고 나서 손대라.
 *
 * 🔴 **마크가 글자를 대신하지 않는다.** 이름을 지우고 마크만 남기면 모르는 사람은
 * 무엇인지 알 수 없고, 마크가 뜨지 않는 순간(차단·로드 실패) 자리가 빈다.
 *
 * ## 🔴 사실만 적는다 · CTA 보다 세지 않는다
 *
 * | 낱말 | 근거 |
 * |---|---|
 * | `Claude Code` · `Codex` | 둘 다 실제로 붙는다. 설정 명령이 화면에 있다(`AgentIntegrationPanel`) |
 * | `MCP` | `mcp/server.mjs` — stdio MCP Server. Tool 8종(`mcp/tools.mjs`) |
 *
 * 🔴 **없는 것을 적지 않는다.** 「공식 파트너십」도 「native integration」도 「모든 Agent
 * 지원」도 쓰지 않는다 — 우리가 하는 일은 MCP Server 를 두고 그것을 사용자가 자기 Agent 에
 * 등록하는 것까지다. MCP Server 는 이 저장소의 파일을 절대 경로로 가리켜 쓰는 것이고
 * npm 배포가 없다.
 *
 * 🔴 **tile 이 버튼으로 읽히면 안 된다.** 그래서 테두리도 그림자도 hover 도 주지 않고
 * **배경 톤 차이 하나로만** 세운다 — 모든 요소에 테두리를 두르지 않는다.
 * 11px 글자에 면만 깔린 tile 은 이 페이지의 유일한 CTA(가운데 카드의 GitHub 버튼 —
 * 진한 solid · 카드 층 · 훨씬 큰 글자)와 시선을 다투지 못한다.
 */

import {
  ClaudeCodeMark,
  CodexMark,
  McpMark,
} from "@/features/auth/components/AgentMarks";

/** 🔴 실제로 설정 명령이 있는 Client 둘뿐이다(`AgentIntegrationPanel`). */
const AGENTS = [
  { name: "Claude Code", Mark: ClaudeCodeMark },
  { name: "Codex", Mark: CodexMark },
];

export function LoginAgentSupport({ label }: { label: string }) {
  return (
    // 🔴 `max-w-[32rem]` 은 subhead 와 같은 값이다 — 소개 단의 오른쪽 끝을 맞춘다.
    //
    // 🔴 **`order-3` 은 모바일(< 640) 전용이다.** 그 폭에서는 소개 `<section>` 이
    // `display: contents` 로 풀려 이 띠가 grid 항목이 되고, 「소개 -> 로그인 CTA -> 연동」
    // 순서의 «마지막»에 선다. 640 이상에서는 다시 section 안의 block 이라 `order` 가 아무
    // 일도 하지 않고, 이 띠는 지금처럼 소개 단의 바닥이다.
    //
    // 🔴 **위 여백이 폭마다 다르다.** 640 이상에서는 features 바로 아래라 `mt-8` 이 맞고,
    // 모바일에서는 위에 오는 것이 로그인 카드라 층이 바뀐다 — 같은 32px 이면 CTA 에 딸린
    // 부속처럼 붙어 읽힌다.
    <div className="order-3 mt-12 flex max-w-[32rem] flex-wrap items-center justify-between gap-x-4 gap-y-2.5 rounded-xl border border-border/70 bg-surface-muted/50 px-4 py-3 sm:mt-8">
      {/* 🔴 대문자 eyebrow 를 쓰지 않는다 — 그것이 「마디 제목」으로 읽히던 원인이다. */}
      <p className="text-[0.8125rem] break-keep text-foreground/75">{label}</p>

      {/*
 🔴 **모바일에서 한 줄을 억지로 지키지 않는다.** `flex-wrap` 이라 좁아지면
 tile 사이에서 접힌다 — 가로 스크롤이 생기는 쪽이 훨씬 나쁘다.
 */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
        {AGENTS.map(({ name, Mark }) => (
          <span
            key={name}
            className="inline-flex items-center gap-1.5 rounded-md bg-background px-2 py-1 text-[0.6875rem] leading-none font-medium tracking-[-0.01em] whitespace-nowrap text-foreground/85"
          >
            {/*
 🔴 **`size-3.5` 는 11px 글자보다 «조금» 크다.** 같은 크기로 맞추면 마크가
 글자에 눌려 무엇인지 알아볼 수 없고, 더 키우면 tile 이 아이콘 버튼처럼
 읽힌다. `shrink-0` 이라 줄이 접혀도 마크가 찌그러지지 않는다.
 */}
            <Mark className="size-3.5 shrink-0" />
            {name}
          </span>
        ))}

        {/*
 🔴 **가운뎃점이 아니라 세로선이다.** Agent 목록이 여기서 끝나고 다음 것은
 같은 종류가 아니라는 표시다 — 위 표 참고.
 */}
        <span
          aria-hidden="true"
          className="mx-1 h-3.5 w-px shrink-0 bg-border"
        />

        {/*
 🔴 mono 는 「프로토콜 이름」의 글꼴이다. 면을 깔지 않아 Agent tile 과 갈린다 —
 **마크가 붙어도 그 구분은 그대로다.** 색도 한 단 흐린 `muted-foreground` 라
 Agent 둘보다 뒤에 선다.
 */}
        <span className="inline-flex items-center gap-1.5 font-mono text-[0.6875rem] leading-none text-muted-foreground">
          <McpMark className="size-3.5 shrink-0" />
          MCP
        </span>
      </div>
    </div>
  );
}
