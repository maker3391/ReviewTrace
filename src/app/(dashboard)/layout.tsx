import { AppHeader } from "@/components/organisms/AppHeader";
import { AppSidebar } from "@/components/organisms/AppSidebar";

/**
 * Dashboard Shell.
 *
 * Route Group `(dashboard)` 는 URL 에 나타나지 않는다 — 주소를 바꾸지 않고 공통 껍데기만 씌운다.
 *
 * 【향후 — 인증 도입 시】 **렌더 전에** 자격을 확인하고 없으면 여기서 돌려보낸다.
 * 클라이언트 판정으로 대신하지 않는다 — 렌더가 시작되면 보호된 화면의 뼈대가 한 번 보인다(CLAUDE.md 11).
 */
export default function DashboardLayout({
  children,
}: LayoutProps<"/">) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AppHeader />
      <div className="flex min-h-0 flex-1">
        <AppSidebar />
        <main className="flex min-w-0 flex-1 flex-col overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
