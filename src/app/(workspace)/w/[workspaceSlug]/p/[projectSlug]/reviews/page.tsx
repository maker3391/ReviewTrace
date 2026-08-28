import type { Metadata } from "next";

import { ReviewListScreen } from "@/features/reviews/components/ReviewListScreen";
import { requireProject } from "@/lib/auth/require-project";

export const metadata: Metadata = {
  title: "Reviews",
};

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
    />
  );
}
