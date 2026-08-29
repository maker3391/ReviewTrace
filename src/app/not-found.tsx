import Link from "next/link";

import { Button } from "@/components/ui/button";
import { readMessages } from "@/lib/ui/appearance";

export default async function NotFound() {
  const t = (await readMessages()).notFound;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="font-mono text-xs text-muted-foreground">404</p>
      <p className="text-sm font-medium">{t.title}</p>
      <Button asChild size="sm" variant="outline">
        <Link href="/">{t.back}</Link>
      </Button>
    </div>
  );
}
