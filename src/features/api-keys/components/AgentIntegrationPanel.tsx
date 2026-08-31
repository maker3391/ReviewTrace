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
  key: IntegrationKey;
  name: string;
  /** 이 Client 가 실제로 받는 명령. 실행 가능한 형태만 적는다. */
  command: (apiUrl: string) => string;
  verify: string;
}

/**
 * 🔴 **명령은 여기, 문구는 사전에.**
 *
 * 명령줄은 언어와 무관한 «실행되는 것»이라 옮기면 동작이 달라진다. 반대로 「모르면
 * 막히는 것」을 알려 주는 문장은 화면 언어를 따라야 한다 — 그래서 note 는 이 표에서
 * 빼고 `labels.note` 로 받는다(CLAUDE.md 11).
 */
type IntegrationKey = "claude-code" | "codex";

/** 🔴 이 화면이 실제로 그리는 낱말만 받는다. */
export interface IntegrationLabels {
  step1: string;
  step2: string;
  /**
   * 🔴 **함수를 받지 않는다.** Server Component 가 Client Component 에 함수를 넘기면
   * 「Functions cannot be passed directly to Client Components」로 **렌더가 통째로
   * 실패한다** — 실제로 Settings 화면 전체가 그렇게 떨어졌다. 사전의 함수형 문구는
   * **서버에서 미리 완성해** 문자열로 건넨다.
   */
  copyCommand: { step1: string; step2: string };
  copy: string;
  copied: string;
  note: Record<IntegrationKey, string>;
  keyHint: string;
  keyHintTail: string;
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
  },
];

export function AgentIntegrationPanel({
  apiUrl,
  labels,
}: {
  apiUrl: string;
  labels: IntegrationLabels;
}) {
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
                // 고른 쪽도 누를 수 있는 자리다. Button default variant 와 같은 hover 다.
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {item.name}
          </button>
        ))}
      </div>

      <Snippet
        label={labels.step1}
        copyAriaLabel={labels.copyCommand.step1}
        code={integration.command(apiUrl)}
        labels={labels}
      />
      <Snippet
        label={labels.step2}
        copyAriaLabel={labels.copyCommand.step2}
        code={integration.verify}
        labels={labels}
      />

      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {labels.note[integration.key]}
      </p>

      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {"<your-api-key>"}
        {labels.keyHint}
        <code className="font-mono text-xs">.env</code>
        {labels.keyHintTail}
      </p>
    </div>
  );
}

function Snippet({
  label,
  copyAriaLabel,
  code,
  labels,
}: {
  label: string;
  copyAriaLabel: string;
  code: string;
  labels: IntegrationLabels;
}) {
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
          aria-label={copyAriaLabel}
        >
          {copied ? (
            <Check className="size-3.5" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
          {copied ? labels.copied : labels.copy}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-lg border border-border/70 bg-surface-muted/60 px-3.5 py-3 font-mono text-xs leading-relaxed">
        {code}
      </pre>
    </div>
  );
}
