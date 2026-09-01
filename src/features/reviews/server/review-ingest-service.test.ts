import { describe, expect, it } from "vitest";

import { fakeExecutor, selects } from "@/db/testing/fake-executor";
import { reviewIngestSchema } from "@/features/reviews/schemas/review-ingest";
import { ingestReview } from "@/features/reviews/server/review-ingest-service";

/**
 * Review 수집의 **순서 규칙** — Database 없이 돈다.
 *
 * ## 🔴 여기서 보는 것은 «무엇을 언제 부르는가» 다
 *
 * `fakeExecutor` 는 `where` 를 해석하지 않으므로 Tenant 조건이 옳은지·재전송이 실제로
 * 걸리는지는 여기서 증명되지 않는다(그것은 `scripts/agent-api-e2e.sh` 와 통합시험의 몫이다).
 * 이 파일이 붙드는 것은 하나뿐이다 —
 * **재전송이면 쓰기 문장이 «한 개도» 나가지 않는다.**
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const REPOSITORY = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";
const ISSUE = "44444444-4444-4444-8444-444444444444";
/** 같은 문제를 **처음** 발견했던 Session. 다시 보고돼도 행은 여기 남는다. */
const EARLIER_SESSION = "55555555-5555-4555-8555-555555555555";
const KNOWN_ISSUE = "66666666-6666-4666-8666-666666666666";
const STRANGER_ISSUE = "77777777-7777-4777-8777-777777777777";

/** 실제 Route 가 넘기는 것과 같은 형태 — Schema 를 통과시킨 값이다. */
function payload(projectSlug: string, defaultBranch: string) {
  return reviewIngestSchema.parse({
    project: { slug: projectSlug },
    repository: {
      provider: "GITHUB",
      externalRepositoryId: "100",
      owner: "acme",
      name: "app",
      fullName: "acme/app",
      defaultBranch,
    },
    target: { type: "COMMIT", commitSha: "a81f3c2" },
    reviewer: { type: "AGENT", name: "codex" },
    summary: "요약",
    issues: [],
  });
}

describe("ingestReview — 재전송 판정 순서", () => {
  /**
   * # 🔴 재전송이면 아무것도 새로 쓰지 않는다
   *
   * ## 무엇이 깨져 있었는가
   *
   * 판정 순서가 **Project 생성 · Repository 갱신 -> 재전송 확인** 이었다. 재전송은 정상
   * return 이라 Transaction 이 그대로 commit 되므로, 같은 `Idempotency-Key` 에 다른
   * `project.slug` 나 다른 `defaultBranch` 를 실어 보내면 응답은 `200/idempotentReplay=true`
   * 인데 **Project 가 새로 생기고 Repository metadata 가 바뀌었다.**
   *
   * 「200 이면 아무것도 새로 쓰지 않았다」는 Agent API 가 밖에 내건 계약이다
   * (`app/api/v1/reviews/route.ts`). 그것이 거짓이면 Agent 는 재전송을 안전한 동작으로
   * 믿을 수 없게 된다.
   *
   * ## 무엇을 붙들어 두는가
   *
   * **오간 문장이 전부 `select` 라는 것.** `findIngestRepository` 를 앞에 두는 대신
   * `resolveIngestProject`·`resolveIngestRepository` 를 먼저 부르는 코드로 되돌리면
   * `insert`/`update` 가 섞여 들어와 이 시험이 빨개진다.
   */
  it("🔴 같은 Idempotency-Key 면 쓰기 문장이 한 개도 나가지 않는다", async () => {
    const fake = fakeExecutor([
      // 1. Repository 를 «찾기만» 한다 — 숫자 id 로 찾아 바로 나온다.
      selects([{ id: REPOSITORY }]),
      // 2. 그 Repository 안에서 열쇠로 Session 을 찾는다.
      //    🔴 저장해 둔 Payload 를 함께 읽는다 — 「그 요청이 무엇을 담고 있었는가」의 정본이다.
      selects([
        {
          id: SESSION,
          rawPayload: {
            issues: [{ source: "codex", externalId: "SEQ-0" }],
          },
        },
      ]),
      // 3. 그 Review 가 «본» Issue 를 돌려준다 — 만든 것과 다시 만난 것 둘 다다.
      selects([
        {
          id: ISSUE,
          title: "제목",
          severity: "HIGH",
          category: "TRANSACTION",
          status: "OPEN",
          reviewSessionId: SESSION,
          source: null,
          externalId: null,
        },
        {
          // 🔴 다시 보고된 문제. 행은 **처음 만든 Session** 에 남아 있다.
          id: KNOWN_ISSUE,
          title: "다시 만난 문제",
          severity: "CRITICAL",
          category: "CONCURRENCY",
          status: "RESOLVED",
          reviewSessionId: EARLIER_SESSION,
          source: "codex",
          externalId: "SEQ-0",
        },
        {
          // 🔴 `externalId` 만 같고 `source` 가 다르다 — 같은 문제가 아니다.
          //    `inArray(externalId, …)` 로 좁힌 것을 여기서 쌍으로 다시 맞춘다.
          id: STRANGER_ISSUE,
          title: "남의 도구가 보고한 다른 문제",
          severity: "LOW",
          category: "CLEAN_CODE",
          status: "OPEN",
          reviewSessionId: EARLIER_SESSION,
          source: "gemini",
          externalId: "SEQ-0",
        },
      ]),
    ]);

    const result = await ingestReview(
      {
        workspaceId: WORKSPACE,
        idempotencyKey: "K",
        // 🔴 처음 보낸 것과 «다른» Project·branch 다. 예전에는 이 값들이 저장됐다.
        payload: payload("ghost", "main"),
      },
      fake.executor,
    );

    expect(result.idempotentReplay).toBe(true);
    expect(result.reviewSessionId).toBe(SESSION);
    expect(result.repositoryId).toBe(REPOSITORY);
    // 재전송은 확인할 새 근거도 만들지 않는다.
    expect(result.evidenceIds).toEqual([]);

    /**
     * 🔴 **재전송 응답이 Issue 를 잃지 않는다.**
     *
     * 예전에는 `review_session_id` 하나로 좁혀, 다시 보고돼 **옛 Session 에 남아 있는**
     * 행이 응답에서 통째로 빠졌다(`200 · issues: []`). 여기서 붙드는 것은 돌려받은 행
     * 가운데 **무엇을 고르는가**다 — 조건절이 그 행들을 실제로 데려오는지는 Fake 가
     * 증명하지 못하므로 `review-ingest.integration.test.ts` 가 맡는다.
     */
    expect(result.issues.map((issue) => issue.id)).toEqual([
      ISSUE,
      KNOWN_ISSUE,
    ]);
    // 🔴 `externalId` 만 같은 남의 행은 끼어들지 않는다.
    expect(result.issues.map((issue) => issue.id)).not.toContain(
      STRANGER_ISSUE,
    );
    // 저장된 값을 그대로 돌려준다 — 방금 받은 Payload 로 덮어 쓰지 않는다.
    expect(result.issues[1]).toEqual({
      id: KNOWN_ISSUE,
      title: "다시 만난 문제",
      severity: "CRITICAL",
      category: "CONCURRENCY",
      status: "RESOLVED",
      alreadyKnown: true,
    });

    // 🔴 핵심 — 오간 문장이 전부 조회다.
    expect(fake.calls.map((call) => call.kind)).toEqual([
      "select",
      "select",
      "select",
    ]);
    expect(fake.remaining()).toBe(0);
  });

  /**
   * 🔴 **Repository 를 못 찾으면 판정을 미룬다.** 그 Repository 의 Session 도 있을 수 없으니
   * 정상 경로로 내려가야 한다 — 여기서 멈추면 첫 Review 가 저장되지 않는다.
   *
   * 아래 Fake 는 「이름으로도 못 찾았다」까지만 적어 둔다. 그 뒤 실제 저장 경로가 이어지는
   * 것은 `fake.remaining()` 이 0 이 아닌 것으로는 볼 수 없으므로, **쓰기가 시작된다**는
   * 사실만 확인한다.
   */
  it("🔴 아직 없는 Repository 면 재전송으로 접지 않고 저장 경로로 내려간다", async () => {
    const fake = fakeExecutor([
      // 숫자 id 로 못 찾고,
      selects([]),
      // 이름으로도 못 찾는다.
      selects([]),
    ]);

    // 그 다음 단계(Project 확보)를 적어 두지 않았으므로 Fake 가 그 자리에서 터진다 —
    // 🔴 「조용히 재전송으로 접혔다」면 여기까지 오지 않는다.
    await expect(
      ingestReview(
        {
          workspaceId: WORKSPACE,
          idempotencyKey: "K",
          payload: payload("default", "develop"),
        },
        fake.executor,
      ),
    ).rejects.toThrow(/단계보다 많이 불렸다/);

    expect(fake.calls.map((call) => call.kind)).toEqual(["select", "select"]);
  });
});
