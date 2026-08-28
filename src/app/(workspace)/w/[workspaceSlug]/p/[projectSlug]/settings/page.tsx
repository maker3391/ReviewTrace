import type { Metadata } from "next";

import { Section } from "@/components/molecules/Section";
import { ProjectSettingsPanel } from "@/features/projects/components/ProjectSettingsPanel";
import { findProjectDeletionImpact } from "@/features/projects/server/project-service";
import { requireProject } from "@/lib/auth/require-project";

export const metadata: Metadata = {
  title: "Project Settings",
};

/**
 * Project 설정 — 이름·slug·설명과 삭제.
 *
 * 🔴 **삭제로 무엇을 잃는지 먼저 센다.** Cascade 로 Repository·Review·Issue·문서가 함께
 * 사라지므로, 숫자를 보여 주지 않고 지우게 두지 않는다.
 */
export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
}) {
  const { workspaceSlug, projectSlug } = await params;
  const { workspace, project } = await requireProject(workspaceSlug, projectSlug);

  const impact = await findProjectDeletionImpact({
    workspaceId: workspace.workspaceId,
    projectId: project.projectId,
  });

  return (
    <div className="flex flex-col gap-8 p-6">
      <h1 className="text-lg font-semibold tracking-tight">Project Settings</h1>

      <Section title={project.name}>
        <ProjectSettingsPanel
          workspaceSlug={workspace.slug}
          project={{
            slug: project.slug,
            name: project.name,
            description: project.description,
          }}
          impact={impact}
        />
      </Section>
    </div>
  );
}
