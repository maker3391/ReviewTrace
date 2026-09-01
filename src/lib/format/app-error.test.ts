import { describe, expect, it } from "vitest";

import { en } from "@/config/messages/en";
import { ko } from "@/config/messages/ko";
import { LOCALES, messages } from "@/config/i18n";
import {
  knowledgePageSchema,
  resolveKnowledgePageInput,
} from "@/features/knowledge/schemas/knowledge-page";
import {
  createProjectSchema,
  resolveProjectInput,
} from "@/features/projects/schemas/project";
import { statusForErrorCode } from "@/lib/api/error-response";
import {
  APP_ERROR_REASONS,
  AppError,
  errorCodeForReason,
  toPublicError,
  type AppErrorMessages,
} from "@/lib/errors";
import { localizedPublicError } from "@/lib/format/app-error";

/**
 * Application 오류가 **화면 언어를 따라간다**는 것의 회귀 시험.
 *
 * 지키려는 것은 넷이다:
 *
 * 1. **의미와 문구가 갈려 있다** — Service 는 `reason` 만 던지고 문구는 사전이 갖는다
 * 2. **`code` 는 언어를 타지 않는다** — 화면이 무슨 말을 하든 계약은 그대로다
 * 3. **번역이 빠지면 컴파일이 깨진다** — 조용히 일반 문구로 떨어지지 않는다
 * 4. **HTTP Status 가 그대로다** — reason 이 늘어도 400/404/409 는 움직이지 않는다
 *
 * 🔴 **되돌림 확인(2026-08-29)**: `config/messages/en.ts` 의 `errors` 를 통째로 지우면
 * `pnpm typecheck` 가 먼저 깨지고, `en.errors.PROJECT_NOT_FOUND` 만 한국어로 되돌리면
 * ② 가 실제로 실패한다 — 직접 돌려 봤고 되돌렸다.
 */

const HANGUL = /[가-힣]/;
const LATIN_WORD = /[A-Za-z]{3,}/;

function line(error: unknown, locale: "ko" | "en"): string {
  return localizedPublicError(error, messages(locale).errors).message;
}

describe("localizedPublicError — 같은 오류를 두 언어가 나눠 쓴다", () => {
  /**
   * 🔴 **「한국어인가」만 보지 않는다.** 그것만 보면 모든 오류를 일반 문구
   * (「오류가 발생했습니다」)로 뭉개도 시험이 통과한다 — 실제로 그렇게 되돌려 봤고,
   * 그래서 **그 오류의 문구인지**까지 본다. 낱말 자체는 사전에서 가져와 비교하므로
   * 문구를 다듬어도 시험이 깨지지 않는다.
   */
  it("① KO 사전이면 그 오류의 한국어 문구가 나온다", () => {
    const message = line(new AppError("PROJECT_SLUG_TAKEN"), "ko");

    expect(message).toBe(ko.errors.PROJECT_SLUG_TAKEN);
    expect(message).not.toBe(ko.errors.UNEXPECTED);
    expect(message).toMatch(HANGUL);
  });

  it("② EN 사전이면 같은 오류가 영어로 나온다", () => {
    const message = line(new AppError("PROJECT_SLUG_TAKEN"), "en");

    expect(message).toBe(en.errors.PROJECT_SLUG_TAKEN);
    expect(message).not.toBe(en.errors.UNEXPECTED);
    expect(message).not.toMatch(HANGUL);
    expect(message).toMatch(LATIN_WORD);
  });

  /**
   * 🔴 **code 는 계약이고 message 는 화면이다.** 둘이 함께 흔들리면 화면 언어를 바꾼
   * 것만으로 「이 실패는 404 인가 409 인가」가 달라 보인다.
   */
  it("③ 언어가 달라도 code 는 같다", () => {
    for (const reason of APP_ERROR_REASONS) {
      // 🔴 캐스트는 TypeScript 한계를 비켜 갈 뿐이다 — 사유는
      //    `errors.architecture.test.ts` 의 `errorFor` 주석에 적어 두었다.
      const error =
        reason === "PROJECT_SLUG_RESERVED" ||
        reason === "KNOWLEDGE_PAGE_SLUG_RESERVED"
          ? new AppError(reason, { meta: { slug: "new" } })
          : new AppError(reason as "UNEXPECTED");

      const koResult = localizedPublicError(error, ko.errors);
      const enResult = localizedPublicError(error, en.errors);

      expect(enResult.code, reason).toBe(koResult.code);
      expect(enResult.message, reason).not.toBe("");
    }
  });

  it("④ 값이 들어가는 문장을 KO 가 만든다 — Application 이 잇지 않는다", () => {
    const error = new AppError("PROJECT_SLUG_RESERVED", {
      meta: { slug: "settings" },
    });

    expect(error.message).toBe("PROJECT_SLUG_RESERVED");
    expect(line(error, "ko")).toContain("settings");
    expect(line(error, "ko")).toMatch(HANGUL);
  });

  it("⑤ 같은 값이 EN 문장에도 그대로 들어간다", () => {
    const error = new AppError("KNOWLEDGE_PAGE_SLUG_RESERVED", {
      meta: { slug: "edit" },
    });

    expect(line(error, "en")).toContain("edit");
    expect(line(error, "en")).not.toMatch(HANGUL);
  });

  it("⑥ 알 수 없는 오류는 일반 문구다 — 원본을 흘리지 않는다", () => {
    const leaky = new Error(
      'connect ECONNREFUSED postgres://user:secret@127.0.0.1:5432 — select "key_hash"',
    );

    for (const locale of LOCALES) {
      const result = localizedPublicError(leaky, messages(locale).errors);

      expect(result.code).toBe("INTERNAL_ERROR");
      expect(result.message).toBe(messages(locale).errors.UNEXPECTED);
      expect(result.message).not.toContain("secret");
      expect(result.message).not.toContain("postgres://");
    }
  });
});

describe("⑦ 번역이 빠질 자리가 없다", () => {
  /**
   * 타입(`satisfies AppErrorMessages`)이 이미 잡지만, 여기서는 **실제 목록**으로 다시
   * 확인한다 — `Record` 를 손으로 풀어 쓴 자리까지 본다(`messages.test.ts` 와 같은 방식).
   */
  it.each([...LOCALES])("%s 사전이 모든 오류를 덮는다", (locale) => {
    const dictionary = messages(locale).errors as Record<string, unknown>;

    for (const reason of APP_ERROR_REASONS) {
      const entry = dictionary[reason];
      expect(["string", "function"], reason).toContain(typeof entry);
      if (typeof entry === "string") {
        expect(entry.length, reason).toBeGreaterThan(0);
      }
    }
  });

  it("사전에 남는 자리가 없다 — 쓰이지 않는 문구를 쌓아 두지 않는다", () => {
    expect(Object.keys(ko.errors).sort()).toEqual(
      [...APP_ERROR_REASONS].sort(),
    );
    expect(Object.keys(en.errors).sort()).toEqual(
      [...APP_ERROR_REASONS].sort(),
    );
  });

  /**
   * 🔴 **빠진 것이 조용히 일반 문구로 떨어지면 번역 누락을 영영 못 찾는다**(스펙 11).
   * 타입을 우회해야만 닿는 자리지만, 닿았을 때 개발·시험에서는 소리가 나야 한다.
   */
  it("🔴 사전에 없는 오류는 개발·시험에서 조용히 넘어가지 않는다", () => {
    const holed = { ...ko.errors } as Record<string, unknown>;
    delete holed.PROJECT_NOT_FOUND;

    expect(() =>
      localizedPublicError(
        new AppError("PROJECT_NOT_FOUND"),
        holed as unknown as AppErrorMessages,
      ),
    ).toThrow(/PROJECT_NOT_FOUND/);
  });
});

describe("⑪ HTTP Status 는 그대로다", () => {
  /**
   * 🔴 **reason 은 화면 문구를 가르는 이름일 뿐 Status 를 바꿀 이유가 아니다.**
   * 이름을 스물 몇 개로 늘렸어도 밖으로 나가는 등급은 여섯 개 그대로다.
   */
  it("모든 reason 이 여섯 등급 안에서만 논다", () => {
    const statuses = new Set(
      APP_ERROR_REASONS.map((reason) =>
        statusForErrorCode(errorCodeForReason(reason)),
      ),
    );

    expect([...statuses].sort()).toEqual([400, 401, 404, 409, 500]);
  });

  it("의미별 등급이 지금 그대로다", () => {
    const expected: Record<string, number> = {
      UNEXPECTED: 500,
      RESOURCE_NOT_FOUND: 404,
      AGENT_UNAUTHORIZED: 401,
      AGENT_BODY_NOT_JSON: 400,
      AGENT_BODY_UNSTORABLE_TEXT: 400,
      AGENT_IDEMPOTENCY_KEY_TOO_LONG: 400,
      API_KEY_NAME_INVALID: 400,
      PROJECT_SLUG_RESERVED: 400,
      PROJECT_SLUG_TAKEN: 409,
      PROJECT_NAME_TAKEN: 409,
      PROJECT_NOT_FOUND: 404,
      MOVE_TARGET_PROJECT_NOT_FOUND: 404,
      REPOSITORY_NOT_FOUND: 404,
      KNOWLEDGE_PAGE_SLUG_RESERVED: 400,
      KNOWLEDGE_PAGE_SLUG_TAKEN: 409,
      KNOWLEDGE_PAGE_NOT_FOUND: 404,
      INVITATION_UNUSABLE: 404,
      INVITATION_NOT_CANCELABLE: 404,
      INVITATION_ALREADY_PENDING: 409,
      WORKSPACE_MEMBER_ALREADY: 409,
      WORKSPACE_MEMBER_NOT_FOUND: 404,
      WORKSPACE_NAME_REQUIRED: 400,
      WORKSPACE_NAME_UNUSABLE: 409,
      WORKSPACE_LAST_OWNER: 409,
      PERSONAL_WORKSPACE_ROLE_FIXED: 409,
      WORKSPACE_SELF_REMOVE: 409,
      PERSONAL_WORKSPACE_OWNER_FIXED: 409,
      WORKSPACE_NOT_FOUND: 404,
      WORKSPACE_OWNER_REQUIRED: 404,
      PERSONAL_WORKSPACE_UNDELETABLE: 409,
      WORKSPACE_HAS_MEMBERS: 409,
      ACCOUNT_NOT_FOUND: 404,
      ACCOUNT_LAST_OWNER: 409,
      WORKSPACE_SLUG_RELEASE_FAILED: 409,
    };

    for (const reason of APP_ERROR_REASONS) {
      expect(statusForErrorCode(errorCodeForReason(reason)), reason).toBe(
        expected[reason],
      );
    }
    expect(Object.keys(expected).sort()).toEqual([...APP_ERROR_REASONS].sort());
  });
});

describe("⑫ Schema 도 문구가 아니라 이름을 돌려준다", () => {
  /**
   * 🔴 예전에는 `{ ok: false, reason: "'new' 는 … 쓸 수 없습니다." }` 였다 —
   * Schema 가 화면의 말을 갖고 있었고, 그것이 EN 화면에 한국어로 그대로 떴다.
   */
  it("resolveProjectInput 은 안정적인 이름과 값만 돌려준다", () => {
    const parsed = createProjectSchema.parse({ name: "Settings" });
    const resolved = resolveProjectInput(parsed);

    expect(resolved.ok).toBe(false);
    if (resolved.ok) {
      return;
    }

    expect(resolved.reason).toBe("RESERVED_SLUG");
    expect(resolved.slug).toBe("settings");
    expect(JSON.stringify(resolved)).not.toMatch(HANGUL);
  });

  it("resolveKnowledgePageInput 도 같다", () => {
    const parsed = knowledgePageSchema.parse({ title: "New" });
    const resolved = resolveKnowledgePageInput(parsed);

    expect(resolved.ok).toBe(false);
    if (resolved.ok) {
      return;
    }

    expect(resolved.reason).toBe("RESERVED_SLUG");
    expect(resolved.slug).toBe("new");
    expect(JSON.stringify(resolved)).not.toMatch(HANGUL);
  });
});

describe("🔴 옛 방식이 되살아날 자리를 타입이 막는다", () => {
  it("한국어 문구를 AppError 에 넣을 수 없다", () => {
    // @ts-expect-error 두 번째 자리는 객체다 — 문구를 넣을 수 없다.
    void new AppError("PROJECT_NOT_FOUND", "Project 를 찾을 수 없습니다.");
    // @ts-expect-error 사전에 없는 오류를 지어낼 수 없다.
    void new AppError("문서를 찾을 수 없습니다.");
    // @ts-expect-error Transport 등급은 reason 이 아니다.
    void new AppError("NOT_FOUND");
    // @ts-expect-error 값이 필요한 오류는 값 없이 만들 수 없다.
    void new AppError("PROJECT_SLUG_RESERVED");
    // @ts-expect-error 값이 필요 없는 오류에 값을 넘길 수 없다.
    void new AppError("PROJECT_NOT_FOUND", { meta: { slug: "x" } });

    expect(true).toBe(true);
  });

  /** 🔴 화면용 문구가 Agent 응답으로 새어 나가는 길이 없다는 것도 타입이 잡는다. */
  it("toPublicError 는 사전을 받지 않는다", () => {
    // @ts-expect-error 언어를 넘길 자리가 없다 — 그것이 「기계 계약은 언어를 타지 않는다」다.
    void toPublicError(new AppError("PROJECT_NOT_FOUND"), ko.errors);

    expect(toPublicError(new AppError("PROJECT_NOT_FOUND")).code).toBe(
      "NOT_FOUND",
    );
  });
});
