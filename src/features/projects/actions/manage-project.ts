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
import { actionFromError } from "@/lib/action/action-error";
import { actionOk, type ActionResult } from "@/lib/action/action-result";
import { parseActionInput } from "@/lib/action/parse-action-input";
import { requireProject } from "@/lib/auth/require-project";
import { requireOwner } from "@/lib/auth/require-workspace";

/**
 * Project 수정·삭제.
 *
 * 🔴 **`requireProject` 가 「그 Workspace 안의 Project 인가」까지 확인한다.** 화면이 보낸
 * slug 두 개는 Context 표시일 뿐이고, 실제 `projectId` 는 여기서 얻는다.
 */

export interface UpdatedProjectResult {
  slug: string;
}

export async function updateProjectAction(
  target: { workspaceSlug: string; projectSlug: string },
  input: CreateProjectInput,
): Promise<ActionResult<UpdatedProjectResult>> {
  const parsed = await parseActionInput(createProjectSchema, input);
  if (!parsed.ok) {
    return parsed.failure;
  }

  try {
    const { workspace, project } = await requireProject(
      target.workspaceSlug,
      target.projectSlug,
    );

    /*
 🔴 **수정도 OWNER 만이다 — 삭제와 «같은» 판정을 같은 helper 로 한다.**
 `requireProject` 가 보는 것은 「그 Workspace 의 멤버인가」와 「그 Workspace 안의
 Project 인가」까지다 — 그것만으로는 **MEMBER 도 이름·slug·설명을 바꿀 수 있었다.**
 slug 는 주소다. 바꾸면 밖에 나가 있던 링크가 통째로 끊긴다 — 조회 권한과 변경
 권한은 다른 판정이다.

 🔴 **화면에서 폼을 감추는 것으로 대신하지 않는다.** Server Action 은 주소만 알면
 누구나 부를 수 있다 — 판정의 정본은 여기다.

 🔴 `requireOwner` 는 `notFound()` 를 던진다. `403` 이 아니다 — 403 은 「그 Project 가
 존재한다」를 알려 주므로, 없는 것과 권한 없는 것을 구분해 주지 않는다.
 */
    requireOwner(workspace);

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

    /*
 🔴 **삭제는 OWNER 만이다.** `requireProject` 는 「그 Workspace 의 멤버인가」와
 「그 Workspace 안의 Project 인가」까지만 본다 — 그것만으로는 **MEMBER 도 Project 를
 통째로 지울 수 있었다.** 조회 권한과 파괴 권한은 다른 판정이다.

 🔴 **화면에서 Danger Zone 을 감추는 것으로 대신하지 않는다**.
 Server Action 은 주소만 알면 누구나 부를 수 있다 — 판정의 정본은 여기다.

 🔴 `requireOwner` 는 `notFound()` 를 던진다. `403` 이 아니다 — 403 은 「그 Project 가
 존재한다」를 알려 주므로, 없는 것과 권한 없는 것을 구분해 주지 않는다.
 */
    requireOwner(workspace);

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
