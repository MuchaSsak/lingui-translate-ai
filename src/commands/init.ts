import { createDefaultConfig, writeDefaultConfig } from "../config";
import { detectLinguiProject } from "../utils/detectLinguiProject";
import { logger } from "../utils/logger";

export function runInitCommand(projectRoot = process.cwd()) {
  const defaultConfig = createDefaultConfig();

  const detection = detectLinguiProject({
    cwd: projectRoot,
    config: defaultConfig,
  });

  if (!detection.hasPackageJson || !detection.projectRoot) {
    logger.error(
      "This does not look like a package.json project. Run this command from your project root.",
    );
    process.exit(1);
  }

  if (!detection.hasLinguiDependency && !detection.hasLinguiConfig) {
    logger.error(
      "This does not look like a Lingui project. No @lingui dependency or lingui.config.* file was detected.",
    );
    process.exit(1);
  }

  if (detection.localeFiles.length === 0) {
    logger.error(
      `No locale PO files were detected. Expected something like: ${defaultConfig.localesDir}/*/${defaultConfig.poFileName}`,
    );
    process.exit(1);
  }

  const result = writeDefaultConfig(detection.projectRoot);

  if (result.created) {
    logger.success(`Created ${result.configPath}`);
  } else {
    logger.warn(`Config already exists: ${result.configPath}`);
  }

  logger.info("Review the config before running translations.");
}
