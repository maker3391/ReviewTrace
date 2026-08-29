import { afterEach, describe, expect, it, vi } from "vitest";

import type { DbExecutor } from "@/db";
import {
  decideVerification,
  verifyCodeEvidence,
} from "@/features/issues/server/code-evidence-service";

/**
 * 🔴 이 시험이 지키는 것은 **「확인하지 못한 것을 확인했다고 적지 않는다」** 와,
 * 그 반대인 **「맞는데 틀렸다고 적지 않는다」** 둘 다이다.
 *
 * 되돌림 확인(2026-08-28): `read.whole` 일 때의 `includes` 를 `===` 로 되돌리면
 * 「줄 범위가 없으면 파일 안에 들어 있는지로 본다」가 실패한다. 직접 확인했다.
 *
 * 이 결함은 실제로 있었다 — 줄 범위 없이 보낸 근거가 파일 전체와 맞대어져
 * **언제나 `MISMATCH`** 로 찍혔다. 화면은 그것을 「Agent 가 거짓말했다」로 그린다.
 */
describe("decideVerification", () => {
  const file = "line1\nline2\nline3\n";

  it("GitHub 에서 못 읽었으면 UNAVAILABLE 이다 — 모르는 것을 안다고 적지 않는다", () => {
    expect(
      decideVerification({ ok: false, reason: "NOT_FOUND" }, "무엇이든"),
    ).toEqual({ verification: "UNAVAILABLE" });
  });

  it("줄 범위가 있으면 그 줄과 같은지로 본다", () => {
    expect(
      decideVerification({ ok: true, text: "line2", whole: false }, "line2"),
    ).toEqual({ verification: "VERIFIED" });

    expect(
      decideVerification({ ok: true, text: "line2", whole: false }, "line9"),
    ).toEqual({ verification: "MISMATCH" });
  });

  it("🔴 줄 범위가 없으면 파일 안에 들어 있는지로 본다", () => {
    expect(decideVerification({ ok: true, text: file, whole: true }, "line2")).toEqual(
      { verification: "VERIFIED" },
    );

    expect(
      decideVerification({ ok: true, text: file, whole: true }, "없는 줄"),
    ).toEqual({ verification: "MISMATCH" });
  });

  it("🔴 줄 범위 없이 코드도 안 보냈으면 파일 전체를 저장하지 않는다", () => {
    const result = decideVerification({ ok: true, text: file, whole: true }, null);

    expect(result.verification).toBe("VERIFIED");
    // 저장 대상은 Review Knowledge 이지 Source Code 사본이 아니다(CLAUDE.md 15).
    expect(result.snapshot).toBeUndefined();
  });

  it("줄 범위가 있는데 코드를 안 보냈으면 GitHub 것으로 채운다", () => {
    expect(
      decideVerification({ ok: true, text: "line2", whole: false }, null),
    ).toEqual({ verification: "VERIFIED", snapshot: "line2" });
  });

  it("줄 끝 공백과 줄바꿈 차이로 다르다고 하지 않는다 — 들여쓰기는 건드리지 않는다", () => {
    expect(
      decideVerification(
        { ok: true, text: "  const a = 1;  \r\n", whole: false },
        "  const a = 1;\n",
      ),
    ).toEqual({ verification: "VERIFIED" });

    // 🔴 들여쓰기는 코드에서 의미다. 다듬어 같다고 하지 않는다.
    expect(
      decideVerification(
        { ok: true, text: "  const a = 1;", whole: false },
        "const a = 1;",
      ),
    ).toEqual({ verification: "MISMATCH" });
  });
});

/**
 * 🔴 **정책 함수만 지키는 시험은 «호출 자리» 를 못 지킨다.**
 *
 * `isPublicRepository` 단위 시험 11건을 붙인 뒤 `verifyCodeEvidence` 안의
 * `if (!isPublic)` 를 `if (false)` 로 바꿔 봤더니 **전부 초록이었다** — 정책은 살아 있는데
 * 아무도 그것을 부르지 않는 상태를 시험이 잡지 못했다. 그래서 이 묶음을 더한다.
 *
 * DB 도 네트워크도 쓰지 않는다. `verifyCodeEvidence` 가 `executor` 를 받고, GitHub 은
 * `fetch` 를 갈아 끼우면 된다.
 */
describe("verifyCodeEvidence — private 저장소를 실제로 막는가", () => {
  const ORIGINAL_FETCH = globalThis.fetch;

  /** 이 함수가 실제로 쓰는 chain 만 흉내 낸다. */
  function fakeExecutor(row: Record<string, unknown>) {
    const updates: Record<string, unknown>[] = [];
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve([row]),
    };

    const executor = {
      select: () => chain,
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => {
            updates.push(values);
            return Promise.resolve(undefined);
          },
        }),
      }),
    } as unknown as DbExecutor;

    return { executor, updates };
  }

  const EVIDENCE = {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    commitSha: "a81f3c2",
    filePath: "src/a.ts",
    startLine: 1,
    endLine: 2,
    snapshot: "const a = 1;",
    provider: "GITHUB" as const,
    owner: "victim",
    name: "secret",
  };

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it("🔴 private 이면 파일을 «읽지도 않고» UNAVAILABLE 로 적는다", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn((input: unknown) => {
      const url = String(input);
      calls.push(url);
      // 저장소 조회는 private 으로 답한다.
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ private: true }),
        text: () => Promise.resolve("절대 읽히면 안 되는 코드"),
        headers: new Headers(),
      } as unknown as Response);
    }) as unknown as typeof fetch;

    const { executor, updates } = fakeExecutor(EVIDENCE);
    await verifyCodeEvidence("22222222-2222-4222-8222-222222222222", [EVIDENCE.id], executor);

    expect(updates).toHaveLength(1);
    expect(updates[0]?.verification).toBe("UNAVAILABLE");
    // 🔴 파일 내용까지 가지 않는다 — `contents/` 를 부르는 순간 이미 읽은 것이다.
    expect(calls.some((url) => url.includes("/contents/"))).toBe(false);
    // 🔴 Agent 가 보낸 snapshot 을 덮어쓰지 않는다.
    expect(updates[0]?.snapshot).toBeUndefined();
  });

  it("공개 저장소면 파일까지 읽어 판정한다", async () => {
    globalThis.fetch = vi.fn((input: unknown) => {
      const url = String(input);
      if (url.includes("/contents/")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: () => Promise.resolve("x\nconst a = 1;\ny\n"),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ private: false }),
      } as unknown as Response);
    }) as unknown as typeof fetch;

    const { executor, updates } = fakeExecutor({
      ...EVIDENCE,
      owner: "acme",
      name: "app",
      startLine: 2,
      endLine: 2,
    });
    await verifyCodeEvidence("22222222-2222-4222-8222-222222222222", [EVIDENCE.id], executor);

    expect(updates[0]?.verification).toBe("VERIFIED");
  });
});
