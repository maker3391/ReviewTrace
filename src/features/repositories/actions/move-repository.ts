"use server";

import { revalidatePath } from "next/cache";

import { moveRepositoryToProject } from "@/features/repositories/server/repository-query";
import { findProjectBySlug } from "@/features/projects/server/project-service";
import {
  actionFail,
  actionFromError,
  actionOk,
  type ActionResult,
} from "@/lib/action/action-result";
import { requireProject } from "@/lib/auth/require-project";

/**
 * Repository 를 다른 Project 로 옮긴다.
 *
 * 🔴 **목적지도 slug 로 받고 서버가 다시 찾는다.** 화면이 보낸 `projectId` 를 그대로 믿으면
 * 다른 Workspace 의 Project ID 를 적어 보내는 순간 Tenant 를 넘는다(CLAUDE.md 11).
 * 소속이 확인된 `workspaceId` 안에서 찾지 못하면 그것으로 끝이다.
 */
export async function moveRepositoryAction(target: {
  workspaceSlug: string;
  projectSlug: string;
  repositoryId: string;
  targetProjectSlug: string;
}): Promise<ActionResult> {
  try {
    const { workspace } = await requireProject(
      target.workspaceSlug,
      target.projectSlug,
    );

    const destination = await findProjectBySlug(
      workspace.workspaceId,
      target.targetProjectSlug,
    );

    if (destination === null) {
      return actionFail("NOT_FOUND", "옮길 Project 를 찾을 수 없습니다.");
    }

    await moveRepositoryToProject({
      workspaceId: workspace.workspaceId,
      repositoryId: target.repositoryId,
      targetProjectId: destination.projectId,
    });

    // 두 Project 의 목록이 함께 바뀐다. Dashboard 집계도 달라진다.
    revalidatePath(`/w/${target.workspaceSlug}`, "layout");

    return actionOk();
  } catch (error) {
    return actionFromError(error);
  }
}
