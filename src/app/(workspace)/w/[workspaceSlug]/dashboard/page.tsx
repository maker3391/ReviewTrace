import type { Metadata } from "next";
import { headers } from "next/headers";

import { WorkspaceDashboardScreen } from "@/features/dashboard/components/WorkspaceDashboardScreen";
import { requireWorkspace } from "@/lib/auth/require-workspace";
import {
 PerformanceTrace,
 runWithPerformanceTrace,
} from "@/lib/performance/timing";
import { readMessages } from "@/lib/ui/appearance";
import { PERFORMANCE_TRACE_HEADER } from "@/proxy";

export async function generateMetadata(): Promise<Metadata> {
 return { title: (await readMessages()).metaTitle.dashboard };
}

/**
 * Workspace Dashboard.
 *
 * `app/` 은 얇게 유지한다 — 화면 조립은 Feature 가 한다.
 *
 * 🔴 **Layout 이 막았어도 여기서 한 번 더 확인한다.** 화면 판정은 편의일 뿐이고, 데이터에
 * 가장 가까운 자리가 경계다. `requireWorkspace` 는 요청 안에서 캐시된다.
 */
export default async function WorkspaceDashboardPage({
 params,
}: {
 params: Promise<{ workspaceSlug: string }>;
}) {
 const { workspaceSlug } = await params;
 const traceId = (await headers()).get(PERFORMANCE_TRACE_HEADER);
 const trace =
 traceId === null ? undefined : new PerformanceTrace("dashboard.page", traceId);
 const { workspace } =
 trace === undefined
 ? await requireWorkspace(workspaceSlug)
 : await runWithPerformanceTrace(trace, () =>
 trace.time("dashboard.auth", () => requireWorkspace(workspaceSlug)),
 );

 return (
 <WorkspaceDashboardScreen
 workspaceId={workspace.workspaceId}
 workspaceSlug={workspace.slug}
 workspaceName={workspace.name}
 performanceTrace={trace}
 />
);
}
