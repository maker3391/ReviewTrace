"use server";

import { revalidatePath } from "next/cache";

import { invitationIdSchema } from "@/features/invitations/schemas/invitation";
import { revokeInvitation } from "@/features/invitations/server/invitation-service";
import { requireOwner, requireWorkspace } from "@/lib/auth/require-workspace";
import { actionFromError } from "@/lib/action/action-error";
import {
  actionOk,
  type ActionResult,
} from "@/lib/action/action-result";
import { parseActionInput } from "@/lib/action/parse-action-input";

/**
 * 초대 취소.
 *
 * Server Action 은 Transport 다 — 입력을 다듬어 Application Service 를 부르고, 결과를 화면
 * 형식으로 돌려주고, 무엇을 다시 그릴지 정하는 것까지다(CLAUDE.md 8).
 * 「살아 있는 초대인가」·「그 Workspace 것인가」는 `revokeInvitation` 이 SQL 조건으로 판정한다.
 *
 * 🔴 **권한을 여기서 다시 판정한다.** 화면에서 버튼을 감추는 것은 편의일 뿐이다 —
 * Server Action 은 주소만 알면 누구나 부를 수 있다(CLAUDE.md 11).
 *
 * 🔴 **`workspaceId` 를 Client 에게서 받지 않는다.** 받는 것은 주소의 slug 뿐이고, 실제
 * Workspace 는 `requireWorkspace` 가 소속을 확인해 돌려준 것을 쓴다. 그래야 남의
 * Workspace 의 초대 id 를 적어 보내도 조건이 겹쳐 걸려 아무 행도 잡히지 않는다.
 *
 * 🔴 **실패를 예외로 던지지 않는다.** 프로덕션 빌드에서 Server Action 의 예외는 메시지가
 * 지워진 채 도착해 화면이 이유를 보여 줄 수 없다.
 */
export async function revokeInvitationAction(
  workspaceSlug: string,
  invitationId: string,
): Promise<ActionResult> {
  // 🔴 오류 문구는 이 사람의 언어로 나간다 — Schema 는 언어를 알지 못한다.
  const parsed = await parseActionInput(invitationIdSchema, invitationId);
  if (!parsed.ok) {
    return parsed.failure;
  }

  try {
    const { workspace } = await requireWorkspace(workspaceSlug);
    requireOwner(workspace);

    // 🔴 행을 지우지 않는다 — `revokedAt` 을 찍는다(`invitation-service.ts`).
    await revokeInvitation({
      workspaceId: workspace.workspaceId,
      invitationId: parsed.data,
    });

    // 수락 대기 목록이 있는 화면은 «멤버»다. 서버가 다시 그린다 — 브라우저가 재조회하지 않는다.
    revalidatePath(`/w/${workspaceSlug}/members`);

    return actionOk();
  } catch (error) {
    return actionFromError(error);
  }
}
