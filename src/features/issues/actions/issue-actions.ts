"use server";

import { revalidatePath } from "next/cache";

import { projectBasePath, projectPath } from "@/config/routes";
import {
 issueActivityFormSchema,
 type IssueActivityFormInput,
} from "@/features/issues/schemas/issue-form";
import { issueStatusUpdateSchema } from "@/features/issues/schemas/issue-status-update";
import { addIssueActivity } from "@/features/issues/server/issue-activity-service";
import { updateIssueStatus } from "@/features/issues/server/issue-status-service";
import { actionFromError } from "@/lib/action/action-error";
import {
 actionOk,
 type ActionResult,
} from "@/lib/action/action-result";
import { parseActionInput } from "@/lib/action/parse-action-input";
import { requireProject } from "@/lib/auth/require-project";
import type { SessionUser } from "@/lib/auth/workspace-context";
import type { IssueStatus, ReviewerType } from "@/types/review";

/**
 * 사람이 화면에서 Issue 를 움직이는 자리.
 *
 * 🔴 **Agent API 와 같은 Application Service 를 부른다.** 상태 전이 규칙(RESOLVED 는
 * `resolvedAt` 을 찍고, REOPENED 는 그것을 지우고, 모든 전이가 Activity 를 남긴다)은
 * `issue-status-service.ts` 에 한 벌만 있다. 여기에 다시 적으면 **브라우저로 바꾼 Issue 와
 * Agent 가 바꾼 Issue 가 서로 다른 규칙을 따르게 된다** — 같은 표를 두 규칙이 쓰는 셈이다.
 *
 * ```
 * 브라우저 폼 -> Server Action -> Application Service -> Repository -> PostgreSQL
 * Agent -> Route Handler -> (같은 Service) -> Repository -> PostgreSQL
 * ```
 *
 * Server Action 이 하는 일은 Transport 다 — **누구인지 확인하고, 입력을
 * 다듬어 Service 를 부르고, 무엇을 다시 그릴지 정하는 것**까지다.
 *
 * 🔴 **실패를 예외로 던지지 않는다.** 프로덕션 빌드에서 Server Action 의 예외는 메시지가
 * 지워진 채 도착해 화면이 「무슨 이유로」 실패했는지 보여 줄 수 없다.
 */

/** Activity 의 `actorName` 상한(`issue-activity.ts` 의 `NAME_MAX`)과 같은 값이다. */
const ACTOR_NAME_MAX = 200;

export interface IssueActionTarget {
 workspaceSlug: string;
 projectSlug: string;
 /**
 * 🔴 **이 값은 권한 근거가 아니다.** 주소창에서 온 문자열일 뿐이다 —
 * 소속이 확인된 `workspaceId`·`projectId` 와 **함께** 걸릴 때만 의미가 있다
 *.
 */
 issueId: string;
}

export interface IssueStatusChangeInput {
 status: IssueStatus;
 resolutionSummary: string | null;
}

/**
 * 세션이 말하는 「누가 했는가」.
 *
 * 🔴 **화면이 보낸 이름을 쓰지 않는다.** actor 를 클라이언트가 적어 보내게 두면 남의 이름으로
 * History 를 남길 수 있고, 그 순간 Knowledge 의 「누가 고쳤는가」가 통째로 믿을 수 없게 된다.
 *
 * 이름이 상한을 넘는다고 상태 전이 자체가 실패하면 안 된다 — 표시용 이름이라 잘라서 쓴다.
 */
function sessionActor(user: SessionUser): { type: ReviewerType; name: string } {
 const name = user.name?.trim() ?? "";
 return {
 type: "HUMAN",
 name: (name === "" ? "이름 없음" : name).slice(0, ACTOR_NAME_MAX),
 };
}

/**
 * Issue 상태를 바꾼다.
 *
 * 🔴 규칙은 `updateIssueStatus` 가 갖는다. 여기서는 「RESOLVED 면 resolvedAt 을 찍는다」
 * 같은 판단을 하지 않는다 — 하면 두 곳이 갈라진다.
 */
export async function updateIssueStatusAction(
 target: IssueActionTarget,
 /** 🔴 타입은 화면을 돕는 것일 뿐이다. 실제 판정은 아래 Schema 가 한다. */
 input: IssueStatusChangeInput,
): Promise<ActionResult> {
 try {
 const { user, workspace, project } = await requireProject(
 target.workspaceSlug,
 target.projectSlug,
);

 const actor = sessionActor(user);

 // 🔴 화면이 보낸 것 중 «상태와 해결 요약만» 집는다. actor 는 여기서 붙인다.
 const parsed = await parseActionInput(issueStatusUpdateSchema, {
 status: input.status,
 resolutionSummary: input.resolutionSummary,
 actor,
 });

 if (!parsed.ok) {
 // RESOLVED 인데 해결 요약이 없는 경우가 여기로 온다 — 규칙은 Schema 에 있다.
 return parsed.failure;
 }

 await updateIssueStatus({
 /**
 * 🔴 **읽은 범위와 같은 범위로 쓴다.** 이 화면이 Issue 를 «보여 줄» 때 쓴 범위는
 * `{workspaceId, projectId}` 였다(`findIssueDetail`). 쓰기를 Workspace 로만 좁히면
 * 읽기와 쓰기의 범위가 어긋나 **Project A 화면에서 주소만 바꿔 Project B 의 Issue 를
 * 움직일 수 있다.** 둘은 같은 범위여야 한다.
 */
 scope: {
 workspaceId: workspace.workspaceId,
 projectId: project.projectId,
 },
 issueId: target.issueId,
 update: parsed.data,
 // actor 를 항상 채워 보내므로 쓰이지 않는다. Agent 경로가 API Key 이름을 넣는 자리다.
 fallbackActorName: actor.name,
 });

 /*
 🔴 이 Issue 상세만 달라지지 않는다. 목록의 Status 칸과 Dashboard 의 「열린 Issue」
 집계가 함께 달라진다 — Project 아래를 통째로 서버가 다시 그리게 한다.
 상세 화면(`.../issues/{id}`)도 이 아래에 있다.
 */
 revalidatePath(
 projectBasePath(target.workspaceSlug, target.projectSlug),
 "layout",
);

 return actionOk();
 } catch (error) {
 return actionFromError(error);
 }
}

/**
 * Issue History 에 한 줄 남긴다.
 *
 * 🔴 상태는 바꾸지 않는다 — 그것은 `updateIssueStatusAction` 의 몫이다.
 * Tenant 확인도 여기서 하지 않는다: `addIssueActivity` 가 확인된 범위와 함께 Issue 를
 * 찾고, 못 찾으면 `NOT_FOUND` 로 끝난다.
 *
 * 🔴 **범위는 `requireProject` 가 확인해 준 Project 까지다.** 화면은 어느 Project 를
 * 보고 있는지 알고 있으므로, 그것을 넘기지 않으면 주소창의 issueId 만 바꿔 다른
 * Project 의 History 에 한 줄 남길 수 있다 — 상태 변경과 같은 자리다.
 */
export async function addIssueActivityAction(
 target: IssueActionTarget,
 input: IssueActivityFormInput,
): Promise<ActionResult> {
 const parsed = await parseActionInput(issueActivityFormSchema, input);
 if (!parsed.ok) {
 return parsed.failure;
 }

 try {
 const { user, workspace, project } = await requireProject(
 target.workspaceSlug,
 target.projectSlug,
);

 await addIssueActivity({
 scope: {
 workspaceId: workspace.workspaceId,
 projectId: project.projectId,
 },
 issueId: target.issueId,
 activity: {...parsed.data, actor: sessionActor(user) },
 });

 // History 한 줄이 늘 뿐이라 이 화면만 다시 그린다.
 const issuesPath = projectPath(
 target.workspaceSlug,
 target.projectSlug,
 "issues",
);
 revalidatePath(`${issuesPath}/${target.issueId}`);

 return actionOk();
 } catch (error) {
 return actionFromError(error);
 }
}
