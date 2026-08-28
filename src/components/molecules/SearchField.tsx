import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Label + 검색 Input.
 *
 * 상태를 스스로 갖지 않는다 — 값의 주인은 이 Component 를 쓰는 Form 이다.
 * 그래서 Server/Client 어느 쪽 트리에도 그대로 들어간다.
 */
export function SearchField({
  label,
  className,
  ...inputProps
}: React.ComponentProps<"input"> & { label: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input type="search" className="pl-8" {...inputProps} />
      </span>
    </label>
  );
}
