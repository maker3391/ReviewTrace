import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="font-mono text-xs text-muted-foreground">404</p>
      <p className="text-sm font-medium">없는 주소입니다.</p>
      <Button asChild size="sm" variant="outline">
        <Link href="/">Dashboard 로</Link>
      </Button>
    </div>
  );
}
