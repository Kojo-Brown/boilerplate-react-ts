import { z } from "zod";

const envSchema = z.object({
  VITE_API_URL: z.url().default("http://localhost:4000"),
  VITE_AUTH_DOMAIN: z.string().optional(),
  VITE_CLIENT_ID: z.string().optional(),
  VITE_GOOGLE_CLIENT_ID: z.string().optional(),
  VITE_REDIRECT_URI: z.string().optional(),
  // `.default()` must come before `.transform()`: in Zod 4 a default applied
  // after a transform is typed against the transform's *output* (boolean), so
  // defaulting to the string "false" there is a type error.
  VITE_ENABLE_DEVTOOLS: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  // Where Core Web Vitals are POSTed. Empty means "do not report": the
  // reporter then subscribes to nothing rather than collecting into a sink
  // that discards. Validated as a URL so a typo fails at boot instead of
  // producing a build that silently sends nothing.
  VITE_ANALYTICS_URL: z.union([z.literal(""), z.url()]).default(""),
  // Share of *visits* that report vitals, 0–1. See `docs/web-vitals.md` for
  // why the roll is per visit rather than per metric.
  VITE_VITALS_SAMPLE_RATE: z
    .string()
    .default("1")
    .transform((v) => Number(v))
    .refine((rate) => Number.isFinite(rate) && rate >= 0 && rate <= 1, {
      message: "VITE_VITALS_SAMPLE_RATE must be a number between 0 and 1",
    }),
});

export const env = envSchema.parse(import.meta.env);
