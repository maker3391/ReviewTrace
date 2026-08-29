"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Claude Code · Codex 연결 안내(스펙 13).
 *
 * ## 🔴 여기에 «키를 넣어 완성된» 명령을 그리지 않는다
 *
 * 발급 화면 바로 아래라 키를 끼워 넣어 주고 싶어지지만, 그러면 **키가 화면·복사기록·
 * 스크린샷·어깨너머**로 한 번 더 퍼진다. 키가 사람 눈에 보이는 자리는 발급 직후 1회뿐이고
 * (`ApiKeyPanel`), 여기서는 언제나 `<your-api-key>` 자리표시자를 그린다(CLAUDE.md 11·19).
 *
 * 🔴 **자동 설치 버튼을 만들지 않는다.** 복사할 수 있는 명령 한 줄이면 충분하고,
 * 사용자 컴퓨터의 Client 설정을 우리가 대신 고칠 이유가 없다.
 */

interface Integration {
  key: string;
  name: string;
  /** 이 Client 가 실제로 받는 명령. 실행 가능한 형태만 적는다. */
  command: (apiUrl: string) => string;
  verify: string;
  /** 이 Client 에만 있는, 모르면 막히는 것. */
  note: string;
}

const INTEGRATIONS: readonly Integration[] = [
  {
    key: "claude-code",
    name: "Claude Code",
    command: (apiUrl) =>
      [
        "claude mcp add reviewtrace -s user \\",
        `  -e "REVIEWTRACE_API_URL=${apiUrl}" \\`,
        '  -e "REVIEWTRACE_API_KEY=<your-api-key>" \\',
        "  -- node /absolute/path/to/ReviewTrace/mcp/server.mjs",
      ].join("\n"),
    verify: "claude mcp list",
    note:
      "-s user 로 넣는다. 저장소 안의 .mcp.json 은 커밋 한 번으로 키가 새어 나가고, " +
      "user 설정을 가려 연결이 끊긴다.",
  },
  {
    key: "codex",
    name: "Codex",
    command: (apiUrl) =>
      [
        "codex mcp add reviewtrace \\",
        `  --env "REVIEWTRACE_API_URL=${apiUrl}" \\`,
        '  --env "REVIEWTRACE_API_KEY=<your-api-key>" \\',
        "  -- node /absolute/path/to/ReviewTrace/mcp/server.mjs",
      ].join("\n"),
    verify: "codex mcp get reviewtrace",
    note:
      "~/.codex/config.toml 에 [mcp_servers.*] 를 손으로 써 넣는 방식은 인식되지 않는다 — " +
      "위 명령을 써라. 기록하는 Tool 은 Codex 가 실행 전에 한 번 승인을 묻는다.",
  },
];

export function AgentIntegrationPanel({ apiUrl }: { apiUrl: string }) {
  const [selected, setSelected] = useState(INTEGRATIONS[0]!.key);
  const integration =
    INTEGRATIONS.find((item) => item.key === selected) ?? INTEGRATIONS[0]!;

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <div className="flex gap-1.5">
        {INTEGRATIONS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setSelected(item.key)}
            aria-pressed={item.key === selected}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              item.key === selected
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {item.name}
          </button>
        ))}
      </div>

      <Snippet label="1. 등록" code={integration.command(apiUrl)} />
      <Snippet label="2. 확인" code={integration.verify} />

      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {integration.note}
      </p>

      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {"<your-api-key>"} 자리에는 위에서 발급한 키를 넣는다. 🔴 그 키를 저장소 안의{" "}
        <code className="font-mono text-xs">.env</code> 에 넣지 않는다 — 그 파일은 언젠가
        커밋된다.
      </p>
    </div>
  );
}

function Snippet({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);

  /**
   * 🔴 `navigator.clipboard` 는 **없을 수 있다**(비보안 컨텍스트·권한 거부).
   * 없다고 화면이 깨지면 안 되므로, 실패하면 조용히 표시만 안 바꾼다 —
   * 코드는 화면에 그대로 있어 사람이 직접 고를 수 있다.
   */
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={copy}
          aria-label={`${label} 명령 복사`}
        >
          {copied ? (
            <Check className="size-3.5" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
          {copied ? "복사됨" : "복사"}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-lg border border-border/70 bg-surface-muted/60 px-3.5 py-3 font-mono text-xs leading-relaxed">
        {code}
      </pre>
    </div>
  );
}
