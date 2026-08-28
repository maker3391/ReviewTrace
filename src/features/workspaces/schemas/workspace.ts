import { z } from "zod";

import { WORKSPACE_ROLES } from "@/types/review";

/**
 * Workspace 만들기와 멤버 역할 변경의 입력 계약.
 *
 * 🔴 검증 규칙을 Component 안의 `if` 로 흩뿌리지 않는다. 여기에 둔다(CLAUDE.md 9).
 */

const NAME_MAX = 100;

export const createWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Workspace 이름을 입력하세요.")
    .max(NAME_MAX, `Workspace 이름은 ${NAME_MAX}자를 넘을 수 없습니다.`),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const changeMemberRoleSchema = z.object({
  userId: z.uuid(),
  role: z.enum(WORKSPACE_ROLES),
});

export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;
