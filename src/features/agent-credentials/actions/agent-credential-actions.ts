"use server";

import { revalidatePath } from "next/cache";

import {
  issueUserAgentCredential,
  revokeUserAgentCredential,
  setUserAgentWorkspaceGrant,
} from "@/features/agent-credentials/server/agent-credential-service";
import {
  issueAgentCredentialSchema,
  resolveExpiresAt,
  type IssueAgentCredentialInput,
} from "@/features/agent-credentials/schemas/agent-credential";
import { actionFromError } from "@/lib/action/action-error";
import { actionOk, type ActionResult } from "@/lib/action/action-result";
import { parseActionInput } from "@/lib/action/parse-action-input";
import { requireOwner, requireUser, requireWorkspace } from "@/lib/auth/require-workspace";

export async function issueAgentCredentialAction(
  workspaceSlug: string,
  input: IssueAgentCredentialInput,
): Promise<ActionResult<{ plainToken: string; name: string }>> {
  const parsed = await parseActionInput(issueAgentCredentialSchema, input);
  if (!parsed.ok) return parsed.failure;
  try {
    const user = await requireUser();
    const issued = await issueUserAgentCredential({
      userId: user.id,
      displayName: user.name ?? "ReviewTrace Agent",
      name: parsed.data.name,
      expiresAt: resolveExpiresAt(parsed.data.expiry, new Date()),
      capabilityScopes:
        parsed.data.capability === "READ_ONLY"
          ? ["READ"]
          : ["READ", "WRITE"],
      reviewLanguage: parsed.data.reviewLanguage,
    });
    revalidatePath(`/w/${workspaceSlug}/settings`);
    return actionOk({ plainToken: issued.plainToken, name: issued.name });
  } catch (error) {
    return actionFromError(error);
  }
}

export async function revokeAgentCredentialAction(
  workspaceSlug: string,
  credentialId: string,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await revokeUserAgentCredential({ userId: user.id, credentialId });
    revalidatePath(`/w/${workspaceSlug}/settings`);
    return actionOk();
  } catch (error) {
    return actionFromError(error);
  }
}

export async function setAgentWorkspaceGrantAction(
  workspaceSlug: string,
  principalOwnerUserId: string,
  granted: boolean,
): Promise<ActionResult> {
  try {
    const { user, workspace } = await requireWorkspace(workspaceSlug);
    requireOwner(workspace);
    await setUserAgentWorkspaceGrant({
      ownerUserId: user.id,
      principalOwnerUserId,
      workspaceId: workspace.workspaceId,
      granted,
    });
    revalidatePath(`/w/${workspaceSlug}/settings`);
    return actionOk();
  } catch (error) {
    return actionFromError(error);
  }
}
