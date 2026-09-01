/**
 * Project 의 화면·Application 표현.
 *
 * 화면이 실제로 그리는 필드만 담는다 — Server Component 에서 Client 로 넘어갈 때
 * RSC payload 는 페이지 소스에 그대로 실려 나간다.
 *
 * 이 파일은 순수 타입만 둔다 — Drizzle 을 끌고 오지 않으므로 Client Component 가
 * import 해도 서버 코드가 번들에 섞이지 않는다.
 */

/** 소속 확인을 통과한 Project. 「지금 어느 업무 단위를 보고 있는가」다. */
export interface ProjectContext {
  projectId: string;
  slug: string;
  name: string;
  description: string | null;
}

/** Project 목록 한 줄. 사이드바와 Projects 화면이 함께 쓴다. */
export interface ProjectSummary extends ProjectContext {
  repositoryCount: number;
  reviewCount: number;
  openIssueCount: number;
  /** 이 Project 에서 마지막으로 무슨 일이 있었나. Review 도 Issue 도 없으면 `null`. */
  lastActivityAt: Date | null;
}
