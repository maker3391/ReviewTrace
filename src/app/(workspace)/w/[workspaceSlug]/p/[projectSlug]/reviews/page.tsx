import type { Metadata } from "next";
import type { Route } from "next";

import { ReviewListScreen } from "@/features/reviews/components/ReviewListScreen";
import { requireProject } from "@/lib/auth/require-project";
import type { RawSearchParams } from "@/lib/pagination";
import { readMessages } from "@/lib/ui/appearance";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await readMessages()).metaTitle.reviews };
}

export default async function ProjectReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
  /** 풀지 않고 그대로 넘긴다 — 어떤 값을 어떻게 해석할지는 Feature 가 정한다. */
  searchParams: Promise<RawSearchParams>;
}) {
  const { workspaceSlug, projectSlug } = await params;
  const { workspace, project } = await requireProject(
    workspaceSlug,
    projectSlug,
  );

  return (
    <ReviewListScreen
      workspaceId={workspace.workspaceId}
      project={project}
      basePath={`/w/${workspace.slug}/p/${project.slug}/reviews` as Route}
      searchParams={searchParams}
    />
  );
}
