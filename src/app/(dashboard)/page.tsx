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

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * Dashboard.
 *
 * 🔴 통계를 **지어내지 않는다.** 데이터를 쌓는 경로(Agent API)가 아직 없으므로
 * 여기에 숫자를 그리면 전부 거짓이다. 지금은 이 시스템이 무엇에 답할 것인지와
 * 실제로 열 수 있는 화면만 보여 준다.
 */
export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h1 className="text-base font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Review → Issue → Fix → Verification → Resolution → Knowledge → Pattern
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">이 시스템이 답할 질문</CardTitle>
          <CardDescription>
            아직 데이터가 없다. 아래는 쌓인 뒤에 답하게 될 질문이다.
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
            Repositories · Knowledge 는 아직 만들지 않았다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="sm" variant="outline">
            <Link href="/issues">Issues</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
