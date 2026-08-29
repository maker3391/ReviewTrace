import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ISSUE_PAGE_SIZE } from "@/features/issues/schemas/issue-filter";

/** 첫 화면에서 실제로 채워지는 정도. 화면 전체를 스켈레톤으로 덮지 않기 위한 크기다. */
const SKELETON_ROWS = Math.min(ISSUE_PAGE_SIZE, 8);

/** 실제 표와 **같은** 머리 낱말. 어긋나면 결과가 도착할 때 글자가 바뀐다. */
export interface SkeletonLabels {
  colSeverity: string;
  colTitle: string;
  colCategory: string;
  colLocation: string;
  colStatus: string;
  colDetected: string;
}

/**
 * Issue Table 의 Loading 골격.
 *
 * 🔴 **표 머리의 낱말을 여기 다시 적지 않는다.** 문구는 서버가 읽어 넘긴다 —
 * Suspense 의 fallback 은 스스로 기다릴 수 없어(그러면 골격이 그려지지 않는다)
 * 이 Component 는 async 가 아니다.
 *
 * 🔴 실제 Content 와 **같은 열·같은 행 높이**로 그린다. 크기가 다르면 결과가 도착하는 순간
 * 화면이 튄다(Layout Shift). 조회 중에도 Header · Search · Filter 는 그대로 남는다(CLAUDE.md 8).
 */
export function IssueTableSkeleton({ labels: t }: { labels: SkeletonLabels }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">{t.colSeverity}</TableHead>
          <TableHead>{t.colTitle}</TableHead>
          <TableHead className="w-44">{t.colCategory}</TableHead>
          <TableHead className="w-56">{t.colLocation}</TableHead>
          <TableHead className="w-28">{t.colStatus}</TableHead>
          <TableHead className="w-32 text-right">{t.colDetected}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <TableRow key={index}>
            <TableCell>
              <Skeleton className="h-5 w-16" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-3/4" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-28" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-40" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-5 w-16" />
            </TableCell>
            <TableCell>
              <Skeleton className="ml-auto h-4 w-20" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
