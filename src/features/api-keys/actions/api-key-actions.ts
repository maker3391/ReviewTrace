"use server";

import { revalidatePath } from "next/cache";

import {
  issueApiKey,
  revokeApiKey,
} from "@/features/api-keys/server/api-key-service";
import {
  issueApiKeySchema,
  resolveExpiresAt,
  type IssueApiKeyInput,
} from "@/features/api-keys/schemas/api-key";
import { actionFromError } from "@/lib/action/action-error";
import {
  actionOk,
  type ActionResult,
} from "@/lib/action/action-result";
import { parseActionInput } from "@/lib/action/parse-action-input";
import { requireOwner, requireWorkspace } from "@/lib/auth/require-workspace";

/**
 * API Key 발급·폐기.
 *
 * 🔴 **OWNER 만 할 수 있다.** API Key 는 그 Workspace 의 Agent API 를 통째로 여는 자격이라
 * 초대와 같은 급이다. 화면에서 감추는 것은 편의일 뿐이고 여기서 다시 판정한다(CLAUDE.md 11).
 *
 * 🔴 **원문은 이 반환값에만 존재한다.** 화면이 한 번 보여 주고 버린다 — 저장하지도, 다시
 * 조회하지도 못한다(CLAUDE.md 12).
 *
 * 🔴 **원문을 로그에 남기지 않는다.** 실패해도 마찬가지다 — `actionFromError` 는
 * `code`·`message` 만 추린다.
 */
export interface IssuedApiKeyResult {
  /** 🔴 **이 한 번만 존재한다.** 화면을 떠나면 다시 볼 수 없다. */
  plainToken: string;
  name: string;
  keyPrefix: string;
}

export async function issueApiKeyAction(
  workspaceSlug: string,
  input: IssueApiKeyInput,
): Promise<ActionResult<IssuedApiKeyResult>> {
  const parsed = await parseActionInput(issueApiKeySchema, input);
  if (!parsed.ok) {
    return parsed.failure;
  }

  try {
    const { workspace } = await requireWorkspace(workspaceSlug);
    requireOwner(workspace);

    const issued = await issueApiKey({
      workspaceId: workspace.workspaceId,
      name: parsed.data.name,
      expiresAt: resolveExpiresAt(parsed.data.expiry, new Date()),
    });

    revalidatePath(`/w/${workspaceSlug}/settings`);

    // 🔴 목록에 나갈 값만 함께 돌려준다. `keyHash` 는 서비스가 이미 빼고 준다.
    return actionOk({
      plainToken: issued.plainToken,
      name: issued.name,
      keyPrefix: issued.keyPrefix,
    });
  } catch (error) {
    return actionFromError(error);
  }
}

export async function revokeApiKeyAction(
  workspaceSlug: string,
  apiKeyId: string,
): Promise<ActionResult> {
  try {
    const { workspace } = await requireWorkspace(workspaceSlug);
    requireOwner(workspace);

    // 🔴 행을 지우지 않는다 — `revokedAt` 을 찍는다(`api-key-service.ts`).
    await revokeApiKey({ workspaceId: workspace.workspaceId, apiKeyId });

    revalidatePath(`/w/${workspaceSlug}/settings`);

    return actionOk();
  } catch (error) {
    return actionFromError(error);
  }
}
