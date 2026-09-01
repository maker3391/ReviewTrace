"use server";

import { revalidatePath } from "next/cache";

import { beginGithubInstallation } from "@/features/repositories/server/github-installation-service";
import { connectGithubRepository } from "@/features/repositories/server/repository-connect-service";
import { actionFromError } from "@/lib/action/action-error";
import { actionOk, type ActionResult } from "@/lib/action/action-result";
import { requireProject } from "@/lib/auth/require-project";

export async function beginGithubInstallationAction(input: {
  workspaceSlug: string;
  projectSlug: string;
}): Promise<ActionResult<{ url: string }>> {
  try {
    const { user, workspace, project } = await requireProject(
      input.workspaceSlug,
      input.projectSlug,
    );
    const url = await beginGithubInstallation({
      workspaceId: workspace.workspaceId,
      projectId: project.projectId,
      userId: user.id,
    });
    return actionOk({ url });
  } catch (error) {
    return actionFromError(error);
  }
}

export async function connectGithubRepositoryAction(input: {
  workspaceSlug: string;
  projectSlug: string;
  installationId: string;
  externalRepositoryId: string;
}): Promise<ActionResult> {
  try {
    const { workspace, project } = await requireProject(
      input.workspaceSlug,
      input.projectSlug,
    );
    await connectGithubRepository({
      workspaceId: workspace.workspaceId,
      projectId: project.projectId,
      installationId: input.installationId,
      externalRepositoryId: input.externalRepositoryId,
    });
    revalidatePath(`/w/${workspace.slug}/p/${project.slug}/repositories`);
    return actionOk();
  } catch (error) {
    return actionFromError(error);
  }
}
