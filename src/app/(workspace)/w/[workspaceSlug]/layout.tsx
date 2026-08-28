import type { ReactNode } from "react";

import { AppHeader } from "@/components/organisms/AppHeader";
import { AppSidebar } from "@/components/organisms/AppSidebar";
import { requireWorkspace } from "@/lib/auth/require-workspace";
import { listMemberWorkspaces } from "@/lib/auth/workspace-context";

/**
 * Workspace Shell.
 *
 * 🔴 **여기가 화면 접근 통제의 자리다.** `requireWorkspace` 가 소속을 확인하기 전에는
 * 아래 어떤 화면도 렌더되지 않는다 — 렌더가 시작된 뒤 클라이언트에서 되돌려 보내면
 * 보호된 화면의 뼈대가 한 번 보인다(CLAUDE.md 11).
 *
 * 🔴 **Client 로 넘기는 것은 화면이 그리는 필드뿐이다.** Switcher 에는 slug·이름·역할만,
 * Header 에는 이름·이미지만 간다. 세션이나 사용자 행을 통째로 넘기지 않는다.
 */
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { user, workspace } = await requireWorkspace(workspaceSlug);

  // Switcher 는 「실제 Member 인 Workspace」만 본다(스펙 13).
  const workspaces = await listMemberWorkspaces(user.id);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AppHeader user={{ name: user.name, image: user.image }} />
      <div className="flex min-h-0 flex-1">
        <AppSidebar
          currentSlug={workspace.slug}
          workspaces={workspaces.map((item) => ({
            slug: item.slug,
            name: item.name,
            isPersonal: item.isPersonal,
          }))}
        />
        <main className="flex min-w-0 flex-1 flex-col overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
