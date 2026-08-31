import { CreateProjectDialog } from "@/features/projects/components/CreateProjectDialog";
import { readMessages } from "@/lib/ui/appearance";

/**
 * Project 생성 버튼의 자리.
 *
 * Dialog 자체는 Client Component 라 문구를 스스로 읽을 수 없다 — 서버에서 읽어 **그리는
 * 낱말만** 넘긴다. 이 얇은 Server Component 하나를 두어 Workspace
 * Dashboard 와 Projects 화면이 **같은 대응**을 쓰게 한다 — 두 곳에 적으면 갈라진다.
 */
export async function CreateProjectButton({
 workspaceSlug,
}: {
 workspaceSlug: string;
}) {
 const t = (await readMessages()).projectDialog;

 return (
 <CreateProjectDialog
 workspaceSlug={workspaceSlug}
 labels={{...t, slugHint: t.slugHint(workspaceSlug) }}
 />
);
}
