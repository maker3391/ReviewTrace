"use client";

import { useEffect, useRef } from "react";
import {
  useForm,
  type FieldValues,
  type Resolver,
  type UseFormProps,
  type UseFormReturn,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";

import { useLocale } from "@/lib/ui/locale-context";
import { parseOptions } from "@/lib/validation/zod-error-map";

/**
 * 폼 하나의 검증 경계.
 *
 * `useForm` + `zodResolver` 를 쓰는 자리는 아홉 군데인데, 그 아홉이 모두
 * **「이 언어로 Zod 오류를 적어라」**를 똑같이 적어야 한다. 한 곳이라도 빠지면 그 폼만
 * 영어 기본값으로 되돌아가므로 여기 한 번만 적는다.
 *
 * ```text
 * useLocalizedForm(schema)
 * -> zodResolver(schema, { error: validationErrorMap(locale) }) per-parse 경계
 * -> Zod issue -> 사전의 문구
 * ```
 *
 * 🔴 **검증 규칙은 그대로다.** 바뀌는 것은 오류를 «무슨 말로 적는가»뿐이고, Schema 는
 * 화면과 Server Action 이 **같은 것 하나**를 계속 쓴다.
 *
 * 🔴 **`z.config` 를 건드리지 않는다.** 언어는 parse 하나에만 실려 가므로, 같은 순간
 * 다른 언어로 도는 다른 폼·다른 요청에 영향이 없다.
 *
 * ## 🔴 언어를 바꿨을 때 옛 문구가 남지 않게 한다
 *
 * React Hook Form 은 **이미 만들어진 문자열**을 상태로 들고 있다. 언어를 바꾸면 서버가
 * 화면을 다시 그리지만 폼은 살아 있으므로, 아무것도 하지 않으면 칸 아래에 **바꾸기 전
 * 언어의 오류가 그대로** 남는다. 그래서 언어가 실제로 바뀐 순간, 오류가 떠 있는 폼만
 * 다시 검증해 새 언어로 적는다 — 값도 규칙도 건드리지 않는다.
 */
export function useLocalizedForm<
  TFieldValues extends FieldValues = FieldValues,
  TContext = unknown,
  TTransformedValues = TFieldValues,
>(
  schema: z.ZodType<unknown, TFieldValues>,
  options?: Omit<
    UseFormProps<TFieldValues, TContext, TTransformedValues>,
    "resolver"
  >,
): UseFormReturn<TFieldValues, TContext, TTransformedValues> {
  const locale = useLocale();

  const form = useForm<TFieldValues, TContext, TTransformedValues>({
    ...options,
    /*
 Schema 의 입력·출력 타입은 부르는 쪽이 이미 못 박아 두었다(`z.input`·`z.output`).
 여기서는 그 짝을 다시 세우지 않고 RHF 의 Resolver 계약으로만 좁힌다.
 */
    resolver: zodResolver(schema, parseOptions(locale)) as unknown as Resolver<
      TFieldValues,
      TContext,
      TTransformedValues
    >,
  } as UseFormProps<TFieldValues, TContext, TTransformedValues>);

  const { trigger, formState } = form;
  const renderedLocale = useRef(locale);

  useEffect(() => {
    if (renderedLocale.current === locale) {
      return;
    }
    renderedLocale.current = locale;

    // 오류가 떠 있지 않으면 다시 검증하지 않는다 — 건드린 적 없는 폼을 붉게 만들지 않는다.
    if (Object.keys(formState.errors).length > 0) {
      void trigger();
    }
  }, [locale, trigger, formState]);

  return form;
}
