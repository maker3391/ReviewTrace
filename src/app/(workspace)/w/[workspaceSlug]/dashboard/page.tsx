import Link from "next/link";
import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { sectionHref } from "@/config/navigation";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * Workspace Dashboard.
 *
 * 🔴 통계를 **지어내지 않는다.** 데이터를 쌓는 경로(Agent API)가 붙는 중이고, 숫자를 그리려면
 * 그 데이터가 실제로 있어야 한다. 지금은 이 Workspace 가 무엇이고 어디로 갈 수 있는지만 보여 준다.
 *
 * 🔴 **Layout 이 막았어도 여기서 한 번 더 확인한다.** 화면 판정은 편의일 뿐이고, 데이터에
 * 가장 가까운 자리가 경계다(CLAUDE.md 11). `requireWorkspace` 는 요청 안에서 캐시된다.
 */
export default async function WorkspaceDashboardPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWorkspace(workspaceSlug);

  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h1 className="text-base font-semibold tracking-tight">
          {workspace.name}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {workspace.isPersonal ? "Personal Workspace" : "Workspace"} ·{" "}
          {workspace.role}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">이 시스템이 답할 질문</CardTitle>
          <CardDescription>
            Review 가 쌓이면 아래 질문에 답한다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>어떤 코드 문제를 반복해서 만들고 있는가?</li>
            <li>같은 문제가 과거에도 발생했는가?</li>
            <li>과거에는 어떻게 해결했는가?</li>
            <li>어떤 해결 방법이 실제 Verification 을 통과했는가?</li>
            <li>다음 개발·Review 에서 무엇을 우선 확인해야 하는가?</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">지금 열 수 있는 화면</CardTitle>
          <CardDescription>
            Reviews · Repositories · Knowledge 는 아직 만들지 않았다.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={sectionHref(workspace.slug, "issues")}>Issues</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={sectionHref(workspace.slug, "settings")}>Settings</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
