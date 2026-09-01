"use server";

import { revalidatePath } from "next/cache";

import { moveRepositoryToProject } from "@/features/repositories/server/repository-query";
import { findProjectBySlug } from "@/features/projects/server/project-service";
import { actionFail, actionFromError } from "@/lib/action/action-error";
import { actionOk, type ActionResult } from "@/lib/action/action-result";
import { requireProject } from "@/lib/auth/require-project";

/**
 * Repository 를 다른 Project 로 옮긴다.
 *
 * 🔴 **목적지도 slug 로 받고 서버가 다시 찾는다.** 화면이 보낸 `projectId` 를 그대로 믿으면
 * 다른 Workspace 의 Project ID 를 적어 보내는 순간 Tenant 를 넘는다.
 * 소속이 확인된 `workspaceId` 안에서 찾지 못하면 그것으로 끝이다.
 */
export async function moveRepositoryAction(target: {
  workspaceSlug: string;
  projectSlug: string;
  repositoryId: string;
  targetProjectSlug: string;
}): Promise<ActionResult> {
  try {
    const { workspace, project } = await requireProject(
      target.workspaceSlug,
      target.projectSlug,
    );

    const destination = await findProjectBySlug(
      workspace.workspaceId,
      target.targetProjectSlug,
    );

    if (destination === null) {
      return actionFail("MOVE_TARGET_PROJECT_NOT_FOUND");
    }

    await moveRepositoryToProject({
      workspaceId: workspace.workspaceId,
      repositoryId: target.repositoryId,
      /**
       * 🔴 **출발지도 함께 건다.** 이 화면이 Repository 를 «읽을 때» 쓴 범위가
       * `{workspaceId, projectId}` 였으니 쓰기도 같아야 한다 — 아니면 Project A 화면에서
       * 다른 Project 의 Repository ID 를 적어 보내는 것만으로 그것이 옮겨진다.
       */
      sourceProjectId: project.projectId,
      targetProjectId: destination.projectId,
    });

    // 두 Project 의 목록이 함께 바뀐다. Dashboard 집계도 달라진다.
    revalidatePath(`/w/${target.workspaceSlug}`, "layout");

    return actionOk();
  } catch (error) {
    return actionFromError(error);
  }
}
