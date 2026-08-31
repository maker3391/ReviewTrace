"use server";

import { revalidatePath } from "next/cache";

import {
 createProjectSchema,
 type CreateProjectInput,
} from "@/features/projects/schemas/project";
import { createProject } from "@/features/projects/server/project-service";
import { actionFromError } from "@/lib/action/action-error";
import {
 actionOk,
 type ActionResult,
} from "@/lib/action/action-result";
import { parseActionInput } from "@/lib/action/parse-action-input";
import { requireWorkspace } from "@/lib/auth/require-workspace";

/**
 * Project 생성.
 *
 * Server Action 은 Transport 다 — 입력을 다듬어 Application Service 를 부르고 결과를 화면
 * 형식으로 돌려준다. slug 결정·중복 판정은 `project-service` 가 한다.
 *
 * 🔴 **실패를 예외로 던지지 않는다.** 프로덕션 빌드에서 Server Action 의 예외는 메시지가
 * 지워진 채 도착해 화면이 이유를 보여 줄 수 없다.
 *
 * 🔴 **권한을 여기서 다시 판정한다.** Server Action 은 주소만 알면 누구나 부를 수 있다 —
 * 화면이 감춰 두는 것은 경계가 아니다.
 */
export interface CreatedProjectResult {
 slug: string;
 name: string;
}

export async function createProjectAction(
 workspaceSlug: string,
 input: CreateProjectInput,
): Promise<ActionResult<CreatedProjectResult>> {
 const parsed = await parseActionInput(createProjectSchema, input);
 if (!parsed.ok) {
 return parsed.failure;
 }

 try {
 const { user, workspace } = await requireWorkspace(workspaceSlug);

 const project = await createProject({
 workspaceId: workspace.workspaceId,
 createdBy: user.id,
 input: parsed.data,
 });

 /**
 * 목록을 브라우저에서 다시 불러오지 않는다 — 서버가 다시 그린다.
 * 사이드바의 Project 목록은 Layout 이 그리므로 `layout` 까지 함께 되살린다.
 */
 revalidatePath(`/w/${workspaceSlug}/projects`);
 revalidatePath(`/w/${workspaceSlug}`, "layout");

 return actionOk({ slug: project.slug, name: project.name });
 } catch (error) {
 return actionFromError(error);
 }
}
