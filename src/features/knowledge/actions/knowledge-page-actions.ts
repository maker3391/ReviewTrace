"use server";

import { revalidatePath } from "next/cache";

import {
 knowledgePageSchema,
 type KnowledgePageInput,
} from "@/features/knowledge/schemas/knowledge-page";
import {
 createKnowledgePage,
 deleteKnowledgePage,
 updateKnowledgePage,
 type KnowledgeScope,
} from "@/features/knowledge/server/knowledge-page-service";
import { actionFromError } from "@/lib/action/action-error";
import {
 actionOk,
 type ActionResult,
} from "@/lib/action/action-result";
import { parseActionInput } from "@/lib/action/parse-action-input";
import { requireProject } from "@/lib/auth/require-project";
import { requireWorkspace } from "@/lib/auth/require-workspace";

/**
 * Wiki 문서의 등록·수정·삭제.
 *
 * Server Action 은 Transport 다 — 입력을 다듬어 Application Service 를 부르고, 결과를 화면
 * 형식으로 돌려주고, 무엇을 다시 그릴지 정하는 것까지다.
 *
 * 🔴 **실패를 예외로 던지지 않는다.** 프로덕션 빌드에서 Server Action 의 예외는 메시지가
 * 지워진 채 도착해 화면이 이유를 보여 줄 수 없다.
 *
 * 🔴 **Scope 를 Client 가 정하지 못한다.** 화면이 보내는 것은 주소의 slug 뿐이고,
 * 실제 `workspaceId`·`projectId` 는 여기서 소속을 확인해 얻는다.
 * `projectSlug` 가 `null` 이면 Workspace Knowledge, 값이 있으면 그 Project 의 Knowledge 다.
 */

/** 주소의 slug 를 소속이 확인된 Scope 로 바꾼다. 이 함수를 거치지 않고 Scope 를 만들지 않는다. */
async function resolveScope(
 workspaceSlug: string,
 projectSlug: string | null,
): Promise<{ scope: KnowledgeScope; userId: string; basePath: string }> {
 if (projectSlug === null) {
 const { user, workspace } = await requireWorkspace(workspaceSlug);
 return {
 scope: { workspaceId: workspace.workspaceId, projectId: null },
 userId: user.id,
 basePath: `/w/${workspaceSlug}/wiki`,
 };
 }

 const { user, workspace, project } = await requireProject(
 workspaceSlug,
 projectSlug,
);
 return {
 scope: { workspaceId: workspace.workspaceId, projectId: project.projectId },
 userId: user.id,
 basePath: `/w/${workspaceSlug}/p/${projectSlug}/wiki`,
 };
}

export interface SavedKnowledgePage {
 slug: string;
}

export async function createKnowledgePageAction(
 target: { workspaceSlug: string; projectSlug: string | null },
 input: KnowledgePageInput,
): Promise<ActionResult<SavedKnowledgePage>> {
 const parsed = await parseActionInput(knowledgePageSchema, input);
 if (!parsed.ok) {
 return parsed.failure;
 }

 try {
 const { scope, userId, basePath } = await resolveScope(
 target.workspaceSlug,
 target.projectSlug,
);

 const slug = await createKnowledgePage({
 scope,
 createdBy: userId,
 input: parsed.data,
 });

 // 목록을 브라우저에서 다시 불러오지 않는다 — 서버가 다시 그린다.
 revalidatePath(basePath);

 return actionOk({ slug });
 } catch (error) {
 return actionFromError(error);
 }
}

export async function updateKnowledgePageAction(
 target: {
 workspaceSlug: string;
 projectSlug: string | null;
 currentSlug: string;
 },
 input: KnowledgePageInput,
): Promise<ActionResult<SavedKnowledgePage>> {
 const parsed = await parseActionInput(knowledgePageSchema, input);
 if (!parsed.ok) {
 return parsed.failure;
 }

 try {
 const { scope, userId, basePath } = await resolveScope(
 target.workspaceSlug,
 target.projectSlug,
);

 const slug = await updateKnowledgePage({
 scope,
 createdBy: userId,
 currentSlug: target.currentSlug,
 input: parsed.data,
 });

 revalidatePath(basePath);
 // slug 가 바뀌었으면 옛 주소도 되살린다 — 캐시에 남은 옛 본문을 지운다.
 revalidatePath(`${basePath}/${target.currentSlug}`);
 revalidatePath(`${basePath}/${slug}`);

 return actionOk({ slug });
 } catch (error) {
 return actionFromError(error);
 }
}

export async function deleteKnowledgePageAction(target: {
 workspaceSlug: string;
 projectSlug: string | null;
 slug: string;
}): Promise<ActionResult> {
 try {
 const { scope, basePath } = await resolveScope(
 target.workspaceSlug,
 target.projectSlug,
);

 await deleteKnowledgePage(scope, target.slug);

 revalidatePath(basePath);
 revalidatePath(`${basePath}/${target.slug}`);

 return actionOk();
 } catch (error) {
 return actionFromError(error);
 }
}
