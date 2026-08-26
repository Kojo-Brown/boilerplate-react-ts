import {
  useForm,
  type FieldValues,
  type Resolver,
  type UseFormProps,
  type UseFormReturn,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { type ZodType } from "zod";

/**
 * `useForm` pre-wired to a Zod schema.
 *
 * The schema is constrained to produce a `FieldValues` shape so react-hook-form
 * can infer field paths. Input and output types are tracked separately, which
 * matters for schemas that transform (e.g. `z.coerce.number()`).
 */
export function useZodForm<TSchema extends ZodType<FieldValues, FieldValues>>(
  schema: TSchema,
  options?: Omit<UseFormProps<z.input<TSchema>, unknown, z.output<TSchema>>, "resolver">,
): UseFormReturn<z.input<TSchema>, unknown, z.output<TSchema>> {
  return useForm<z.input<TSchema>, unknown, z.output<TSchema>>({
    ...options,
    // zodResolver is typed against the erased FieldValues shape; re-assert it
    // against this schema's concrete input/output types.
    resolver: zodResolver(schema) as unknown as Resolver<
      z.input<TSchema>,
      unknown,
      z.output<TSchema>
    >,
  });
}
