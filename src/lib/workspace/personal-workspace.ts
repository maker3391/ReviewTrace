import "server-only";

import { eq } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { workspaceMembers, workspaces } from "@/db/schema";
import { slugCandidate } from "@/lib/workspace/slug";

/**
 * 가입하면 자기 Personal Workspace 를 갖는다.
 *
 * ```
 * GitHub OAuth -> User -> Personal Workspace -> WorkspaceMember(OWNER)
 * ```
 *
 * 🔴 **초대받은 사람도 예외가 아니다.** 「초대로 들어왔으니 Personal 은 없다」를 두면
 * 그 사람이 회사 Workspace 에서 빠지는 순간 갈 곳이 사라진다.
 *
 * 🔴 **매 로그인마다 새로 만들지 않는다.** 「있는지 보고 없으면 만든다」만으로는 두 창에서
 * 동시에 로그인할 때의 틈이 막히지 않는다 — 최종 방어선은 `workspaces.personal_owner_id`
 * 의 unique 다(`src/db/schema/workspace.ts`).
 */

/** slug 가 겹칠 때 다음 후보를 시도하는 횟수. 여기서 끝나면 예외를 던진다. */
const MAX_SLUG_ATTEMPTS = 5;

export interface PersonalWorkspaceInput {
  userId: string;
  /** 화면에 보이는 Workspace 이름의 재료. 없으면 slug 를 그대로 쓴다. */
  displayName: string | null;
  /** slug 의 재료. GitHub 아이디가 가장 좋다 — 이미 전역에서 유일하고 URL 에 안전하다. */
  slugSource: string | null;
}

async function findPersonalWorkspaceId(
  userId: string,
  executor: DbExecutor,
): Promise<string | null> {
  const rows = await executor
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.personalOwnerId, userId))
    .limit(1);

  return rows[0]?.id ?? null;
}

/**
 * 이 사용자의 Personal Workspace 를 확보한다. 이미 있으면 그것을 돌려준다.
 *
 * @returns Personal Workspace 의 id.
 */
export async function ensurePersonalWorkspace(
  input: PersonalWorkspaceInput,
  executor: DbExecutor = db(),
): Promise<string> {
  const existing = await findPersonalWorkspaceId(input.userId, executor);
  if (existing !== null) {
    return existing;
  }

  const base = input.slugSource ?? input.displayName ?? "workspace";

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
    const slug = slugCandidate(base, attempt);

    /**
     * Workspace 와 소속을 **한 Transaction 에** 넣는다.
     * 중간에 끊겨 「Workspace 는 있는데 소속이 없는」 반쪽 상태가 남으면,
     * 그 사람은 자기 Workspace 에 들어가지 못하면서 새로 만들지도 못한다.
     */
    const workspaceId = await executor.transaction(async (tx) => {
      const created = await tx
        .insert(workspaces)
        .values({
          slug,
          name: input.displayName ?? slug,
          personalOwnerId: input.userId,
          createdBy: input.userId,
        })
        // slug 가 겹쳤거나(다음 후보로) 이미 Personal 이 생겼거나(경쟁에서 졌다) 둘 중 하나다.
        .onConflictDoNothing()
        .returning({ id: workspaces.id });

      const id = created[0]?.id;
      if (id === undefined) {
        return null;
      }

      await tx
        .insert(workspaceMembers)
        .values({ workspaceId: id, userId: input.userId, role: "OWNER" });

      return id;
    });

    if (workspaceId !== null) {
      return workspaceId;
    }

    // 경쟁에서 졌다면 이미 만들어져 있다. 그때는 다음 slug 를 시도할 이유가 없다.
    const raced = await findPersonalWorkspaceId(input.userId, executor);
    if (raced !== null) {
      return raced;
    }
  }

  // 🔴 값 자체를 message 에 담지 않는다 — 사용자 이름이 로그로 흘러 나간다.
  throw new Error("Personal Workspace 의 slug 후보를 모두 시도했지만 실패했다");
}
