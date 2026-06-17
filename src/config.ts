import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export const CONFIG_FILE_NAME = "lingui-translate-ai.json";

export type LocaleConfigInput = z.infer<typeof LocaleConfigSchema>;

const LocaleConfigSchema = z.union([
  z.string(),
  z.object({
    labelRaw: z.string(),
    locale: z.string(),
    fullLocale: z.string(),
  }),
]);

export const LinguiTranslateAiConfigSchema = z.object({
  provider: z.literal("openrouter").default("openrouter"),
  model: z.string().default("openai/gpt-4o-mini"),
  apiKeyEnv: z.string().default("OPENROUTER_API_KEY"),
  systemPrompt: z.string().min(1).nullable().default(null),

  sourceLocale: z.string().default("en"),
  localesDir: z.string().default("src/locales"),
  poFileName: z.string().default("messages.po"),

  onlyEmptyTranslations: z.boolean().default(true),
  maxTranslationsPerRequest: z
    .number()
    .int()
    .positive()
    .nullable()
    .default(100),

  maxRequestsPerRun: z.number().int().positive().nullable().default(10),

  maxTranslationAttempts: z.number().int().positive().default(1),

  maxTranslationsPerRun: z.number().int().positive().nullable().default(1000),

  rawPatchMode: z.boolean().default(true),
  dryRun: z.boolean().default(false),
  backupBeforeWrite: z.boolean().default(true),

  openrouter: z
    .object({
      sessionId: z.string().default("lingui-translate-ai-translation"),
      cache: z
        .object({
          enabled: z.boolean().default(true),
          ttl: z.enum(["5m", "1h"]).default("1h"),
        })
        .default({
          enabled: true,
          ttl: "1h",
        }),
      provider: z
        .object({
          sort: z.enum(["price", "throughput", "latency"]).default("price"),
          require_parameters: z.boolean().default(true),
          only: z.array(z.string()).optional(),
          ignore: z.array(z.string()).optional(),
        })
        .default({
          sort: "price",
          require_parameters: true,
        }),
    })
    .default({
      sessionId: "lingui-translate-ai-translation",
      cache: {
        enabled: true,
        ttl: "1h",
      },
      provider: {
        sort: "price",
        require_parameters: true,
      },
    }),

  locales: z.array(LocaleConfigSchema).default([]),
});

export type LinguiTranslateAiConfig = z.infer<
  typeof LinguiTranslateAiConfigSchema
>;

export function getConfigPath(projectRoot: string) {
  return path.join(projectRoot, CONFIG_FILE_NAME);
}

export function createDefaultConfig(): LinguiTranslateAiConfig {
  return LinguiTranslateAiConfigSchema.parse({});
}

export function writeDefaultConfig(projectRoot: string) {
  const configPath = getConfigPath(projectRoot);

  if (fs.existsSync(configPath)) {
    return {
      created: false,
      configPath,
    };
  }

  fs.writeFileSync(
    configPath,
    JSON.stringify(createDefaultConfig(), null, 2) + "\n",
  );

  return {
    created: true,
    configPath,
  };
}

export function loadConfig(
  projectRoot: string,
): LinguiTranslateAiConfig | null {
  const configPath = getConfigPath(projectRoot);

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);

    return LinguiTranslateAiConfigSchema.parse(parsed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join(".") : "root";
          return `- ${path}: ${issue.message}`;
        })
        .join("\n");

      throw new Error(`Invalid lingui-translate-ai.json:\n${issues}`);
    }

    throw error;
  }
}
