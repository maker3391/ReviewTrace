import type { IssueCategory, IssueSeverity, IssueStatus } from "@/types/review";

/**
 * Issue 목록 한 줄.
 *
 * 화면이 실제로 그리는 필드만 담는다 — Server Component 에서 Client 로 넘어갈 때
 * RSC payload 는 페이지 소스에 그대로 실려 나간다.
 */
export interface IssueListItem {
 id: string;
 title: string;
 severity: IssueSeverity;
 category: IssueCategory;
 status: IssueStatus;
 patternKey: string | null;
 filePath: string | null;
 startLine: number | null;
 endLine: number | null;
 repositoryFullName: string;
 firstDetectedAt: Date;
}

export interface IssueListPage {
 items: IssueListItem[];
 total: number;
 page: number;
 pageSize: number;
}
