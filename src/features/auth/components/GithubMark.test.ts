import { describe, expect, it } from "vitest";

import { GITHUB_MARK_PATH } from "@/features/auth/components/GithubMark";

/**
 * GitHub mark 의 `d` 가 «온전히» 그려지는지 지킨다.
 *
 * 🔴 **이 시험이 있는 이유.** 예전 `d` 는 마이너스 부호가 몇 군데 빠져 `0 0-.67-.22-2.2.82`
 * 가 `0 0.67-.21 2.2.82` 로 붙어 있었다. 그러면 그 `c` 명령의 인자가 6의 배수가 아니게
 * 되는데, **SVG 사양은 그런 명령을 만나면 거기까지만 그리고 뒤를 통째로 버린다**
 * (`path` errors — "render up to the erroneous segment"). 예외도 경고도 나지 않아
 * 브라우저 콘솔은 조용했고, 화면에는 바깥 원의 왼쪽 조각만 남았다.
 *
 * 그래서 여기서 확인하는 것은 «모양이 예쁜가»가 아니라 **파서가 끝까지 읽을 수 있는가**다.
 * 렌더링 없이 문자열만으로 판정되므로 DOM 이 없는 node 환경에서 돈다.
 */

const ARGUMENT_COUNT: Record<string, number> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0,
};

type Segment = { command: string; args: number[] };

/**
 * `d` 를 명령 단위로 끊는다.
 *
 * 🔴 **arc(`a`) 의 flag 두 칸은 «한 글자»다.** `0 0 1-5.45` 처럼 붙여 쓰는 것이 정상 표기라
 * 숫자 정규식으로 훑으면 `0`·`01`·`-5.45` 로 잘못 읽는다 — flag 자리에서는 문자 하나만
 * 떼어 온다. 이것을 빼먹으면 멀쩡한 path 를 깨진 것으로 판정한다.
 */
function parsePath(d: string): Segment[] {
  const segments: Segment[] = [];
  let index = 0;

  const skipSeparators = () => {
    while (index < d.length && /[\s,]/.test(d[index]!)) index += 1;
  };

  const readNumber = (): number | null => {
    skipSeparators();
    const rest = d.slice(index);
    const matched = /^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/.exec(rest);
    if (!matched || matched[0] === "" || matched[0] === "+" || matched[0] === "-") {
      return null;
    }
    index += matched[0].length;
    return Number.parseFloat(matched[0]);
  };

  const readFlag = (): number | null => {
    skipSeparators();
    const character = d[index];
    if (character !== "0" && character !== "1") return null;
    index += 1;
    return Number.parseInt(character, 10);
  };

  while (index < d.length) {
    skipSeparators();
    if (index >= d.length) break;

    const command = d[index]!;
    if (!/[MmLlHhVvCcSsQqTtAaZz]/.test(command)) {
      throw new Error(`unexpected character "${command}" at ${index}`);
    }
    index += 1;

    const arity = ARGUMENT_COUNT[command.toLowerCase()]!;
    if (arity === 0) {
      segments.push({ command, args: [] });
      continue;
    }

    // 같은 명령을 반복할 때는 문자를 다시 적지 않는다 — 숫자가 이어지는 동안 계속 읽는다.
    for (;;) {
      const args: number[] = [];
      for (let slot = 0; slot < arity; slot += 1) {
        const isArcFlag =
          command.toLowerCase() === "a" && (slot === 3 || slot === 4);
        const value = isArcFlag ? readFlag() : readNumber();
        if (value === null) {
          if (slot === 0 && segments.some((s) => s.command === command)) break;
          throw new Error(
            `"${command}" 의 ${slot + 1}번째 인자를 읽지 못했다 (offset ${index})`,
          );
        }
        args.push(value);
      }
      if (args.length === 0) break;
      if (args.length !== arity) {
        throw new Error(
          `"${command}" 가 인자 ${args.length}개로 끝났다 — ${arity}개가 필요하다`,
        );
      }
      segments.push({ command, args });

      skipSeparators();
      const next = d[index];
      if (next === undefined || !/[-+.\d]/.test(next)) break;
    }
  }

  return segments;
}

/** 명령의 «끝점»만 따라간다. 곡선 극점은 보지 않는다 — 좌표계가 맞는지 보려는 것이다. */
function anchorBounds(segments: Segment[]) {
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const visit = () => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const { command, args } of segments) {
    const relative = command === command.toLowerCase();
    const lower = command.toLowerCase();

    if (lower === "z") {
      x = startX;
      y = startY;
      visit();
      continue;
    }
    if (lower === "h") {
      x = relative ? x + args[0]! : args[0]!;
    } else if (lower === "v") {
      y = relative ? y + args[0]! : args[0]!;
    } else {
      const endX = args[args.length - 2]!;
      const endY = args[args.length - 1]!;
      x = relative ? x + endX : endX;
      y = relative ? y + endY : endY;
    }
    if (lower === "m") {
      startX = x;
      startY = y;
    }
    visit();
  }

  return { minX, minY, maxX, maxY };
}

describe("GITHUB_MARK_PATH", () => {
  it("모든 명령이 필요한 인자 수를 채운다 — 중간에 잘려 버려지지 않는다", () => {
    const segments = parsePath(GITHUB_MARK_PATH);

    expect(segments.length).toBeGreaterThan(0);
    for (const { command, args } of segments) {
      expect
        .soft(args.length, `"${command}" 의 인자 수`)
        .toBe(ARGUMENT_COUNT[command.toLowerCase()]);
    }
  });

  it("path 를 끝까지 읽는다 — 마지막 명령이 subpath 를 닫는다", () => {
    const segments = parsePath(GITHUB_MARK_PATH);

    expect(segments[0]!.command).toBe("M");
    expect(segments[segments.length - 1]!.command.toLowerCase()).toBe("z");
  });

  it("좌표가 viewBox 16×16 안에 있다 — 24×24 좌표계를 잘못 넣지 않는다", () => {
    const { minX, minY, maxX, maxY } = anchorBounds(parsePath(GITHUB_MARK_PATH));

    expect(minX).toBeGreaterThanOrEqual(0);
    expect(minY).toBeGreaterThanOrEqual(0);
    expect(maxX).toBeLessThanOrEqual(16);
    expect(maxY).toBeLessThanOrEqual(16);

    // 마크가 viewBox 를 «채운다». 한쪽만 남으면 여기서 걸린다.
    expect(maxX - minX).toBeGreaterThan(15);
    expect(maxY - minY).toBeGreaterThan(15);
  });

  it("깨진 판을 다시 넣으면 실제로 실패한다", () => {
    // 🔴 고치기 전의 문자열 그대로다. 이것이 통과하면 위 시험들은 가짜다.
    const broken =
      "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0.67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2.27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0.21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z";

    expect(() => parsePath(broken)).toThrow();
  });
});
