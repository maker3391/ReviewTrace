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

/**
 * Issue Table 의 Loading 골격.
 *
 * 🔴 실제 Content 와 **같은 열·같은 행 높이**로 그린다. 크기가 다르면 결과가 도착하는 순간
 * 화면이 튄다(Layout Shift). 조회 중에도 Header · Search · Filter 는 그대로 남는다(CLAUDE.md 8).
 */
export function IssueTableSkeleton() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">Severity</TableHead>
          <TableHead>Title</TableHead>
          <TableHead className="w-44">Category</TableHead>
          <TableHead className="w-56">Location</TableHead>
          <TableHead className="w-28">Status</TableHead>
          <TableHead className="w-32 text-right">Detected</TableHead>
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
