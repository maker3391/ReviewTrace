import "server-only";

import type { DbExecutor } from "@/db";
import { db } from "@/db";
import type { ReviewIngestInput } from "@/features/reviews/schemas/review-ingest";
import {
  resolveAuthorizedRepositoryContext,
  resolveAuthorizedWorkspace,
} from "@/features/repositories/server/authorized-repository-context-service";
import type { AgentAuthorization } from "@/lib/api/api-key-auth";
import { isAppError } from "@/lib/errors";

/** Resolve an existing Repository first; only an explicit Project may connect a new one. */
export async function resolveAgentReviewWorkspace(
  input: {
    authorization: AgentAuthorization;
    payload: ReviewIngestInput;
    workspaceHint?: string | null;
  },
  executor: DbExecutor = db(),
): Promise<string> {
  try {
    const context = await resolveAuthorizedRepositoryContext(
      {
        authorization: input.authorization,
        identity: {
          provider: input.payload.repository.provider,
          externalRepositoryId:
            input.payload.repository.externalRepositoryId,
          fullName: input.payload.repository.fullName,
        },
        workspaceHint: input.workspaceHint,
      },
      executor,
    );
    return context.workspace.id;
  } catch (error) {
    if (
      !isAppError(error) ||
      error.reason !== "NOT_CONNECTED_OR_NOT_AUTHORIZED" ||
      input.payload.project === null
    ) {
      throw error;
    }
  }

  return (
    await resolveAuthorizedWorkspace(
      {
        authorization: input.authorization,
        workspaceHint: input.workspaceHint,
      },
      executor,
    )
  ).id;
}
