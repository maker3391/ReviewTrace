import type { Metadata } from "next";
import type { Route } from "next";

import { ReviewListScreen } from "@/features/reviews/components/ReviewListScreen";
import { requireProject } from "@/lib/auth/require-project";
import { readMessages } from "@/lib/ui/appearance";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await readMessages()).metaTitle.reviews };
}

export default async function ProjectReviewsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
}) {
  const { workspaceSlug, projectSlug } = await params;
  const { workspace, project } = await requireProject(workspaceSlug, projectSlug);

  return (
    <ReviewListScreen
      workspaceId={workspace.workspaceId}
      project={project}
      basePath={`/w/${workspace.slug}/p/${project.slug}/reviews` as Route}
    />
  );
}
