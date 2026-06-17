#!/usr/bin/env node

import "dotenv/config";
import { Command } from "commander";
import { runInitCommand } from "./commands/init.js";
import { runTranslateCommand } from "./commands/translate";

const program = new Command();

program
  .name("lingui-translate-ai")
  .description(
    "AI-powered translation and repair tools for Lingui PO translations",
  )
  .version("0.1.0");

program
  .command("init")
  .description("Create a lingui-translate-ai.json config file")
  .action(() => {
    runInitCommand();
  });

program
  .command("translate")
  .description("Translate Lingui PO translations with AI")
  .option("--only-empty", "Only send empty translations")
  .option("--locale <locale>", "Translate only one locale")
  .option(
    "--max-translations-per-request <number>",
    "Maximum translations to include in one AI request",
  )
  .option(
    "--max-requests <number>",
    "Maximum AI requests to run before stopping",
  )
  .option(
    "--max-translations <number>",
    "Maximum total translations to send before stopping",
  )
  .option("--dry-run", "Show changes without writing files")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (options) => {
    await runTranslateCommand(options);
  });

program.parse();
