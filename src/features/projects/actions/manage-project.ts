"use server";

import { revalidatePath } from "next/cache";

import {
  createProjectSchema,
  type CreateProjectInput,
} from "@/features/projects/schemas/project";
import {
  deleteProject,
  updateProject,
} from "@/features/projects/server/project-service";
import {
  actionFromError,
  actionOk,
  actionValidationFailed,
  type ActionResult,
} from "@/lib/action/action-result";
import { requireProject } from "@/lib/auth/require-project";

/**
 * Project 수정·삭제.
 *
 * 🔴 **`requireProject` 가 「그 Workspace 안의 Project 인가」까지 확인한다.** 화면이 보낸
 * slug 두 개는 Context 표시일 뿐이고, 실제 `projectId` 는 여기서 얻는다(CLAUDE.md 11).
 */

export interface UpdatedProjectResult {
  slug: string;
}

export async function updateProjectAction(
  target: { workspaceSlug: string; projectSlug: string },
  input: CreateProjectInput,
): Promise<ActionResult<UpdatedProjectResult>> {
  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) {
    return actionValidationFailed(parsed.error);
  }

  try {
    const { workspace, project } = await requireProject(
      target.workspaceSlug,
      target.projectSlug,
    );

    const updated = await updateProject({
      workspaceId: workspace.workspaceId,
      projectId: project.projectId,
      input: parsed.data,
    });

    revalidatePath(`/w/${target.workspaceSlug}/projects`);
    // slug 가 바뀌면 사이드바의 Project 목록도 바뀐다 — Layout 까지 되살린다.
    revalidatePath(`/w/${target.workspaceSlug}`, "layout");

    return actionOk({ slug: updated.slug });
  } catch (error) {
    return actionFromError(error);
  }
}

/**
 * Project 삭제.
 *
 * 🔴 **되돌릴 수 없고 그 아래가 함께 사라진다.** 화면이 `findProjectDeletionImpact` 로
 * 무엇을 잃는지 먼저 보여 준 뒤에 부른다.
 */
export async function deleteProjectAction(target: {
  workspaceSlug: string;
  projectSlug: string;
}): Promise<ActionResult> {
  try {
    const { workspace, project } = await requireProject(
      target.workspaceSlug,
      target.projectSlug,
    );

    await deleteProject({
      workspaceId: workspace.workspaceId,
      projectId: project.projectId,
    });

    revalidatePath(`/w/${target.workspaceSlug}/projects`);
    revalidatePath(`/w/${target.workspaceSlug}`, "layout");

    return actionOk();
  } catch (error) {
    return actionFromError(error);
  }
}
