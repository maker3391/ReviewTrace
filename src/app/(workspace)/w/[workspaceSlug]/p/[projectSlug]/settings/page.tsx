import type { Metadata } from "next";

import { PageContainer } from "@/components/molecules/PageContainer";
import { Section } from "@/components/molecules/Section";
import { ProjectSettingsPanel } from "@/features/projects/components/ProjectSettingsPanel";
import { findProjectDeletionImpact } from "@/features/projects/server/project-service";
import { requireProject } from "@/lib/auth/require-project";
import { readMessages } from "@/lib/ui/appearance";

export async function generateMetadata(): Promise<Metadata> {
 return { title: (await readMessages()).metaTitle.projectSettings };
}

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
 const t = (await readMessages()).projectSettings;

 const impact = await findProjectDeletionImpact({
 workspaceId: workspace.workspaceId,
 projectId: project.projectId,
 });

 return (
 <PageContainer className="gap-8">
 {/*
 🔴 **「프로젝트 설정」을 다시 적지 않는다.** 상단 Breadcrumb 이 Workspace / Project
 를 말하고 사이드바가 「설정」을 칠하고 있다 — 아래 Section 머리글이 Project 이름이라
 무엇을 고치는 화면인지도 이미 분명하다.
 */}
 <Section title={project.name}>
 <ProjectSettingsPanel
 workspaceSlug={workspace.slug}
 project={{
 slug: project.slug,
 name: project.name,
 description: project.description,
 }}
 impact={impact}
 /* 🔴 화면 숨김은 편의다 — 서버가 같은 판정을 다시 한다. */
 canDelete={workspace.role === "OWNER"}
 labels={{
 name: t.name,
 slug: t.slug,
 slugHint: t.slugHint,
 description: t.descriptionField,
 save: t.save,
 deleteTitle: t.deleteTitle,
 deleteImpact: t.deleteImpact(impact),
 deleteRescue: t.deleteRescue,
 deleteDialogTitle: t.deleteDialogTitle(project.name),
 deleteDialogImpact:
 impact.repositories +
 impact.reviewSessions +
 impact.reviewIssues +
 impact.knowledgePages ===
 0
 ? t.deleteEmpty
 : t.deleteImpact(impact),
 irreversible: t.irreversible,
 confirmPrefix: t.confirmPrefix,
 confirmSuffix: t.confirmSuffix,
 delete: t.delete,
 cancel: t.cancel,
 }}
 />
 </Section>
 </PageContainer>
);
}
