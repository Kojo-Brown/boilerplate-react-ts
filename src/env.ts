import { z } from "zod";

const envSchema = z.object({
  VITE_API_URL: z.string().url().default("http://localhost:4000"),
  VITE_AUTH_DOMAIN: z.string().optional(),
  VITE_CLIENT_ID: z.string().optional(),
  VITE_GOOGLE_CLIENT_ID: z.string().optional(),
  VITE_REDIRECT_URI: z.string().optional(),
  VITE_ENABLE_DEVTOOLS: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
});

export const env = envSchema.parse(import.meta.env);
