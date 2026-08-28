import type { Metadata } from "next";
import type { Route } from "next";

import { KnowledgePageForm } from "@/features/knowledge/components/KnowledgePageForm";
import { requireProject } from "@/lib/auth/require-project";

export const metadata: Metadata = {
  title: "새 문서",
};

export default async function NewProjectKnowledgePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
}) {
  const { workspaceSlug, projectSlug } = await params;
  // 🔴 작성 화면도 소속을 확인하고 연다. 저장은 Server Action 이 다시 확인한다.
  const { workspace, project } = await requireProject(workspaceSlug, projectSlug);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="px-4 pt-4 text-base font-semibold tracking-tight">
        새 문서
      </h1>
      <KnowledgePageForm
        workspaceSlug={workspace.slug}
        projectSlug={project.slug}
        listPath={`/w/${workspace.slug}/p/${project.slug}/knowledge` as Route}
        current={null}
      />
    </div>
  );
}
