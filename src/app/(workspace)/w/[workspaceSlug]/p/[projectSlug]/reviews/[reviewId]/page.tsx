import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Route } from "next";

import { ReviewDetailScreen } from "@/features/reviews/components/ReviewDetailScreen";
import { findReviewDetail } from "@/features/reviews/server/review-query";
import { requireProject } from "@/lib/auth/require-project";

export const metadata: Metadata = {
  title: "Review",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProjectReviewDetailPage({
  params,
}: {
  params: Promise<{
    workspaceSlug: string;
    projectSlug: string;
    reviewId: string;
  }>;
}) {
  const { workspaceSlug, projectSlug, reviewId } = await params;
  const { workspace, project } = await requireProject(workspaceSlug, projectSlug);

  if (!UUID.test(reviewId)) {
    notFound();
  }

  const review = await findReviewDetail(
    { workspaceId: workspace.workspaceId, projectId: project.projectId },
    reviewId,
  );

  if (review === null) {
    notFound();
  }

  const base = `/w/${workspace.slug}/p/${project.slug}`;

  return (
    <ReviewDetailScreen
      review={review}
      issuesPath={`${base}/issues` as Route}
      repositoriesPath={`${base}/repositories` as Route}
    />
  );
}
