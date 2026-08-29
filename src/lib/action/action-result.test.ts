import { describe, expect, it } from "vitest";
import { z } from "zod";

import { actionOk, actionValidationFailed } from "@/lib/action/action-result";

/**
 * `ActionResult` 자체의 형태.
 *
 * 🔴 **문구는 여기서 만들지 않는다.** 실패를 무슨 말로 적을지는 화면 언어를 아는 자리
 * (`lib/action/action-error.ts`)가 정하고, 그 시험은 `action-error.test.ts` 에 있다 —
 * 이 파일이 순수한 채로 남아야 Client Component 가 `import type` 만으로 쓸 수 있다.
 */
describe("ActionResult", () => {
  it("성공은 데이터를 그대로 담는다", () => {
    const result = actionOk({ id: "abc" });

    expect(result.ok).toBe(true);
    expect(result.ok && result.data).toEqual({ id: "abc" });
  });

  it("Zod 실패를 필드별 메시지로 옮긴다", () => {
    const schema = z.object({
      title: z.string().min(1, "제목은 필수입니다."),
      severity: z.enum(["HIGH", "LOW"]),
    });
    const parsed = schema.safeParse({ title: "", severity: "NOPE" });

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      return;
    }

    const result = actionValidationFailed(parsed.error, "입력값이 올바르지 않습니다.");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("VALIDATION_ERROR");
    expect(result.ok === false && result.fieldErrors?.title).toEqual([
      "제목은 필수입니다.",
    ]);
    expect(result.ok === false && result.fieldErrors?.severity).toHaveLength(1);
  });
});
