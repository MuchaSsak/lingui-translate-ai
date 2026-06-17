# Contributing

Thanks for contributing to `lingui-translate-ai`.

This is a TypeScript CLI for translating, repairing, and validating Lingui PO files with AI.

## Setup

```sh
git clone https://github.com/YOUR_USERNAME/lingui-translate-ai.git
cd lingui-translate-ai
npm install
```

Run locally:

```sh
npm run dev -- --help
npm run dev -- translate --help
```

Build:

```sh
npm run build
```

Type-check:

```sh
npm run typecheck
```

Link locally:

```sh
npm link
```

Then test from a real Lingui project:

```sh
lingui-translate-ai init
lingui-translate-ai translate --dry-run
```

## Project structure

```txt
src/
  cli.ts
  commands/
    init.ts
    translate.ts
  config/
    config.ts
  lingui/
    detectLinguiProject.ts
  ai/
    systemPrompt.ts
  utils/
    confirm.ts
    logger.ts
```

Recommended split as the package grows:

```txt
src/
  cli.ts

  commands/
    init.ts
    translate.ts
    inspect.ts

  config/
    config.ts
    schema.ts
    defaultConfig.ts

  lingui/
    detectLinguiProject.ts
    readPo.ts
    patchPo.ts
    scanLocales.ts

  ai/
    openrouter.ts
    batching.ts
    integrity.ts
    systemPrompt.ts

  utils/
    confirm.ts
    logger.ts
    filesystem.ts
```

## Internal flow

### 1. CLI command

The command starts in:

```txt
src/cli.ts
```

The main command is:

```sh
lingui-translate-ai translate
```

The command loads config, checks the project, previews the run, asks for confirmation, and then starts batching AI requests.

### 2. Project guards

The CLI must not run in unrelated folders.

Before creating config or translating, it checks:

- `package.json` exists
- Lingui is detected through dependencies or `lingui.config.*`
- locale PO files exist

If checks fail, the CLI exits.

### 3. Config loading

The CLI reads:

```txt
lingui-translate-ai.json
```

If config is missing in a valid Lingui project, it creates the config and exits.

This prevents accidental AI requests with default settings.

### 4. Locale resolution

Locale selection order:

1. `--locale` restricts the run to one locale.
2. If `config.locales` has items, use those locales.
3. If `config.locales` is empty, scan every locale folder.
4. Always skip `sourceLocale`.

Supported locale config formats:

```json
{
  "locales": []
}
```

```json
{
  "locales": ["pl", "ar"]
}
```

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

### 5. Source map

The source PO file is read from:

```txt
{localesDir}/{sourceLocale}/{poFileName}
```

The CLI assigns stable source IDs:

```txt
s0
s1
s2
```

Payload example:

```json
{
  "srcs": {
    "s0": {
      "src": "Continue"
    },
    "s1": {
      "src": "Import CSV",
      "ctx": "button label"
    }
  }
}
```

### 6. Target map

The target payload is grouped by locale:

```json
{
  "files": {
    "pl": {
      "lng": "Polish",
      "loc": "pl-PL",
      "trgs": {
        "s0": "",
        "s1": "Import CSV"
      }
    }
  }
}
```

When `onlyEmptyTranslations` is true, only empty translations are included.

When false, all selected translations are included.

### 7. AI output

The expected output is nested by locale:

```json
{
  "pl": {
    "s0": "Kontynuuj"
  }
}
```

Flat output is wrong for multi-locale batches:

```json
{
  "s0": "Kontynuuj"
}
```

The parser should fail loudly when the model returns flat output for a multi-locale batch.

### 8. Batching

`maxTranslationsPerRequest` controls batch size.

Example:

```json
{
  "maxTranslationsPerRequest": 100
}
```

This means one AI request can contain up to 100 translations.

It does not limit the full run.

### 9. Run caps

These fields limit the total run:

```json
{
  "maxRequestsPerRun": 10,
  "maxTranslationsPerRun": 1000
}
```

The loop stops when either cap is reached.

This protects users from accidentally sending thousands of translations in one run.

### 10. Prompt caching

The request is split into stable and dynamic content blocks.

Stable and cacheable:

- system prompt
- English source map

Dynamic and not cacheable:

- target translation map

This allows compatible providers to reuse stable prompt/source content between requests.

Cache hits depend on:

- provider support
- model support
- provider routing stability
- cache TTL
- identical cacheable content

Provider switching can reduce cache hits.

### 11. Placeholder integrity

The CLI checks placeholders and tags before writing corrections.

Examples:

```txt
{count}
{value}
{aiCreditsLabel}
<0>
</0>
```

If the model misses a token, the CLI tries to repair it.

If repair fails, the correction is ignored.

### 12. Raw PO patching

When `rawPatchMode` is true, the CLI patches only changed `msgstr` blocks.

This avoids reformatting unchanged entries.

Do not switch to full PO serialization unless there is a strong reason.

### 13. Backups

When `backupBeforeWrite` is true, the CLI creates:

```txt
messages.po.bak
```

before writing changes.

Backups should not usually be committed.

### 14. Dry run

When `dryRun` is true, the CLI does not write files.

It is still allowed to call the AI and print proposed changes.

Use dry run for testing, debugging, and reviewing model behavior.

## Manual testing checklist

### Outside a Node project

```sh
lingui-translate-ai init
lingui-translate-ai translate
```

Expected: fail.

### Node project without Lingui

```sh
lingui-translate-ai init
lingui-translate-ai translate
```

Expected: fail.

### Valid Lingui project without config

```sh
lingui-translate-ai translate
```

Expected: create config and exit.

### Missing API key

```sh
lingui-translate-ai translate
```

Expected: clean error telling user which env var is missing.

### Dry run

```sh
lingui-translate-ai translate --dry-run --max-requests 1
```

Expected: no PO files modified.

### One locale

```sh
lingui-translate-ai translate --locale pl --max-requests 1
```

Expected: only Polish processed.

### Run caps

```sh
lingui-translate-ai translate --max-translations-per-request 100 --max-requests 1 --max-translations 100
```

Expected: at most one request and 100 translations.

### Placeholder repair

Use a source string with a placeholder:

```txt
{count} words
```

Expected: output preserves or repairs `{count}`.

### Raw patch mode

Expected: unchanged PO entries are not reformatted.

## Release checklist

```sh
npm run typecheck
npm run build
```

Test package contents:

```sh
npm pack --dry-run
```

Test linked binary:

```sh
npm link
lingui-translate-ai --help
lingui-translate-ai translate --help
```

Publish:

```sh
npm publish
```

For scoped public packages:

```sh
npm publish --access public
```

## Commit style

Use clear commit messages:

```txt
feat: add max translations per run
fix: reject flat model output for multi-locale batches
docs: explain dry run and backup files
refactor: split OpenRouter request code
```
