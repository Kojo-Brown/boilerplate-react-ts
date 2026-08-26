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
});

export const env = envSchema.parse(import.meta.env);
