"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface PageSizeOption {
  /** 🔴 **값은 숫자 그대로다.** 이름표를 값 자리에 넣지 않는다(`config/messages` 머리말). */
  value: number;
  /** 이 크기로 바꿨을 때의 주소. 서버가 미리 만들어 준다. */
  href: string;
}

/**
 * 한 쪽에 몇 개를 볼 것인가.
 *
 * Client Component 인 이유는 하나뿐이다 — **고르는 순간 주소로 옮겨 가야** 한다.
 * 값은 여기 남지 않는다. `Select` 는 링크를 품지 못하므로(`SelectItem` 은 option 이다)
 * **주소를 서버가 미리 만들어 넘기고** 여기서는 옮겨 가기만 한다 — 그래야 Query String 을
 * 만드는 규칙이 서버 한 곳에만 있다.
 *
 * 🔴 `push` 가 아니라 `replace` 다. 쪽 크기를 세 번 바꾸면 뒤로가기를 세 번 눌러야
 * 목록을 벗어나게 된다.
 */
export function PageSizeSelect({
  label,
  value,
  options,
}: {
  label: string;
  value: number;
  options: readonly PageSizeOption[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  return (
    <Select
      value={String(value)}
      onValueChange={(next) => {
        const target = options.find((option) => String(option.value) === next);
        if (target === undefined) {
          return;
        }
        startTransition(() => {
          router.replace(target.href as Route, { scroll: false });
        });
      }}
    >
      {/* Filter 의 Select 와 같은 높이(h-8)다 — 표 아래에서만 다른 크기를 쓰지 않는다. */}
      <SelectTrigger className="w-auto" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {options.map((option) => (
          <SelectItem key={option.value} value={String(option.value)}>
            {option.value}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
