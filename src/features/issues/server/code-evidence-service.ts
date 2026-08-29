import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { issueCodeEvidences, repositories, reviewIssues } from "@/db/schema";
import type { CodeEvidenceInput } from "@/features/issues/schemas/decision-record";
import { SNAPSHOT_MAX } from "@/features/issues/schemas/decision-record";
import { isPublicRepository, readGithubLines } from "@/lib/github/content";
import type { EvidenceVerification } from "@/types/review";

/**
 * Issue 를 실제 코드에 붙들어 매는 근거의 저장과 확인(스펙 15).
 *
 * ## 🔴 확인은 Transaction **밖**에서 한다
 *
 * ```
 * Transaction { Session · Issue · Activity · Evidence(UNVERIFIED) } Commit
 *   -> GitHub 확인 -> Evidence UPDATE
 * ```
 *
 * GitHub 호출을 Transaction 안에 넣으면 **Network 왕복 동안 행 잠금이 잡힌다.**
 * 그동안 같은 Repository 로 들어오는 다른 Review 가 줄을 선다. 확인은 부가 기능이고
 * 저장은 본체다 — 본체가 부가 기능을 기다리게 만들지 않는다.
 *
 * 확인이 실패해도 행은 `UNVERIFIED` 로 남는다. 🔴 **확인하지 못한 것을 확인한 것처럼
 * 적지 않는다.**
 */

/**
 * 한 요청에서 확인할 Evidence 수.
 *
 * GitHub 왕복이 요청 시간을 끌지 않게 하는 상한이다. 🔴 **상한에 걸려 못 본 것은
 * `UNVERIFIED` 로 남는다** — 그것이 사실이기 때문이다. 다만 **무엇이 남는지는
 * 정해져 있어야** 하므로 만든 순서대로 앞에서부터 본다(`orderBy(createdAt)`).
 * 순서가 없으면 같은 요청을 두 번 보냈을 때 서로 다른 근거가 확인된다.
 */
const MAX_VERIFY_PER_REQUEST = 10;

export interface EvidenceTarget {
  reviewIssueId: string;
  /** 이 근거를 만든 행위. 나중에 근거만 붙는 경우를 위해 `null` 을 허용한다. */
  issueActivityId: string | null;
  evidence: CodeEvidenceInput;
}

/**
 * 한 INSERT 문에 실을 행 수.
 *
 * 🔴 **한 문장에 다 실으면 터진다.** 한 Review 는 Issue 500개 × 근거 20개 = 10,000행까지
 * 가능하고, 행마다 값이 9개라 Parameter 가 90,000개가 된다 — Driver 한계(문장당 65,535개)를
 * 넘겨 **정상적인 요청이 500 으로 죽고 Transaction 전체가 롤백된다.**
 * 9 × 1,000 = 9,000 이라 한계의 14% 다. 칸을 몇 개 더해도 여유가 남는다.
 */
const EVIDENCE_INSERT_CHUNK = 1_000;

/**
 * Evidence 를 넣고 만들어진 id 를 돌려준다.
 *
 * 🔴 **Batch Insert 다**(CLAUDE.md 10). Issue 마다도, 근거마다도 왕복하지 않는다 —
 * 여러 Issue 의 근거를 한 배열로 받아 **묶음 단위**로 넣는다. Issue 마다 부르면
 * Transaction 안에서 INSERT 가 Issue 수만큼 돈다.
 */
export async function insertCodeEvidence(
  executor: DbExecutor,
  workspaceId: string,
  targets: readonly EvidenceTarget[],
): Promise<string[]> {
  if (targets.length === 0) {
    return [];
  }

  const ids: string[] = [];

  for (let from = 0; from < targets.length; from += EVIDENCE_INSERT_CHUNK) {
    const chunk = targets.slice(from, from + EVIDENCE_INSERT_CHUNK);

    const rows = await executor
      .insert(issueCodeEvidences)
      .values(
        chunk.map((target) => ({
          // 🔴 요청이 보낸 workspaceId 를 쓰지 않는다. 소속을 확인한 값만 쓴다.
          workspaceId,
          reviewIssueId: target.reviewIssueId,
          issueActivityId: target.issueActivityId,
          kind: target.evidence.kind,
          commitSha: target.evidence.commitSha,
          filePath: target.evidence.filePath,
          startLine: target.evidence.startLine,
          endLine: target.evidence.endLine,
          snapshot: target.evidence.snapshot,
        })),
      )
      .returning({ id: issueCodeEvidences.id });

    ids.push(...rows.map((row) => row.id));
  }

  return ids;
}

/**
 * GitHub 에서 확인해 결과를 적는다.
 *
 * 🔴 **던지지 않는다.** 부르는 쪽은 이 결과에 따라 응답을 바꾸지 않는다 —
 * 저장은 이미 끝났고, 이것은 그 위에 얹는 확인일 뿐이다.
 *
 * | 결과 | 언제 |
 * |---|---|
 * | `VERIFIED` | GitHub 의 그 Commit·파일·줄 범위와 같았다. Agent 가 안 보냈으면 GitHub 것을 채운다 |
 * | `MISMATCH` | GitHub 에 있는데 내용이 달랐다 |
 * | `UNAVAILABLE` | 볼 수 없었다 (Private · 없는 Commit/파일 · 한도 초과 · 응답 실패) |
 */
export async function verifyCodeEvidence(
  workspaceId: string,
  evidenceIds: readonly string[],
  executor: DbExecutor = db(),
): Promise<void> {
  if (evidenceIds.length === 0) {
    return;
  }

  try {
    const rows = await executor
      .select({
        id: issueCodeEvidences.id,
        commitSha: issueCodeEvidences.commitSha,
        filePath: issueCodeEvidences.filePath,
        startLine: issueCodeEvidences.startLine,
        endLine: issueCodeEvidences.endLine,
        snapshot: issueCodeEvidences.snapshot,
        provider: repositories.provider,
        owner: repositories.owner,
        name: repositories.name,
      })
      .from(issueCodeEvidences)
      .innerJoin(
        reviewIssues,
        eq(reviewIssues.id, issueCodeEvidences.reviewIssueId),
      )
      .innerJoin(
        repositories,
        and(
          eq(repositories.id, reviewIssues.repositoryId),
          // 🔴 Join 에도 Workspace 를 겹쳐 건다 — 조건 하나가 빠진 질의가 곧 유출이다.
          eq(repositories.workspaceId, reviewIssues.workspaceId),
        ),
      )
      .where(
        and(
          /**
           * 🔴 **id 만으로 찾지 않는다.**
           *
           * 지금은 `evidenceIds` 가 같은 Transaction 에서 서버가 만든 값이라 밖에서
           * 넣을 수 없다 — 즉 현재는 안전하다. 그래도 조건을 겹쳐 두는 이유는,
           * 이 저장소에서 **ID 로 행을 찾는 모든 질의가 Workspace 를 함께 건다**는
           * 규칙에 예외를 만들지 않기 위해서다. 예외 하나가 다음 사람에게는 선례가 된다.
           */
          eq(issueCodeEvidences.workspaceId, workspaceId),
          inArray(issueCodeEvidences.id, [...evidenceIds]),
          eq(issueCodeEvidences.verification, "UNVERIFIED"),
        ),
      )
      /**
       * 🔴 `createdAt` 만으로는 순서가 정해지지 않는다.
       *
       * 한 Review 의 근거들은 **같은 Transaction 에서 한꺼번에** 들어가고, PostgreSQL 의
       * `now()` 는 Transaction 안에서 고정이라 **전부 같은 시각**을 갖는다. 그러면
       * `limit` 이 어느 것을 고를지 정해지지 않아, 같은 요청을 두 번 보냈을 때 서로 다른
       * 근거가 확인된다. `id` 를 함께 걸어 순서를 못 박는다.
       */
      .orderBy(asc(issueCodeEvidences.createdAt), asc(issueCodeEvidences.id))
      .limit(MAX_VERIFY_PER_REQUEST);

    const verifiedAt = new Date();
    /**
     * 저장소별 공개 여부를 이 호출 안에서만 기억한다.
     *
     * 한 Review 의 근거들은 거의 언제나 같은 저장소를 가리킨다 — 근거마다 다시 물으면
     * GitHub 왕복이 근거 수만큼 두 배가 된다.
     */
    const publicByRepository = new Map<string, boolean>();

    for (const row of rows) {
      if (row.provider !== "GITHUB") {
        continue;
      }

      /**
       * 🔴 **읽기 전에 공개 저장소인지 먼저 묻는다.**
       *
       * `GITHUB_API_TOKEN` 은 서버 하나가 들고 있는 값이고, Repository 행은 Agent 가
       * 보낸 `owner/name` 으로 만들어질 뿐이다 — **등록했다는 사실은 접근 권한의 근거가
       * 아니다.** 이 확인이 없으면 아무 Workspace 나 남의 private 저장소 경로를 적어
       * 서버의 Token 으로 그 코드를 읽어 갈 수 있다(`isPublicRepository` 주석).
       */
      const repositoryKey = `${row.owner}/${row.name}`;
      let isPublic = publicByRepository.get(repositoryKey);
      if (isPublic === undefined) {
        isPublic = await isPublicRepository(row.owner, row.name);
        publicByRepository.set(repositoryKey, isPublic);
      }

      if (!isPublic) {
        // 볼 수 없었다는 사실을 적는다. Agent 가 보낸 snapshot 은 그대로 둔다.
        await executor
          .update(issueCodeEvidences)
          .set({ verification: "UNAVAILABLE", verifiedAt })
          .where(
            and(
              eq(issueCodeEvidences.id, row.id),
              eq(issueCodeEvidences.workspaceId, workspaceId),
            ),
          );
        continue;
      }

      const read = await readGithubLines(
        {
          owner: row.owner,
          name: row.name,
          commitSha: row.commitSha,
          filePath: row.filePath,
        },
        { startLine: row.startLine, endLine: row.endLine },
      );

      const outcome = decideVerification(read, row.snapshot);

      await executor
        .update(issueCodeEvidences)
        .set({
          verification: outcome.verification,
          verifiedAt,
          ...(outcome.snapshot === undefined ? {} : { snapshot: outcome.snapshot }),
        })
        .where(
          and(
            eq(issueCodeEvidences.id, row.id),
            eq(issueCodeEvidences.workspaceId, workspaceId),
          ),
        );
    }
  } catch (error) {
    // 🔴 확인 실패가 요청을 깨지 않는다. 원인은 서버 Log 에만 남는다(CLAUDE.md 19).
    console.error("[evidence] GitHub 확인에 실패했다", error);
  }
}

/**
 * 읽어 온 것과 보내온 것을 맞대 본다.
 *
 * 🔴 **줄 범위가 있을 때와 없을 때의 질문이 다르다.**
 *
 * | 줄 범위 | 질문 | 왜 |
 * |---|---|---|
 * | 있음 | 그 줄이 이것과 **같은가** | 근거가 가리키는 곳이 정확히 그 줄이다 |
 * | 없음 | 이 파일 안에 이것이 **있는가** | 조각을 파일 전체와 맞대면 언제나 다르다 |
 *
 * 줄 범위 없이 `===` 로 맞대면 **모든 근거가 MISMATCH 로 찍힌다** — 화면이 「Agent 가
 * 거짓말했다」고 말하게 되는데 사실은 우리가 잘못 물어본 것이다.
 */
export function decideVerification(
  read: Awaited<ReturnType<typeof readGithubLines>>,
  snapshot: string | null,
): { verification: EvidenceVerification; snapshot?: string } {
  if (!read.ok) {
    return { verification: "UNAVAILABLE" };
  }

  if (snapshot === null) {
    // 🔴 줄 범위가 없으면 파일 전체를 저장하지 않는다 — 저장 대상은 Review Knowledge 이지
    //    Source Code 사본이 아니다(CLAUDE.md 15). 확인된 것은 「그 Commit 에 이 파일이 있다」다.
    return read.whole
      ? { verification: "VERIFIED" }
      : { verification: "VERIFIED", snapshot: read.text.slice(0, SNAPSHOT_MAX) };
  }

  const wanted = normalize(snapshot);

  /**
   * 🔴 **빈 조각으로는 아무것도 확인할 수 없다.**
   *
   * Schema 가 이미 걸러 내지만(`decision-record.ts`), 저장된 옛 행이나 다른 경로로
   * 들어온 값이 여기 닿을 수 있다. `whole` 비교에서 `includes("")` 는 **언제나 참**이라
   * 그대로 두면 아무 코드도 없이 `VERIFIED` 가 찍힌다.
   */
  if (wanted === "") {
    return { verification: "UNAVAILABLE" };
  }

  const found = normalize(read.text);
  const same = read.whole ? found.includes(wanted) : found === wanted;

  return { verification: same ? "VERIFIED" : "MISMATCH" };
}

/**
 * 비교 전에 줄바꿈과 줄 끝 공백만 맞춘다.
 *
 * 🔴 **들여쓰기는 건드리지 않는다.** 코드에서 그것은 공백이 아니라 의미다 —
 * 다듬어 버리면 다른 코드를 같다고 판정한다.
 */
function normalize(text: string): string {
  return (
    text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.replace(/\s+$/, ""))
      .join("\n")
      // 🔴 `trim()` 이 아니다. 그것은 **첫 줄의 들여쓰기까지** 지운다 — 그러면
      //    들여쓰기만 다른 코드를 같다고 판정한다. 지우는 것은 뒤쪽 빈 줄뿐이다.
      .replace(/\s+$/, "")
  );
}
