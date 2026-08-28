import type { ReactNode } from "react";

import { AppHeader } from "@/components/organisms/AppHeader";
import { AppSidebar } from "@/components/organisms/AppSidebar";
import { listProjectOptions } from "@/features/projects/server/project-service";
import { requireWorkspace } from "@/lib/auth/require-workspace";
import { listMemberWorkspaces } from "@/lib/auth/workspace-context";
import { headers } from "next/headers";

import { readProjectSlugFromPath } from "@/config/routes";
import { CURRENT_PATH_HEADER } from "@/proxy";

/**
 * Workspace Shell.
 *
 * 🔴 **여기가 화면 접근 통제의 자리다.** `requireWorkspace` 가 소속을 확인하기 전에는
 * 아래 어떤 화면도 렌더되지 않는다 — 렌더가 시작된 뒤 클라이언트에서 되돌려 보내면
 * 보호된 화면의 뼈대가 한 번 보인다(CLAUDE.md 11).
 *
 * Project 화면(`/w/{slug}/p/{projectSlug}/...`)도 이 Layout 아래에 있다. Project 자체의
 * 소속 확인은 그 아래 화면들이 `requireProject` 로 다시 한다 — Layout 은 **Workspace 까지만**
 * 책임진다.
 *
 * 🔴 **Client 로 넘기는 것은 화면이 그리는 필드뿐이다.** Switcher 에는 slug·이름·Personal
 * 여부만, Header 에는 이름·이미지만, 사이드바에는 Project 의 slug·이름만 간다.
 * 세션이나 사용자 행을 통째로 넘기지 않는다.
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

  /**
   * 사이드바가 쓰는 두 목록.
   *
   * 🔴 Project 목록은 **집계 없는 가벼운 것**을 쓴다(`listProjectOptions`). 사이드바는 모든
   * 화면에서 도는데, 거기에 Review·Issue 집계를 얹으면 Project 를 열지 않는 화면에서도
   * 매번 Join 이 붙는다.
   */
  const [workspaces, projects] = await Promise.all([
    listMemberWorkspaces(user.id),
    listProjectOptions(workspace.workspaceId),
  ]);

  /**
   * 상단 바가 「지금 어느 Project 인가」를 그리려면 주소를 알아야 한다.
   *
   * 🔴 Layout 은 하위 Route 의 `params` 를 받지 못한다. Next.js 가 넣어 주는 헤더에서
   * 경로를 읽고, **서버가 소속을 확인해 넘긴 목록**에 맞대어 본다 — 없는 slug 면 그리지
   * 않는다. 이름을 지어내지 않는 것이 요점이다(CLAUDE.md 11).
   */
  const pathname = (await headers()).get(CURRENT_PATH_HEADER) ?? "";
  const projectSlug = readProjectSlugFromPath(pathname);
  const currentProject =
    projectSlug === null
      ? null
      : (projects.find((item) => item.slug === projectSlug) ?? null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AppHeader
        user={{ name: user.name, image: user.image }}
        workspaceName={workspace.name}
        projectName={currentProject?.name ?? null}
      />
      <div className="flex min-h-0 flex-1">
        <AppSidebar
          currentSlug={workspace.slug}
          workspaces={workspaces.map((item) => ({
            slug: item.slug,
            name: item.name,
            isPersonal: item.isPersonal,
          }))}
          projects={projects.map((item) => ({
            slug: item.slug,
            name: item.name,
          }))}
        />
        <main className="flex min-w-0 flex-1 flex-col overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
