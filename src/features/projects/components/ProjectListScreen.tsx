import Link from "next/link";
import { Boxes } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/molecules/PageHeader";
import { Section, SectionEmpty } from "@/components/molecules/Section";
import { projectSectionHref } from "@/config/navigation";
import { CreateProjectDialog } from "@/features/projects/components/CreateProjectDialog";
import { listProjectSummaries } from "@/features/projects/server/project-service";
import { formatDate } from "@/lib/format/date";

/**
 * Project 목록 화면.
 *
 * `app/` 은 얇게 두고 화면 조립은 Feature 가 한다(CLAUDE.md 6).
 * Server Component 다 — 조회는 서버에서 하고 서버가 그린다(CLAUDE.md 8).
 */
export async function ProjectListScreen({
  workspaceId,
  workspaceSlug,
}: {
  /** 🔴 소속 확인을 통과한 값. URL 의 slug 를 그대로 넣지 않는다(CLAUDE.md 11). */
  workspaceId: string;
  workspaceSlug: string;
}) {
  const projects = await listProjectSummaries(workspaceId);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-6">
      <PageHeader
        title="Projects"
        description="하나의 제품 또는 업무 단위. Repository 는 Project 아래에 붙습니다."
        actions={<CreateProjectDialog workspaceSlug={workspaceSlug} />}
      />

      <Section variant="raised" bleed>
        {projects.length === 0 ? (
          <SectionEmpty icon={<Boxes className="size-4" />} title="Project 가 없습니다">
            제품·업무 단위로 하나 만드세요 — 예: SMIL, ReviewTrace, ERP.
          </SectionEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead className="w-40">slug</TableHead>
                <TableHead className="w-28 text-right">Repositories</TableHead>
                <TableHead className="w-24 text-right">Reviews</TableHead>
                <TableHead className="w-28 text-right">Open Issues</TableHead>
                <TableHead className="w-32 text-right">최근 활동</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => (
                <TableRow key={project.projectId}>
                  <TableCell>
                    <Link
                      href={projectSectionHref(workspaceSlug, project.slug, "")}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {project.name}
                    </Link>
                    {project.description !== null && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {project.description}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {project.slug}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {project.repositoryCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {project.reviewCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {project.openIssueCount}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {project.lastActivityAt === null
                      ? "—"
                      : formatDate(project.lastActivityAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
