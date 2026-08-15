import { z } from "zod";
const schema = z.object({
  PORT: z.coerce.number().int().positive().default(4103),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1),
  INTERNAL_SERVICE_TOKEN: z.string().min(32),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});
export type HubConfig = z.infer<typeof schema>;
export const loadConfig = (env: NodeJS.ProcessEnv = process.env) =>
  schema.parse(env);
