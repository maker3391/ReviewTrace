import Link from "next/link";
import { Boxes } from "lucide-react";

import {
  NAME_CELL,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageContainer } from "@/components/molecules/PageContainer";
import { PageHeader } from "@/components/molecules/PageHeader";
import { Section, SectionEmpty } from "@/components/molecules/Section";
import { projectSectionHref } from "@/config/navigation";
import { CreateProjectButton } from "@/features/projects/components/CreateProjectButton";
import { listProjectSummaries } from "@/features/projects/server/project-service";
import { formatDate } from "@/lib/format/date";
import { readMessages } from "@/lib/ui/appearance";

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
  const [projects, t] = await Promise.all([
    listProjectSummaries(workspaceId),
    readMessages().then((messages) => messages.projects),
  ]);

  return (
    <PageContainer width="wide">
      <PageHeader
        title={t.title}
        actions={<CreateProjectButton workspaceSlug={workspaceSlug} />}
      />

      <Section variant="raised" bleed>
        {projects.length === 0 ? (
          <SectionEmpty icon={<Boxes className="size-4" />} title={t.empty}>
            {t.emptyHint}
          </SectionEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.colProject}</TableHead>
                <TableHead className="w-40">{t.colSlug}</TableHead>
                <TableHead className="w-28 text-right">
                  {t.colRepositories}
                </TableHead>
                <TableHead className="w-24 text-right">{t.colReviews}</TableHead>
                <TableHead className="w-28 text-right">
                  {t.colOpenIssues}
                </TableHead>
                <TableHead className="w-32 text-right">
                  {t.colLastActivity}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => (
                <TableRow key={project.projectId}>
                  <TableCell className={NAME_CELL}>
                    <Link
                      href={projectSectionHref(workspaceSlug, project.slug, "")}
                      title={project.name}
                      className="block truncate font-medium underline-offset-4 hover:underline"
                    >
                      {project.name}
                    </Link>
                    {project.description !== null && (
                      <span
                        className="mt-0.5 block truncate text-xs font-normal text-muted-foreground"
                        title={project.description}
                      >
                        {project.description}
                      </span>
                    )}
                  </TableCell>
                  <TableCell
                    className="max-w-[10rem] truncate font-mono text-xs text-muted-foreground"
                    title={project.slug}
                  >
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
    </PageContainer>
  );
}
