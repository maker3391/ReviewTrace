"use server";

import { revalidatePath } from "next/cache";

import { inviteMemberSchema } from "@/features/invitations/schemas/invitation";
import { createInvitation } from "@/features/invitations/server/invitation-service";
import { requireOwner, requireWorkspace } from "@/lib/auth/require-workspace";
import { actionFromError } from "@/lib/action/action-error";
import { actionOk, type ActionResult } from "@/lib/action/action-result";
import { parseActionInput } from "@/lib/action/parse-action-input";

/**
 * 초대 발행.
 *
 * Server Action 은 Transport 다 — 입력을 다듬어 Application Service 를 부르고 결과를 화면
 * 형식으로 돌려준다. 업무 판단은 `invitation-service` 가 한다.
 *
 * 🔴 **실패를 예외로 던지지 않는다.** 프로덕션 빌드에서 Server Action 의 예외는 메시지가
 * 지워진 채 도착해 화면이 이유를 보여 줄 수 없다.
 *
 * 🔴 **권한을 여기서 다시 판정한다.** 화면에서 폼을 감추는 것은 편의일 뿐이다 —
 * Server Action 은 주소만 알면 누구나 부를 수 있다.
 */
export interface InviteMemberResult {
  /**
   * 🔴 화면이 「이 링크가 아직 유효한가」를 판정하는 데 쓴다.
   *
   * 링크는 Client state 라 **`revalidatePath` 가 지우지 못한다.** 옆에서 그 초대를
   * 취소해도 패널이 그대로 남아, 이미 죽은 Token 을 「지금 복사하세요」로 권했다.
   * 서버가 다시 그리는 «살아 있는 초대» 목록과 이 id 를 맞대어 스스로 사라지게 한다.
   */
  invitationId: string;
  /** 🔴 발행 직후 **한 번만** 존재한다. 저장되지 않으므로 화면을 떠나면 다시 볼 수 없다. */
  inviteUrl: string;
  email: string;
}

export async function inviteMemberAction(
  workspaceSlug: string,
  formData: FormData,
): Promise<ActionResult<InviteMemberResult>> {
  const parsed = await parseActionInput(inviteMemberSchema, {
    email: formData.get("email"),
  });

  if (!parsed.ok) {
    return parsed.failure;
  }

  try {
    const { user, workspace } = await requireWorkspace(workspaceSlug);
    requireOwner(workspace);

    const invitation = await createInvitation({
      workspaceId: workspace.workspaceId,
      email: parsed.data.email,
      invitedBy: user.id,
    });

    /*
 🔴 **수락 대기 목록이 있는 화면은 «멤버»다.** `/settings` 를 다시 그리면 초대를
 발행해도 바로 옆의 목록이 그대로라, 사용자는 초대가 나가지 않았다고 읽는다.
 */
    revalidatePath(`/w/${workspaceSlug}/members`);

    return actionOk({
      invitationId: invitation.id,
      // 상대 경로로 돌려준다 — 화면이 자기 origin 을 붙인다. 서버가 Host 를 지어내지 않는다.
      inviteUrl: `/invite/${invitation.token}`,
      email: invitation.email,
    });
  } catch (error) {
    return actionFromError(error);
  }
}
