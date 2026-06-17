import fs from "node:fs";
import path from "node:path";
import { po } from "gettext-parser";
import type { LinguiTranslateAiConfig } from "../config";

export type DetectedLocaleFile = {
  locale: string;
  poPath: string;
  totalMessages: number;
  emptyMessages: number;
};

export type LinguiProjectDetection = {
  cwd: string;
  projectRoot: string | null;
  packageJsonPath: string | null;
  hasPackageJson: boolean;
  hasLinguiDependency: boolean;
  hasLinguiConfig: boolean;
  localeFiles: DetectedLocaleFile[];
  isLikelyLinguiProject: boolean;
};

function findUp(startDir: string, fileName: string): string | null {
  let current = startDir;

  while (true) {
    const candidate = path.join(current, fileName);

    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);

    if (parent === current) {
      return null;
    }

    current = parent;
  }
}

function readPackageJson(packageJsonPath: string | null): any | null {
  if (!packageJsonPath) return null;

  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch {
    return null;
  }
}

function hasAnyLinguiDependency(packageJson: any | null): boolean {
  if (!packageJson) return false;

  const allDeps = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  };

  return Object.keys(allDeps).some((dep) => dep.startsWith("@lingui/"));
}

function detectLinguiConfig(projectRoot: string | null): boolean {
  if (!projectRoot) return false;

  const possibleConfigFiles = [
    "lingui.config.js",
    "lingui.config.cjs",
    "lingui.config.mjs",
    "lingui.config.ts",
  ];

  return possibleConfigFiles.some((fileName) =>
    fs.existsSync(path.join(projectRoot, fileName)),
  );
}

function countPoMessages(poPath: string) {
  const poParser = po.parse(fs.readFileSync(poPath));

  let totalMessages = 0;
  let emptyMessages = 0;

  for (const context of Object.keys(poParser.translations)) {
    for (const msgid of Object.keys(poParser.translations[context])) {
      if (!msgid) continue;

      totalMessages += 1;

      const msgstr = poParser.translations[context][msgid]?.msgstr?.[0];

      if (typeof msgstr !== "string" || !msgstr.trim()) {
        emptyMessages += 1;
      }
    }
  }

  return {
    totalMessages,
    emptyMessages,
  };
}

function scanLocaleFiles({
  projectRoot,
  config,
}: {
  projectRoot: string | null;
  config: LinguiTranslateAiConfig;
}): DetectedLocaleFile[] {
  if (!projectRoot) return [];

  const absoluteLocalesDir = path.resolve(projectRoot, config.localesDir);

  if (!fs.existsSync(absoluteLocalesDir)) {
    return [];
  }

  const localeDirs = fs
    .readdirSync(absoluteLocalesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const localeFiles: DetectedLocaleFile[] = [];

  for (const locale of localeDirs) {
    const poPath = path.join(absoluteLocalesDir, locale, config.poFileName);

    if (!fs.existsSync(poPath)) continue;

    const counts = countPoMessages(poPath);

    localeFiles.push({
      locale,
      poPath,
      ...counts,
    });
  }

  return localeFiles;
}

export function detectLinguiProject({
  cwd,
  config,
}: {
  cwd: string;
  config: LinguiTranslateAiConfig;
}): LinguiProjectDetection {
  const packageJsonPath = findUp(cwd, "package.json");
  const projectRoot = packageJsonPath ? path.dirname(packageJsonPath) : null;

  const packageJson = readPackageJson(packageJsonPath);
  const hasPackageJson = Boolean(packageJsonPath);
  const hasLinguiDependency = hasAnyLinguiDependency(packageJson);
  const hasLinguiConfig = detectLinguiConfig(projectRoot);
  const localeFiles = scanLocaleFiles({ projectRoot, config });

  return {
    cwd,
    projectRoot,
    packageJsonPath,
    hasPackageJson,
    hasLinguiDependency,
    hasLinguiConfig,
    localeFiles,
    isLikelyLinguiProject:
      hasPackageJson &&
      (hasLinguiDependency || hasLinguiConfig) &&
      localeFiles.length > 0,
  };
}
