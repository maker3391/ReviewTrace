import { z } from "zod";

import { WORKSPACE_ROLES } from "@/types/review";

/**
 * Workspace 만들기와 멤버 역할 변경의 입력 계약.
 *
 * 🔴 검증 규칙을 Component 안의 `if` 로 흩뿌리지 않는다. 여기에 둔다(CLAUDE.md 9).
 *
 * 🔴 **오류 «문구» 는 여기 없다** — 규칙만 있고 말은 사전이 갖는다
 * (`lib/validation/zod-error-map.ts`).
 */

const NAME_MAX = 100;

export const createWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(NAME_MAX),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const changeMemberRoleSchema = z.object({
  userId: z.uuid(),
  role: z.enum(WORKSPACE_ROLES),
});

export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;
