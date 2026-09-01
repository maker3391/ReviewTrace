import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Route } from "next";

import { ReviewDetailScreen } from "@/features/reviews/components/ReviewDetailScreen";
import { findReviewDetail } from "@/features/reviews/server/review-query";
import { requireProject } from "@/lib/auth/require-project";
import { parsePageRequest, type RawSearchParams } from "@/lib/pagination";
import { readMessages } from "@/lib/ui/appearance";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await readMessages()).metaTitle.review };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProjectReviewDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{
    workspaceSlug: string;
    projectSlug: string;
    reviewId: string;
  }>;
  /* 이 Review 가 남긴 Issue 표의 쪽 번호. 주소에 두어 새로고침·공유가 된다. */
  searchParams: Promise<RawSearchParams>;
}) {
  const { workspaceSlug, projectSlug, reviewId } = await params;
  const request = parsePageRequest(await searchParams);
  const { workspace, project } = await requireProject(
    workspaceSlug,
    projectSlug,
  );

  if (!UUID.test(reviewId)) {
    notFound();
  }

  const review = await findReviewDetail(
    { workspaceId: workspace.workspaceId, projectId: project.projectId },
    reviewId,
    request,
  );

  if (review === null) {
    notFound();
  }

  const base = `/w/${workspace.slug}/p/${project.slug}`;

  return (
    <ReviewDetailScreen
      review={review}
      detailPath={`${base}/reviews/${reviewId}` as Route}
      request={request}
      reviewsPath={`${base}/reviews` as Route}
      issuesPath={`${base}/issues` as Route}
      repositoriesPath={`${base}/repositories` as Route}
    />
  );
}
