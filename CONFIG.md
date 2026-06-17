# Configuration

`lingui-translate-ai` reads config from:

```txt
lingui-translate-ai.json
```

Create it with:

```sh
npx lingui-translate-ai init
```

The CLI exits after creating config so you can review it before making AI requests.

## Example config

```json
{
  "provider": "openrouter",
  "model": "openai/gpt-4o-mini",
  "apiKeyEnv": "OPENROUTER_API_KEY",
  "systemPrompt": null,

  "sourceLocale": "en",
  "localesDir": "src/locales",
  "poFileName": "messages.po",

  "onlyEmptyTranslations": true,

  "maxTranslationsPerRequest": 100,
  "maxRequestsPerRun": 10,
  "maxTranslationsPerRun": 1000,

  "maxTranslationAttempts": 1,

  "rawPatchMode": true,
  "dryRun": false,
  "backupBeforeWrite": true,

  "openrouter": {
    "sessionId": "lingui-translate-ai-translation",
    "cache": {
      "enabled": true,
      "ttl": "1h"
    },
    "provider": {
      "sort": "price",
      "require_parameters": true
    }
  },

  "locales": []
}
```

## `provider`

```json
{
  "provider": "openrouter"
}
```

The AI provider backend.

Currently supported:

```txt
openrouter
```

## `model`

```json
{
  "model": "openai/gpt-4o-mini"
}
```

The model passed to the provider.

Use a model that follows JSON output reliably.

## `apiKeyEnv`

```json
{
  "apiKeyEnv": "OPENROUTER_API_KEY"
}
```

The environment variable containing the API key.

The CLI loads `.env` automatically, so this works:

```env
OPENROUTER_API_KEY=sk-or-...
```

## `systemPrompt`

```json
{
  "systemPrompt": null
}
```

Use `null` for the built-in prompt.

Use a string to override it:

```json
{
  "systemPrompt": "You are a professional localization translator..."
}
```

A custom prompt must preserve the expected output format:

```json
{
  "locale": {
    "sourceId": "corrected translation"
  }
}
```

Example:

```json
{
  "pl": {
    "s0": "Kontynuuj"
  }
}
```

## `sourceLocale`

```json
{
  "sourceLocale": "en"
}
```

The source locale folder.

Expected source PO path:

```txt
{localesDir}/{sourceLocale}/{poFileName}
```

Example:

```txt
src/locales/en/messages.po
```

## `localesDir`

```json
{
  "localesDir": "src/locales"
}
```

Directory containing locale folders.

Example:

```txt
src/locales/en/messages.po
src/locales/pl/messages.po
src/locales/ar/messages.po
```

## `poFileName`

```json
{
  "poFileName": "messages.po"
}
```

PO file name inside every locale folder.

## `onlyEmptyTranslations`

```json
{
  "onlyEmptyTranslations": true
}
```

When `true`, only empty target strings are sent.

Use this for translating newly added strings.

```json
{
  "onlyEmptyTranslations": false
}
```

When `false`, all selected translations are sent for repair and consistency checking.

## `maxTranslationsPerRequest`

```json
{
  "maxTranslationsPerRequest": 100
}
```

Maximum translations included in one AI request.

This is a batch size, not a total run limit.

Set to `null` to process one locale file per request without a per-request translation cap:

```json
{
  "maxTranslationsPerRequest": null
}
```

Recommended value:

```json
{
  "maxTranslationsPerRequest": 100
}
```

## `maxRequestsPerRun`

```json
{
  "maxRequestsPerRun": 10
}
```

Maximum AI requests in one command run.

Set to `null` for no request cap:

```json
{
  "maxRequestsPerRun": null
}
```

Use this as a safety guard for large projects.

## `maxTranslationsPerRun`

```json
{
  "maxTranslationsPerRun": 1000
}
```

Maximum total translations sent in one command run.

Set to `null` for no translation cap:

```json
{
  "maxTranslationsPerRun": null
}
```

Example safe test run:

```json
{
  "maxTranslationsPerRequest": 100,
  "maxRequestsPerRun": 1,
  "maxTranslationsPerRun": 100
}
```

## `combinedTranslationsLimit`

Deprecated old name.

Use this instead:

```json
{
  "maxTranslationsPerRequest": 100
}
```

Old configs may still work if the package maps `combinedTranslationsLimit` to `maxTranslationsPerRequest`, but new configs should not use it.

## `maxTranslationAttempts`

```json
{
  "maxTranslationAttempts": 1
}
```

Maximum attempts per batch.

If a model misses required empty translations, increasing this can retry a batch with stronger retry instructions.

Recommended default:

```json
{
  "maxTranslationAttempts": 1
}
```

## `rawPatchMode`

```json
{
  "rawPatchMode": true
}
```

When `true`, the CLI patches only changed `msgstr` blocks in the original PO text.

Recommended: `true`.

When `false`, the CLI may reserialize the whole PO file. This can cause formatting noise.

## `dryRun`

```json
{
  "dryRun": false
}
```

When `true`, the CLI does not write PO files.

CLI override:

```sh
npx lingui-translate-ai translate --dry-run
```

Dry run is useful for checking proposed changes before modifying files.

## `backupBeforeWrite`

```json
{
  "backupBeforeWrite": true
}
```

When enabled, the CLI creates a backup before modifying a file.

Example:

```txt
messages.po.bak
```

The backup is created beside the original file.

Restore in PowerShell:

```powershell
Copy-Item src/locales/pl/messages.po.bak src/locales/pl/messages.po -Force
```

## `openrouter.sessionId`

```json
{
  "openrouter": {
    "sessionId": "lingui-translate-ai-translation"
  }
}
```

Stable session ID used for provider stickiness and cache consistency.

## `openrouter.cache.enabled`

```json
{
  "openrouter": {
    "cache": {
      "enabled": true
    }
  }
}
```

Marks stable request blocks as cacheable.

The CLI marks these blocks as cacheable:

- system prompt
- English source map

The target-language payload is dynamic and is not cached.

## `openrouter.cache.ttl`

```json
{
  "openrouter": {
    "cache": {
      "ttl": "1h"
    }
  }
}
```

Supported values:

```txt
5m
1h
```

Use `1h` for longer cache reuse.

## `openrouter.provider`

```json
{
  "openrouter": {
    "provider": {
      "sort": "price",
      "require_parameters": true
    }
  }
}
```

Provider routing options passed to OpenRouter.

Examples:

```json
{
  "sort": "price",
  "require_parameters": true
}
```

Pin a provider:

```json
{
  "only": ["OpenAI"],
  "sort": "price",
  "require_parameters": true
}
```

Avoid a provider:

```json
{
  "ignore": ["Azure"],
  "sort": "price",
  "require_parameters": true
}
```

Pinning one provider can improve prompt-cache consistency.

## `locales`

### Scan all locales

```json
{
  "locales": []
}
```

Scans every locale folder under `localesDir`, excluding `sourceLocale`.

### String format

```json
{
  "locales": ["pl", "ar", "de"]
}
```

This uses the same value for:

```txt
labelRaw
locale
fullLocale
```

### Object format

```json
{
  "locales": [
    {
      "labelRaw": "Polish",
      "locale": "pl",
      "fullLocale": "pl-PL"
    },
    {
      "labelRaw": "Arabic",
      "locale": "ar",
      "fullLocale": "ar-SA"
    }
  ]
}
```

Fields:

```txt
labelRaw    Human-readable language name for the AI model
locale      Folder name under localesDir
fullLocale  BCP-47 locale hint
```

## CLI overrides

### `--only-empty`

```sh
npx lingui-translate-ai translate --only-empty
```

Only send empty translations.

### `--locale`

```sh
npx lingui-translate-ai translate --locale pl
```

Run only one locale.

### `--max-translations-per-request`

```sh
npx lingui-translate-ai translate --max-translations-per-request 100
```

Maximum translations in one request.

### `--max-requests`

```sh
npx lingui-translate-ai translate --max-requests 3
```

Maximum AI requests in one run.

### `--max-translations`

```sh
npx lingui-translate-ai translate --max-translations 300
```

Maximum total translations sent in one run.

### `--dry-run`

```sh
npx lingui-translate-ai translate --dry-run
```

Do not write files.

### `--yes`

```sh
npx lingui-translate-ai translate --yes
```

Skip confirmation.

## Environment variables

### `LINGUI_TRANSLATE_AI_DEBUG`

```sh
LINGUI_TRANSLATE_AI_DEBUG=1 npx lingui-translate-ai translate --max-requests 1
```

Prints raw model output for debugging.

PowerShell:

```powershell
$env:LINGUI_TRANSLATE_AI_DEBUG="1"
npx lingui-translate-ai translate --max-requests 1
```
