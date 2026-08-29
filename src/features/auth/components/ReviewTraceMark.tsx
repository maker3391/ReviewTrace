import Image from "next/image";

import { APP_CONFIG } from "@/config/app";

/**
 * ReviewTrace 브랜드 마크.
 *
 * 🔴 **`public/logo.png` 이 유일한 출처다.** 화면마다 다른 마크가 돌아다니지 않게, 이
 * Component 를 거치지 않고 로고를 그리지 않는다. 크기만 자리에 맞춰 바꾼다.
 *
 * 🔴 **색을 입히지 않는다.** 원본이 그러데이션을 갖고 있고 배경이 투명(RGBA)이라
 * Light·Dark 어느 쪽에도 그대로 얹힌다 — `currentColor` 로 칠하거나 필터를 걸면
 * 브랜드 색이 사라진다.
 *
 * 🔴 **장식이 아니라 이름이다.** 옆에 제품명을 «글자로» 함께 두는 자리에서는
 * `decorative` 로 두어 스크린 리더가 이름을 두 번 읽지 않게 한다.
 */
export function ReviewTraceMark({
  className,
  size = 32,
  decorative = true,
}: {
  className?: string;
  /**
   * 내려받을 실제 픽셀 크기. 표시 크기는 `className` 이 정한다 —
   * 원본이 1310×1200 이라 그대로 두면 아이콘 하나에 500KB 가 나간다.
   */
  size?: number;
  decorative?: boolean;
}) {
  return (
    <Image
      src="/logo.png"
      alt={decorative ? "" : APP_CONFIG.name}
      aria-hidden={decorative || undefined}
      width={size}
      height={size}
      priority
      className={className}
    />
  );
}
