"use server";

import { revalidatePath } from "next/cache";

import {
  changeMemberRoleSchema,
  createWorkspaceSchema,
  type ChangeMemberRoleInput,
  type CreateWorkspaceInput,
} from "@/features/workspaces/schemas/workspace";
import {
  changeMemberRole,
  createWorkspace,
} from "@/features/workspaces/server/workspace-service";
import { actionFromError } from "@/lib/action/action-error";
import {
  actionOk,
  type ActionResult,
} from "@/lib/action/action-result";
import { parseActionInput } from "@/lib/action/parse-action-input";
import { requireUser } from "@/lib/auth/require-workspace";
import { requireOwner, requireWorkspace } from "@/lib/auth/require-workspace";

/**
 * Workspace 만들기와 멤버 역할 변경.
 *
 * 🔴 **실패를 예외로 던지지 않는다.** 프로덕션 빌드에서 Server Action 의 예외는 메시지가
 * 지워진 채 도착해 화면이 이유를 보여 줄 수 없다(CLAUDE.md 8).
 */

export interface CreatedWorkspaceResult {
  slug: string;
  name: string;
}

/**
 * 새 Workspace 를 만든다.
 *
 * 🔴 **로그인만 확인한다.** 「어느 Workspace 의 멤버인가」는 상관이 없다 — 새로 만드는
 * 일이라 기존 소속이 근거가 될 수 없다.
 */
export async function createWorkspaceAction(
  input: CreateWorkspaceInput,
): Promise<ActionResult<CreatedWorkspaceResult>> {
  const parsed = await parseActionInput(createWorkspaceSchema, input);
  if (!parsed.ok) {
    return parsed.failure;
  }

  try {
    const user = await requireUser();

    const created = await createWorkspace({
      name: parsed.data.name,
      createdBy: user.id,
    });

    /**
     * 사이드바의 Workspace Switcher 는 Layout 이 그린다 — 새 Workspace 가 목록에 보이려면
     * Layout 까지 되살려야 한다.
     */
    revalidatePath("/w", "layout");

    return actionOk({ slug: created.slug, name: created.name });
  } catch (error) {
    return actionFromError(error);
  }
}

/**
 * 멤버 역할 변경.
 *
 * 🔴 **OWNER 만 할 수 있다.** 「마지막 OWNER 강등 금지」·「Personal Workspace 주인 불가」는
 * Application Service 가 Transaction 안에서 판정한다(`workspace-service.ts`).
 */
export async function changeMemberRoleAction(
  workspaceSlug: string,
  input: ChangeMemberRoleInput,
): Promise<ActionResult> {
  const parsed = await parseActionInput(changeMemberRoleSchema, input);
  if (!parsed.ok) {
    return parsed.failure;
  }

  try {
    const { workspace } = await requireWorkspace(workspaceSlug);
    requireOwner(workspace);

    await changeMemberRole({
      workspaceId: workspace.workspaceId,
      userId: parsed.data.userId,
      role: parsed.data.role,
    });

    revalidatePath(`/w/${workspaceSlug}/members`);

    return actionOk();
  } catch (error) {
    return actionFromError(error);
  }
}
