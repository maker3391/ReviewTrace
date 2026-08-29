import { describe, expect, it } from "vitest";
import { z } from "zod";

import { LOCALES } from "@/config/i18n";
import { issueApiKeySchema } from "@/features/api-keys/schemas/api-key";
import { inviteMemberSchema } from "@/features/invitations/schemas/invitation";
import { issueStatusUpdateSchema } from "@/features/issues/schemas/issue-status-update";
import { knowledgePageSchema } from "@/features/knowledge/schemas/knowledge-page";
import { createProjectSchema } from "@/features/projects/schemas/project";
import { reviewIngestSchema } from "@/features/reviews/schemas/review-ingest";
import { createWorkspaceSchema } from "@/features/workspaces/schemas/workspace";
import { validationErrorResponse } from "@/lib/api/agent-route";
import { VALIDATION_RULES } from "@/lib/validation/validation-rule";
import { parseOptions, validationErrorMap } from "@/lib/validation/zod-error-map";

/**
 * 입력 검증이 **화면 언어를 따라간다**는 것의 회귀 시험.
 *
 * 지키려는 것은 셋이다:
 *
 * 1. **같은 Schema · 같은 규칙**이 언어만 달리 적힌다 (Schema 에 문구가 없다)
 * 2. **의미가 뭉개지지 않는다** — 길이 같은 파라미터가 문구에 남는다
 * 3. **요청끼리 언어가 섞이지 않는다** — 전역(`z.config`)을 건드리지 않는다
 *
 * 🔴 **되돌림 확인**: `parseOptions(locale)` 를 빼고 `safeParse(value)` 로 부르면
 * 아래 「언어를 따라간다」 시험들이 실제로 **영어 기본값**을 받아 실패한다.
 */

const HANGUL = /[가-힣]/;
/** 라틴 낱말이 통째로 들어 있는가. 문구에 남는 숫자·기호는 세지 않는다. */
const LATIN_WORD = /[A-Za-z]{3,}/;

function firstMessage(error: z.ZodError | undefined): string {
  return error?.issues[0]?.message ?? "";
}

describe("validationErrorMap — 일반 규칙", () => {
  it("① KO 로 parse 하면 Zod 일반 검증이 한국어로 적힌다", () => {
    const result = createWorkspaceSchema.safeParse(
      { name: "" },
      parseOptions("ko"),
    );

    expect(result.success).toBe(false);
    expect(firstMessage(result.error)).toMatch(HANGUL);
  });

  it("② EN 으로 parse 하면 같은 규칙이 영어로 적힌다", () => {
    const result = createWorkspaceSchema.safeParse(
      { name: "" },
      parseOptions("en"),
    );

    expect(result.success).toBe(false);
    expect(firstMessage(result.error)).not.toMatch(HANGUL);
    expect(firstMessage(result.error)).toMatch(LATIN_WORD);
  });

  it("🔴 ⑤ 같은 Schema·같은 규칙을 두 언어가 «그대로» 나눠 쓴다", () => {
    const tooLong = { name: "x".repeat(101) };

    const ko = createWorkspaceSchema.safeParse(tooLong, parseOptions("ko"));
    const en = createWorkspaceSchema.safeParse(tooLong, parseOptions("en"));

    // 규칙(어느 code · 어느 path)은 같고 문구만 다르다.
    expect(ko.error?.issues[0]?.code).toBe(en.error?.issues[0]?.code);
    expect(ko.error?.issues[0]?.path).toEqual(en.error?.issues[0]?.path);
    expect(firstMessage(ko.error)).not.toBe(firstMessage(en.error));
  });

  /**
   * 🔴 **의미를 뭉개지 않는다.** 「잘못된 값입니다」로 바꾸면 사용자는 무엇을 고쳐야
   * 하는지 알 수 없다 — 상한이 두 언어의 문구에 모두 남아 있어야 한다.
   */
  it.each([
    ["ko" as const, "200"],
    ["en" as const, "200"],
  ])("🔴 %s 문구에 길이 제한 %s 가 남는다", (locale, limit) => {
    const result = knowledgePageSchema.safeParse(
      { title: "x".repeat(201) },
      parseOptions(locale),
    );

    expect(result.success).toBe(false);
    expect(firstMessage(result.error)).toContain(limit);
  });

  it.each(LOCALES)("%s — 이메일 형식 오류가 그 언어로 적힌다", (locale) => {
    const result = inviteMemberSchema.safeParse(
      { email: "nope" },
      parseOptions(locale),
    );

    expect(result.success).toBe(false);
    expect(HANGUL.test(firstMessage(result.error))).toBe(locale === "ko");
  });
});

describe("validationErrorMap — ReviewTrace 고유 규칙", () => {
  it("③ 저장할 수 없는 문자를 KO 로 알려 준다", () => {
    const result = knowledgePageSchema.safeParse(
      { title: "제목", content: "본문\u0000" },
      parseOptions("ko"),
    );

    expect(result.success).toBe(false);
    expect(firstMessage(result.error)).toMatch(HANGUL);
  });

  it("④ 같은 규칙을 EN 으로도 알려 준다", () => {
    const result = knowledgePageSchema.safeParse(
      { title: "Title", content: "body\u0000" },
      parseOptions("en"),
    );

    expect(result.success).toBe(false);
    expect(firstMessage(result.error)).not.toMatch(HANGUL);
    expect(firstMessage(result.error)).toMatch(LATIN_WORD);
  });

  /**
   * 🔴 `resolved = true` 만 저장하지 않는다(CLAUDE.md 2). 이 규칙은 화면
   * (`IssueStatusControl`)과 Agent API 가 **같은 Schema** 로 함께 쓴다.
   */
  it.each(LOCALES)(
    "%s — RESOLVED 인데 해결 요약이 없으면 그 언어로 거절한다",
    (locale) => {
      const result = issueStatusUpdateSchema.safeParse(
        { status: "RESOLVED" },
        parseOptions(locale),
      );

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(["resolutionSummary"]);
      expect(HANGUL.test(firstMessage(result.error))).toBe(locale === "ko");
    },
  );

  it("Agent 전용 규칙도 두 언어를 갖는다 — fullName 이 owner/name 과 다르다", () => {
    const payload = {
      repository: {
        provider: "GITHUB",
        owner: "acme",
        name: "app",
        fullName: "other/app",
      },
      target: { type: "COMMIT" },
      reviewer: { type: "AGENT", name: "codex" },
      issues: [],
    };

    for (const locale of LOCALES) {
      const result = reviewIngestSchema.safeParse(payload, parseOptions(locale));
      const message =
        result.error?.issues.find((issue) => issue.path.includes("fullName"))
          ?.message ?? "";

      expect(result.success).toBe(false);
      expect(HANGUL.test(message)).toBe(locale === "ko");
    }
  });

  it("🔴 규칙 이름은 두 언어 모두 문구를 갖는다", () => {
    for (const locale of LOCALES) {
      const map = validationErrorMap(locale);
      for (const name of VALIDATION_RULES) {
        const message = map({
          code: "custom",
          path: [],
          input: undefined,
          params: { rule: name },
        } as unknown as z.core.$ZodRawIssue);

        expect(message, `${locale}.${name}`).toBeTruthy();
      }
    }
  });
});

describe("🔴 전역을 건드리지 않는다", () => {
  it("⑥ parse 를 해도 z.config().localeError 가 그대로다", () => {
    const before = z.config().localeError;

    createProjectSchema.safeParse({ name: "" }, parseOptions("ko"));
    issueApiKeySchema.safeParse({ name: "" }, parseOptions("en"));

    expect(z.config().localeError).toBe(before);
  });

  /**
   * 🔴 **동시 요청이 서로의 언어를 바꿀 수 없다는 근거.**
   *
   * 언어는 parse 인자에만 실려 가므로, KO parse 와 EN parse 를 번갈아 돌려도 각자의
   * 결과가 유지된다. 그리고 아무것도 넘기지 않은 parse 는 **Zod 기본값(영어)** 그대로다 —
   * 어느 요청도 다음 요청의 기본값을 바꾸지 못한다.
   */
  it("⑥ 언어를 번갈아 parse 해도 서로에게 남지 않는다", () => {
    const empty = { name: "" };

    const ko = createWorkspaceSchema.safeParse(empty, parseOptions("ko"));
    const en = createWorkspaceSchema.safeParse(empty, parseOptions("en"));
    const koAgain = createWorkspaceSchema.safeParse(empty, parseOptions("ko"));
    const bare = createWorkspaceSchema.safeParse(empty);

    expect(firstMessage(ko.error)).toBe(firstMessage(koAgain.error));
    expect(firstMessage(en.error)).not.toBe(firstMessage(ko.error));
    expect(firstMessage(bare.error)).not.toMatch(HANGUL);
  });
});

describe("🔴 API 계약은 그대로다", () => {
  /**
   * ⑫ Agent API 는 사람이 아니라 기계가 읽는다. 응답에는 **어느 자리가 틀렸는지**만
   * 담기고 Zod 문구는 애초에 실리지 않는다 — 그래서 화면 언어와 무관하다(CLAUDE.md 13).
   */
  it("Agent 응답에는 Zod 문구가 실리지 않고 path 만 남는다", async () => {
    const failed = createProjectSchema.safeParse(
      { name: "" },
      parseOptions("ko"),
    );
    if (failed.success) {
      throw new Error("검증이 실패해야 한다");
    }

    const response = validationErrorResponse(failed.error);
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };

    expect(response.status).toBe(400);
    expect(Object.keys(body.error)).toEqual(["code", "message"]);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("name");
    expect(body.error.message).not.toContain(firstMessage(failed.error));
  });

  it("issue 의 code·path 는 언어와 무관하다", () => {
    const koIssues = knowledgePageSchema.safeParse(
      { title: "" },
      parseOptions("ko"),
    ).error?.issues;
    const enIssues = knowledgePageSchema.safeParse(
      { title: "" },
      parseOptions("en"),
    ).error?.issues;

    expect(koIssues?.map((issue) => [issue.code, issue.path])).toEqual(
      enIssues?.map((issue) => [issue.code, issue.path]),
    );
  });
});
