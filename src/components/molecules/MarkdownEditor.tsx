"use client";

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { languages as codeLanguages } from "@codemirror/language-data";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import {
  Bold,
  Code,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  SquareCode,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";

import { MarkdownView } from "@/components/molecules/MarkdownView";
import { markdownCommandTransaction } from "@/components/molecules/markdown-command-transaction";
import type { MarkdownCommand } from "@/components/molecules/markdown-commands";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Markdown 원문을 «쓰는» 자리.
 *
 * ## 왜 공용 계층(molecules)인가
 *
 * `MarkdownView` 와 짝이다 — **Editor Library 를 아는 자리를 한 곳에 모은다**는 같은
 * 이유로 여기 둔다(CLAUDE.md 6). Knowledge 의 업무 의미를 하나도 갖지 않는다: 받는 것은
 * 문자열 하나이고 돌려주는 것도 문자열 하나다.
 *
 * ## 🔴 정본은 여전히 Markdown «문자열» 하나다
 *
 * ```text
 * CodeMirror  ↕  Markdown string  ->  React Hook Form  ->  Server Action  ->  PostgreSQL
 * ```
 *
 * CodeMirror 의 `EditorState` 를 별도의 데이터 모델로 삼지 않는다. 밖으로 나가는 것은
 * `doc.toString()` 이고, 들어오는 것도 문자열이다 — Editor 를 걷어내도 저장된 글은 그대로다.
 *
 * ## 🔴 Markdown 규칙은 CodeMirror 를 모른다
 *
 * Toolbar 가 부르는 것은 `markdown-commands.ts` 의 순수 함수 그대로고, CodeMirror 는
 * `markdown-command-transaction.ts` 라는 **얇은 adapter** 뒤에만 있다. 규칙을 Editor 안으로
 * 녹이면 다음에 Editor 를 바꿀 때 규칙과 그 시험을 함께 잃는다.
 *
 * ## 🔴 미리 보기는 «본문 화면과 같은 렌더러»다
 *
 * 미리 보기용 렌더러를 따로 두지 않는다 — `MarkdownView` 를 그대로 부른다.
 * 따로 만들면 화면 둘이 같은 글을 다르게 그리게 되고, `rehype-raw` 를 넣지 않는다는
 * 보증도 두 곳으로 갈라진다.
 */

/** 이 Component 가 그리는 낱말. 🔴 사전 전체를 넘기지 않는다(CLAUDE.md 11). */
export interface MarkdownEditorLabels {
  write: string;
  preview: string;
  previewEmpty: string;
  heading: string;
  bold: string;
  italic: string;
  inlineCode: string;
  codeBlock: string;
  link: string;
  bulletList: string;
  numberedList: string;
}

/** 폼이 오류가 난 칸으로 초점을 옮길 때 쓴다. React Hook Form 의 `field.ref` 가 이것을 받는다. */
export interface MarkdownEditorHandle {
  focus: () => void;
}

interface ToolbarItem {
  command: MarkdownCommand;
  icon: LucideIcon;
  label: keyof MarkdownEditorLabels;
  /** 같은 결의 버튼끼리 붙여 두고 결이 바뀌는 자리에 선을 긋는다. */
  group: number;
}

/**
 * 개발자 문서를 쓸 때 실제로 손이 가는 것만 둔다.
 *
 * 🔴 **Markdown 문법 전부를 버튼으로 만들지 않는다.** 표·각주·인용은 버튼 없이도 쓰이고,
 * 늘어놓으면 Toolbar 가 본문보다 눈에 띈다(CLAUDE.md 16).
 */
const TOOLBAR: readonly ToolbarItem[] = [
  { command: "heading", icon: Heading2, label: "heading", group: 0 },
  { command: "bold", icon: Bold, label: "bold", group: 1 },
  { command: "italic", icon: Italic, label: "italic", group: 1 },
  { command: "inlineCode", icon: Code, label: "inlineCode", group: 1 },
  { command: "codeBlock", icon: SquareCode, label: "codeBlock", group: 1 },
  { command: "link", icon: Link2, label: "link", group: 2 },
  { command: "bulletList", icon: List, label: "bulletList", group: 2 },
  { command: "numberedList", icon: ListOrdered, label: "numberedList", group: 2 },
];

/**
 * 🔴 **색을 새로 만들지 않는다.** 화면의 나머지가 쓰는 CSS 변수를 그대로 참조하므로
 * Light/Dark 는 `.dark` 가 그 변수를 바꾸는 것만으로 함께 따라온다.
 *
 * 글꼴·글자 크기·줄 높이는 아예 정하지 않고 `inherit` 로 둔다 — 바깥 wrapper 에 걸린
 * Tailwind `font-mono text-[13px] leading-6` 이 정본이다.
 */
const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "inherit",
    backgroundColor: "transparent",
  },
  // 초점 표시는 안쪽이 아니라 바깥 표면이 받는다(`focus-within:ring`).
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "inherit",
    fontSize: "inherit",
    lineHeight: "inherit",
  },
  ".cm-content": {
    padding: "0.75rem 1rem",
    caretColor: "currentColor",
  },
  ".cm-line": { padding: "0" },
  ".cm-placeholder": { color: "var(--muted-foreground)" },
});

/**
 * 🔴 **VS Code 를 만들지 않는다.** 문법 표식이 본문보다 흐리고, 무게와 기울기로 구조가
 * 읽히면 그것으로 충분하다 — 토큰마다 다른 색을 칠하면 원문이 오히려 안 읽힌다.
 * 실제로 쓰는 색은 셋뿐이다.
 *
 * ## 코드블록 안도 같은 색 셋으로 읽는다
 *
 * ```text
 * keyword          --primary            (그 언어의 «문법»)
 * string · number  --foreground         (사람이 적은 «값»)
 * comment          --muted-foreground   (가장 뒤로 물러난다)
 * 그 밖의 식별자·연산자·괄호            건드리지 않는다 — 코드 본문 색 그대로
 * ```
 *
 * 🔴 **식별자·함수·타입 이름에 색을 주지 않는다.** 이름까지 칠하면 코드블록 하나가
 * 다섯 색이 되고, 그 순간 화면에서 가장 눈에 띄는 것이 데이터가 아니라 코드 색이 된다
 * (CLAUDE.md 16). 미리 보기(`MarkdownView`)도 **같은 세 변수**를 쓴다 — 한 문서의 편집
 * 화면과 읽는 화면이 같은 것을 같은 강도로 보여야 한다.
 */
const markdownHighlight = HighlightStyle.define([
  // `#` · `-` · `**` · 백틱 같은 «표식». 본문 뒤로 물러나야 한다.
  { tag: tags.processingInstruction, color: "var(--muted-foreground)" },
  {
    tag: [
      tags.heading,
      tags.heading1,
      tags.heading2,
      tags.heading3,
      tags.heading4,
      tags.heading5,
      tags.heading6,
    ],
    fontWeight: "600",
  },
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.monospace, color: "var(--accent-foreground)" },
  { tag: [tags.url, tags.link], color: "var(--primary)" },
  { tag: tags.quote, color: "var(--muted-foreground)" },

  // 여기부터는 코드블록 «안»의 언어가 내는 토큰이다.
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
    color: "var(--muted-foreground)",
    fontStyle: "italic",
  },
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
      tags.operatorKeyword,
      tags.self,
      tags.null,
      tags.atom,
      tags.bool,
    ],
    color: "var(--primary)",
  },
  {
    tag: [
      tags.string,
      tags.special(tags.string),
      tags.character,
      tags.regexp,
      tags.number,
      tags.integer,
      tags.float,
    ],
    color: "var(--foreground)",
  },
]);

type EditorMode = "write" | "preview";

export function MarkdownEditor({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  labels,
  labelledBy,
  invalid = false,
  describedBy,
  ref,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  labels: MarkdownEditorLabels;
  /**
   * 읽어 주는 도구가 이 칸을 무엇이라 부를지. 🔴 `contenteditable` 은 `<label for>` 가
   * 걸리지 않는 요소라 `aria-labelledby` 로 이어야 한다.
   */
  labelledBy?: string;
  invalid?: boolean;
  describedBy?: string;
  ref?: Ref<MarkdownEditorHandle>;
}) {
  const [mode, setMode] = useState<EditorMode>("write");

  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const dynamicRef = useRef<Compartment | null>(null);

  /**
   * 🔴 **되울림(echo)을 막는 자리.** Editor 가 스스로 만든 글은 여기에 먼저 적히고,
   * 아래 sync effect 가 그것을 알아본다 — 같은 글을 다시 밀어 넣지 않는다.
   */
  const docRef = useRef(value);

  /** 최신 callback. 🔴 이것을 effect 의 의존성으로 두면 keystroke 마다 Editor 가 다시 생긴다. */
  const handlersRef = useRef({ onChange, onBlur });
  useEffect(() => {
    handlersRef.current = { onChange, onBlur };
  });

  useImperativeHandle(ref, () => ({ focus: () => viewRef.current?.focus() }), []);

  /**
   * Editor 는 **한 번만** 만든다.
   *
   * 🔴 의존성이 비어 있는 것이 핵심이다 — 안에서 읽는 값이 전부 ref 라 prop 이 바뀌어도
   * 다시 돌지 않는다. Strict Mode 는 이 effect 를 두 번 돌리지만, 정리 함수가 `destroy()`
   * 로 첫 Instance 를 완전히 걷어내고 ref 를 비우므로 View 도 listener 도 겹치지 않는다.
   */
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }

    const dynamic = new Compartment();
    dynamicRef.current = dynamic;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: docRef.current,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          /*
            🔴 **코드블록의 언어는 «필요해진 뒤에» 온다.** `@codemirror/language-data` 의
            `languages` 는 이름·별칭·확장자와 `load()` 뿐인 목록이고, 파서 자체는
            `load()` 안의 `import()` 로만 닿는다 — 문서에 ```sql 이 없으면
            SQL 파서는 내려받지 않는다. 그래서 목록 하나(약 32KB 원본)를 안고 130여 개
            언어를 얻는다. 언어마다 package 를 골라 넣으면 목록에 없는 언어가 곧바로
            「한 색」으로 돌아오고, package.json 에 여섯 줄이 는다(CLAUDE.md 18).
          */
          markdown({ base: markdownLanguage, codeLanguages }),
          syntaxHighlighting(markdownHighlight),
          // 긴 한 줄이 화면 밖으로 나가지 않는다 — 글을 쓰는 자리이지 코드 뷰어가 아니다.
          EditorView.lineWrapping,
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const next = update.state.doc.toString();
              if (next !== docRef.current) {
                docRef.current = next;
                handlersRef.current.onChange(next);
              }
            }
            if (update.focusChanged && !update.view.hasFocus) {
              handlersRef.current.onBlur?.();
            }
          }),
          dynamic.of([]),
        ],
      }),
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
      dynamicRef.current = null;
    };
  }, []);

  /**
   * 밖에서 값이 바뀌었을 때만 문서를 맞춘다(폼 초기화 등).
   *
   * 🔴 **`doc` 과 `value` 가 «다를 때만» dispatch 한다.** 같은 글을 다시 밀어 넣으면
   * `updateListener -> onChange -> 이 effect -> dispatch` 가 고리를 이루고, 증상은 조용하다 —
   * 커서가 튀고 한글 IME 조합이 끊긴다. 사용자가 친 글은 위에서 `docRef` 에 이미 적혔으므로
   * 여기 도달했을 때 두 값이 같아 아무 일도 하지 않는다.
   */
  useEffect(() => {
    const view = viewRef.current;
    if (view === null || view.state.doc.toString() === value) {
      docRef.current = value;
      return;
    }

    docRef.current = value;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

  /**
   * 문구·접근성 속성만 갈아 끼운다.
   *
   * 🔴 Compartment 로 바꾸는 이유가 이것이다 — 오류가 났다고 Editor 를 새로 만들면
   * 쓰던 글의 커서와 되돌리기 이력이 통째로 날아간다.
   */
  useEffect(() => {
    const view = viewRef.current;
    const dynamic = dynamicRef.current;
    if (view === null || dynamic === null) {
      return;
    }

    const attributes: Record<string, string> = {
      id,
      "aria-invalid": invalid ? "true" : "false",
    };
    if (labelledBy !== undefined) {
      attributes["aria-labelledby"] = labelledBy;
    }
    if (describedBy !== undefined) {
      attributes["aria-describedby"] = describedBy;
    }

    const next: Extension[] = [EditorView.contentAttributes.of(attributes)];
    if (placeholder !== undefined) {
      next.push(cmPlaceholder(placeholder));
    }

    view.dispatch({ effects: dynamic.reconfigure(next) });
  }, [id, invalid, labelledBy, describedBy, placeholder]);

  /** 미리 보기에 가려져 있던 동안에는 크기를 잴 수 없다 — 돌아오면 다시 재게 한다. */
  useEffect(() => {
    if (mode === "write") {
      viewRef.current?.requestMeasure();
    }
  }, [mode]);

  function runCommand(command: MarkdownCommand): void {
    const view = viewRef.current;
    if (view === null) {
      return;
    }

    // 🔴 버튼을 누르면 초점이 Editor 로 돌아와야 한다 — 누르고 바로 이어 쓸 수 있게.
    view.focus();
    view.dispatch(markdownCommandTransaction(view.state, command));
  }

  return (
    <div
      className={cn(
        // 편집기는 «덩어리»로 읽혀야 하는 것이라 올라온 표면에 둔다(CLAUDE.md 16).
        "flex flex-col overflow-hidden rounded-xl border border-input bg-card transition-colors",
        // 🔴 초점 표시는 안쪽 Editor 가 아니라 표면 전체가 받는다.
        "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        invalid && "border-destructive",
      )}
    >
      {/* 🔴 높이를 고정한다 — Toolbar 가 사라지는 미리 보기에서 줄 하나만큼 튀지 않게. */}
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/70 bg-surface-muted/60 px-2 py-1.5">
        <div className="inline-flex items-center rounded-md bg-background/70 p-0.5">
          {(["write", "preview"] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={mode === candidate}
              onClick={() => setMode(candidate)}
              className={cn(
                // 🔴 `ring-2` 였다 — 다른 모든 초점 표시가 `ring-3` 이라 여기만 얇았다.
                "rounded-[calc(var(--radius)*0.6)] px-2.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                mode === candidate
                  // 고른 쪽도 누를 수 있는 자리다 — hover 가 없으면 죽은 것처럼 읽힌다.
                  ? "bg-card text-foreground shadow-[0_1px_2px_0_oklch(0_0_0/0.06)] hover:bg-card/80"
                  : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
              )}
            >
              {candidate === "write" ? labels.write : labels.preview}
            </button>
          ))}
        </div>

        {/*
          🔴 미리 보기 중에는 Toolbar 를 두지 않는다 — 그때 누르면 보이지 않는 글이
          바뀐다. 자리를 비워 두는 대신 아예 걷어내고, 탭은 그대로 남아 돌아올 길이 보인다.
        */}
        {mode === "write" && (
          <TooltipProvider delayDuration={200}>
            {/*
              🔴 **바깥 줄만 `flex-wrap` 이면 이 묶음은 통째로 한 줄을 차지한다.**
              버튼 여덟에 구분선까지 288px 인데 390px 화면의 편집기 안쪽은 276px 이라,
              마지막 버튼이 `overflow-hidden` 에 잘려 반만 보였다. 묶음 자신도 접히게 한다.
            */}
            <div className="flex flex-wrap items-center gap-0.5">
              {TOOLBAR.map((item, index) => {
                const Icon = item.icon;
                const label = labels[item.label];
                const previous = index > 0 ? TOOLBAR[index - 1] : undefined;
                const startsGroup =
                  previous !== undefined && previous.group !== item.group;

                return (
                  <div key={item.command} className="flex items-center">
                    {startsGroup && (
                      <span
                        aria-hidden
                        className="mx-1 h-4 w-px bg-border"
                      />
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={label}
                          onClick={() => runCommand(item.command)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Icon />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{label}</TooltipContent>
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          </TooltipProvider>
        )}
      </div>

      {/*
        🔴 미리 보기로 넘어가도 Editor 를 «떼어내지» 않는다. 떼면 다시 만들어야 하고,
        그때 커서·선택·되돌리기 이력이 전부 사라진다 — 감추기만 한다.
      */}
      <div
        ref={hostRef}
        className={cn(
          "h-[55vh] min-h-96 font-mono text-[13px] leading-6",
          mode !== "write" && "hidden",
        )}
      />

      {mode === "preview" && (
        <div className="h-[55vh] min-h-96 overflow-y-auto px-4 py-3">
          {value.trim() === "" ? (
            <p className="text-xs text-muted-foreground">
              {labels.previewEmpty}
            </p>
          ) : (
            <MarkdownView content={value} emptyLabel={labels.previewEmpty} />
          )}
        </div>
      )}
    </div>
  );
}
