import { z } from "zod";

import { normalizeSlug } from "@/lib/workspace/slug";

/**
 * Project 생성·수정 입력 계약.
 *
 * 🔴 **검증 규칙을 Component 안의 `if` 로 흩뿌리지 않는다. 여기에 둔다**(CLAUDE.md 9).
 * 화면(React Hook Form)과 Server Action 이 **같은 Schema 하나**를 본다 — 두 곳에 따로
 * 적으면 브라우저는 통과시키는데 서버는 거절하는 값이 생긴다.
 */

const NAME_MAX = 100;
const SLUG_MAX = 40;
const DESCRIPTION_MAX = 500;

/**
 * slug 로 쓸 수 없는 이름.
 *
 * `/w/{ws}/p/{projectSlug}` 아래에 Project 의 Section 이 온다. Section 과 같은 이름의
 * Project 를 만들면 주소가 갈린다.
 */
const RESERVED_SLUGS: readonly string[] = [
  "new",
  "reviews",
  "issues",
  // 🔴 `knowledge` 는 예전 주소다. 지금은 `wiki` 를 쓰지만, 예약어에서 빼면
  // 그 이름의 Project 가 만들어져 옛 링크와 부딪힌다.
  "knowledge",
  "wiki",
  "repositories",
  "settings",
];

export const createProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Project 이름을 입력하세요.")
    .max(NAME_MAX, `Project 이름은 ${NAME_MAX}자를 넘을 수 없습니다.`),
  /**
   * 비워 두면 이름에서 만든다.
   *
   * 🔴 **정규화를 화면과 서버가 같은 함수로 한다**(`normalizeSlug`). 한쪽만 정규화하면
   * 사용자가 본 주소와 저장된 주소가 갈린다.
   */
  slug: z
    .string()
    .trim()
    .max(SLUG_MAX, `slug 는 ${SLUG_MAX}자를 넘을 수 없습니다.`)
    .default(""),
  description: z
    .string()
    .trim()
    .max(DESCRIPTION_MAX, `설명은 ${DESCRIPTION_MAX}자를 넘을 수 없습니다.`)
    .default(""),
});

/**
 * 🔴 **입력 타입과 출력 타입을 나눈다.**
 *
 * `.default("")` 이 붙은 필드는 **넣을 때는 없어도 되고 나올 때는 반드시 있다.**
 * React Hook Form 은 사용자가 «넣는» 모양을 다루고, Server Action 은 Schema 를 통과한
 * «나온» 모양을 다룬다 — 한 타입으로 뭉치면 둘 중 하나가 거짓말이 된다.
 */
export type CreateProjectFormValues = z.input<typeof createProjectSchema>;
export type CreateProjectInput = z.output<typeof createProjectSchema>;

/**
 * 저장 직전의 값으로 좁힌다.
 *
 * Schema 가 형식을 보고, 여기서 **실제로 저장되는 모양**을 만든다 — 빈 설명은 `null` 로,
 * slug 는 정규화된 값으로.
 *
 * @throws 예외를 던지지 않는다. slug 가 예약어면 그 사실을 결과로 알린다.
 */
export interface ResolvedProjectInput {
  name: string;
  slug: string;
  description: string | null;
}

export function resolveProjectInput(
  input: CreateProjectInput,
): { ok: true; value: ResolvedProjectInput } | { ok: false; reason: string } {
  const slug = normalizeSlug(input.slug === "" ? input.name : input.slug);

  if (RESERVED_SLUGS.includes(slug)) {
    return {
      ok: false,
      reason: `'${slug}' 는 화면 주소로 쓰이는 이름이라 Project slug 로 쓸 수 없습니다.`,
    };
  }

  return {
    ok: true,
    value: {
      name: input.name,
      slug,
      description: input.description === "" ? null : input.description,
    },
  };
}
