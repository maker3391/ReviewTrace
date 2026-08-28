import type { Metadata } from "next";

import { IssueListScreen } from "@/features/issues/components/IssueListScreen";

export const metadata: Metadata = {
  title: "Issues",
};

/**
 * `app/` 은 얇게 유지한다 — 화면 조립은 Feature 가 한다(CLAUDE.md 6).
 *
 * Next.js 16 에서 `searchParams` 는 Promise 다. 여기서 풀지 않고 그대로 넘겨,
 * 어떤 값을 어떻게 해석할지는 Feature 의 Schema 가 정하게 둔다.
 */
export default function IssuesPage(props: PageProps<"/issues">) {
  return <IssueListScreen searchParams={props.searchParams} />;
}
