# lingui-translate-ai

AI-powered translation, repair, and consistency tooling for Lingui PO files.

`lingui-translate-ai` helps translate missing strings from scratch, repair existing translations, and keep terminology consistent across complete localization files.

It is designed for projects using Lingui `.po` catalogs.

## Features

- Translate empty `msgstr` values from scratch
- Repair existing translations
- Detect copied English that should be translated
- Keep repeated product terminology consistent
- Preserve Lingui placeholders and rich-text tags
- Patch PO files without reformatting unchanged entries
- Combine small locale jobs into efficient AI requests
- Limit requests and translations per run for safety
- Create `.bak` backups before writing
- Support dry-run mode
- Support custom system prompts from config
- Support `.env` files for API keys
- Require confirmation before running unless `--yes` is passed

## Installation

Run directly:

```sh
npx lingui-translate-ai init
npx lingui-translate-ai translate
```

Or install locally:

```sh
npm install -D lingui-translate-ai
```

Add a script:

```json
{
  "scripts": {
    "translate:ai": "lingui-translate-ai translate"
  }
}
```

## Requirements

Run the CLI from a Lingui project root.

The CLI checks for:

- `package.json`
- a Lingui dependency such as `@lingui/core`, `@lingui/react`, or `@lingui/cli`
- or a `lingui.config.*` file
- locale folders containing PO files

Example structure:

```txt
src/locales/en/messages.po
src/locales/pl/messages.po
src/locales/ar/messages.po
```

If the folder does not look like a Lingui project, the CLI exits.

## Quick start

Create config:

```sh
npx lingui-translate-ai init
```

This creates:

```txt
lingui-translate-ai.json
```

Review the config before running translation.

Then run:

```sh
npx lingui-translate-ai translate
```

Before any AI request is sent, the CLI prints a preview with:

- model
- provider
- source locale
- locale files detected
- translations to send
- estimated requests without caps
- request and translation safety caps
- dry-run status
- backup status

The CLI asks for confirmation:

```txt
Continue with this translation run? [y/N]
```

Use `--yes` to skip confirmation:

```sh
npx lingui-translate-ai translate --yes
```

## API key

By default the CLI reads:

```txt
OPENROUTER_API_KEY
```

You can define it in your shell:

```sh
OPENROUTER_API_KEY=sk-or-...
```

Or in a `.env` file in your project root:

```env
OPENROUTER_API_KEY=sk-or-...
```

The package loads `.env` automatically.

## Common commands

Translate only empty strings:

```sh
npx lingui-translate-ai translate --only-empty
```

Translate one locale:

```sh
npx lingui-translate-ai translate --locale pl
```

Run without writing files:

```sh
npx lingui-translate-ai translate --dry-run
```

Limit one run to 100 translations:

```sh
npx lingui-translate-ai translate --max-translations 100
```

Limit one request to 100 translations:

```sh
npx lingui-translate-ai translate --max-translations-per-request 100
```

Limit the run to 3 AI requests:

```sh
npx lingui-translate-ai translate --max-requests 3
```

Debug raw model output:

```sh
LINGUI_TRANSLATE_AI_DEBUG=1 npx lingui-translate-ai translate --max-requests 1
```

PowerShell:

```powershell
$env:LINGUI_TRANSLATE_AI_DEBUG="1"
npx lingui-translate-ai translate --max-requests 1
```

## Translation modes

### Empty-only translation

When `onlyEmptyTranslations` is `true`, only empty target translations are sent.

```json
{
  "onlyEmptyTranslations": true
}
```

Use this after extracting new Lingui strings.

### Full repair mode

When `onlyEmptyTranslations` is `false`, all selected translations are sent.

```json
{
  "onlyEmptyTranslations": false
}
```

Use this when you want the model to repair:

- bad translations
- copied English
- inconsistent terminology
- unnatural wording
- placeholder mistakes
- overly literal UI text

## Safety caps

The CLI separates request size from run size.

```json
{
  "maxTranslationsPerRequest": 100,
  "maxRequestsPerRun": 10,
  "maxTranslationsPerRun": 1000
}
```

Meaning:

```txt
maxTranslationsPerRequest = maximum strings in one AI request
maxRequestsPerRun = maximum AI requests before stopping
maxTranslationsPerRun = maximum total strings sent before stopping
```

Example:

```json
{
  "maxTranslationsPerRequest": 100,
  "maxRequestsPerRun": 3,
  "maxTranslationsPerRun": 300
}
```

This scans all selected locales but sends at most:

```txt
100 translations per request
3 requests
300 translations total
```

## Backups

When `backupBeforeWrite` is enabled, the CLI creates a backup before modifying a PO file.

```json
{
  "backupBeforeWrite": true
}
```

Example:

```txt
src/locales/pl/messages.po
src/locales/pl/messages.po.bak
```

The `.bak` file is a copy of the original file before AI changes.

To restore in PowerShell:

```powershell
Copy-Item src/locales/pl/messages.po.bak src/locales/pl/messages.po -Force
```

You can delete `.bak` files after reviewing and committing the generated translations.

## Dry run

When `dryRun` is enabled, the CLI runs the translation pipeline but does not write files.

```json
{
  "dryRun": true
}
```

Or:

```sh
npx lingui-translate-ai translate --dry-run
```

Use dry run to inspect:

- detected locales
- request count
- model output
- proposed fixes
- ignored unsafe fixes

No `.po` files are modified in dry-run mode.

## PO formatting preservation

By default:

```json
{
  "rawPatchMode": true
}
```

The CLI patches only changed `msgstr` blocks in the original PO text.

This avoids noisy formatting changes from reserializing the whole file.

Recommended: keep `rawPatchMode` enabled.

## Placeholder safety

The CLI checks that placeholders and tags from the source string are preserved.

Examples:

```txt
{count}
{value}
{aiCreditsLabel}
<0>
</0>
```

If the model forgets a placeholder, the CLI tries to repair it.

If the correction cannot be repaired safely, it is ignored and logged.

## Locale selection

If `locales` is empty, every locale folder under `localesDir` is scanned except the source locale:

```json
{
  "locales": []
}
```

You can also specify locales as strings:

```json
{
  "locales": ["pl", "ar", "de"]
}
```

Or with full metadata:

```json
{
  "locales": [
    {
      "labelRaw": "Polish",
      "locale": "pl",
      "fullLocale": "pl-PL"
    }
  ]
}
```

Use `--locale` to restrict one run:

```sh
npx lingui-translate-ai translate --locale pl
```

## Custom system prompt

By default, the package uses its built-in translation prompt.

Override it in config:

```json
{
  "systemPrompt": "You are a professional localization translator. Return only nested JSON corrections..."
}
```

Use `null` to use the built-in prompt:

```json
{
  "systemPrompt": null
}
```

The output shape must stay nested by locale:

```json
{
  "pl": {
    "s0": "Kontynuuj"
  }
}
```

## Recommended workflow

1. Extract Lingui messages.
2. Run dry-run mode:

```sh
npx lingui-translate-ai translate --only-empty --dry-run
```

3. Review the preview and proposed changes.
4. Run for real:

```sh
npx lingui-translate-ai translate --only-empty
```

5. Review changed PO files.
6. Run your normal Lingui compile/build/test commands.
7. Commit the translation changes.
