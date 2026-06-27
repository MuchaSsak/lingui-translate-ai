import fs from "node:fs";
import path from "node:path";
import * as gettextParser from "gettext-parser";
import {
  createDefaultConfig,
  LinguiTranslateAiConfig,
  loadConfig,
  writeDefaultConfig,
} from "../config";
import { logger } from "../utils/logger";
import { detectLinguiProject } from "../utils/detectLinguiProject";
import { confirmPrompt } from "../utils/confirm";
import { getTranslationSystemPrompt } from "../ai/systemPrompt";

function getResolvedSystemPrompt(config: LinguiTranslateAiConfig) {
  return config.systemPrompt?.trim() || getTranslationSystemPrompt();
}

type TranslateCommandOptions = {
  onlyEmpty?: boolean;
  locale?: string;
  maxTranslationsPerRequest?: string;
  maxRequests?: string;
  maxTranslations?: string;
  dryRun?: boolean;
  yes?: boolean;
};
type PoFile = any;
type LocaleConfig = { labelRaw: string; locale: string; fullLocale: string };
type SourceEntry = { context: string; msgid: string };
type LocaleState = {
  langConfig: LocaleConfig;
  poPath: string;
  exists: boolean;
  rawPoText: string;
  po: PoFile | null;
  cursor: number;
  isDone: boolean;
  didSaveAnyChanges: boolean;
  totalAppliedFixes: number;
  totalIgnoredFixes: number;
};
type BatchEntry = {
  locale: string;
  sourceId: string;
  context: string;
  msgid: string;
  sourceText: string;
  currentTranslation: string;
  state: LocaleState;
  wasEmpty: boolean;
};
type WorkBatch = {
  srcs: Record<string, { src: string; ctx?: string }>;
  files: Record<
    string,
    { lng: string; loc: string; trgs: Record<string, string> }
  >;
  idToEntry: Map<string, BatchEntry>;
  count: number;
};
type Correction = {
  context: string;
  msgid: string;
  corrected: string;
  currentTranslation: string;
  sourceText: string;
};
type RunEstimate = {
  localeFilesWithWork: number;
  totalTranslationsToSend: number;
  estimatedRequests: number;
};
function makeEntryKey(context: string, msgid: string) {
  return `${context}\u0004${msgid}`;
}
function getEntrySourceId(entryIndex: number) {
  return `s${entryIndex}`;
}
function getAbsoluteLocalesDir({
  projectRoot,
  config,
}: {
  projectRoot: string;
  config: LinguiTranslateAiConfig;
}) {
  return path.resolve(projectRoot, config.localesDir);
}
function getSourcePoPath({
  projectRoot,
  config,
}: {
  projectRoot: string;
  config: LinguiTranslateAiConfig;
}) {
  return path.join(
    getAbsoluteLocalesDir({ projectRoot, config }),
    config.sourceLocale,
    config.poFileName,
  );
}
function getLocalePoPath({
  projectRoot,
  config,
  locale,
}: {
  projectRoot: string;
  config: LinguiTranslateAiConfig;
  locale: string;
}) {
  return path.join(
    getAbsoluteLocalesDir({ projectRoot, config }),
    locale,
    config.poFileName,
  );
}
function parsePoText(poText: string): PoFile {
  return gettextParser.po.parse(poText);
}
function compilePoText(po: PoFile): string {
  const compiled = gettextParser.po.compile(po);
  return Buffer.isBuffer(compiled)
    ? compiled.toString("utf8")
    : String(compiled);
}
function matchWhitespace(sourceStr: string, targetStr: string) {
  if (typeof targetStr !== "string") {
    return sourceStr;
  }
  const leading = (sourceStr.match(/^(\s+)/) || [""])[0];
  const trailing = (sourceStr.match(/(\s+)$/) || [""])[0];
  return `${leading}${targetStr.trim()}${trailing}`;
}
const INTEGRITY_TOKEN_REGEX =
  /(\{[^}]+\}|<\/?\d+>|<\d+\s*\/>|<\s?[0-9A-Za-z\s]+>|< ?[0-9]+s)/g;
function getIntegrityTokens(source: string) {
  return source.match(INTEGRITY_TOKEN_REGEX) || [];
}
function hasAllIntegrityTokens(source: string, target: string) {
  if (typeof target !== "string") {
    return false;
  }
  const sourceTokens = getIntegrityTokens(source);
  return sourceTokens.every((token) => target.includes(token));
}
function addTokenAtSourcePosition({
  source,
  target,
  token,
}: {
  source: string;
  target: string;
  token: string;
}) {
  const sourceTrimmed = source.trim();
  const targetTrimmed = target.trim();
  if (!targetTrimmed) {
    return target;
  }
  if (sourceTrimmed.startsWith(token)) {
    return `${token} ${targetTrimmed}`;
  }
  if (sourceTrimmed.endsWith(token)) {
    return `${targetTrimmed} ${token}`;
  }
  const tokenIndex = source.indexOf(token);
  if (tokenIndex === -1) {
    return target;
  }
  const before = source.slice(0, tokenIndex).trim();
  const after = source.slice(tokenIndex + token.length).trim();
  if (!before && after) {
    return `${token} ${targetTrimmed}`;
  }
  if (before && !after) {
    return `${targetTrimmed} ${token}`;
  }
  return `${targetTrimmed} ${token}`;
}
function repairIntegrityTokens(source: string, target: string) {
  if (typeof target !== "string" || !target.trim()) {
    return { value: target, didRepair: false, isValid: false };
  }
  let repaired = target;
  const sourceTokens = getIntegrityTokens(source);
  const missingTokens = sourceTokens.filter(
    (token) => !repaired.includes(token),
  );
  if (missingTokens.length === 0) {
    return { value: repaired, didRepair: false, isValid: true };
  }
  for (const token of missingTokens) {
    repaired = addTokenAtSourcePosition({ source, target: repaired, token });
  }
  return {
    value: repaired,
    didRepair: true,
    isValid: hasAllIntegrityTokens(source, repaired),
  };
}
function cleanModelJson(content: string) {
  if (typeof content !== "string") {
    throw new Error("Model response content was not a string.");
  }
  return content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}
function parseModelJsonObject(content: string) {
  const cleaned = cleanModelJson(content);
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Model response was not a JSON object.");
  }
  return parsed as Record<string, unknown>;
}
function getSourceEntries(sourcePo: PoFile): SourceEntry[] {
  const entries: SourceEntry[] = [];
  for (const context of Object.keys(sourcePo.translations)) {
    for (const msgid of Object.keys(sourcePo.translations[context])) {
      if (msgid === "") continue;
      entries.push({ context, msgid });
    }
  }
  return entries;
}
function getEntryContext(entry: any, context: string) {
  const comments =
    entry?.comments?.extracted || entry?.comments?.translator || "";
  return [context !== "" ? context : null, comments]
    .filter(Boolean)
    .join(" | ");
}
function ensureTargetEntry({
  po,
  sourcePo,
  context,
  msgid,
}: {
  po: PoFile;
  sourcePo: PoFile;
  context: string;
  msgid: string;
}) {
  if (!po.translations[context]) {
    po.translations[context] = {};
  }
  if (!po.translations[context][msgid]) {
    po.translations[context][msgid] = JSON.parse(
      JSON.stringify(sourcePo.translations[context][msgid]),
    );
  }
  if (!Array.isArray(po.translations[context][msgid].msgstr)) {
    po.translations[context][msgid].msgstr = [""];
  }
  if (typeof po.translations[context][msgid].msgstr[0] !== "string") {
    po.translations[context][msgid].msgstr[0] = "";
  }
  return po.translations[context][msgid];
}
function shouldSendTranslation({
  po,
  sourcePo,
  context,
  msgid,
  config,
}: {
  po: PoFile;
  sourcePo: PoFile;
  context: string;
  msgid: string;
  config: LinguiTranslateAiConfig;
}) {
  const targetEntry = ensureTargetEntry({ po, sourcePo, context, msgid });
  const trg = targetEntry.msgstr[0] || "";
  if (config.onlyEmptyTranslations) {
    return !trg.trim();
  }
  return true;
}
function countEmptyTranslations({
  po,
  entries,
}: {
  po: PoFile;
  entries: SourceEntry[];
}) {
  let count = 0;
  for (const { context, msgid } of entries) {
    const translation = po.translations?.[context]?.[msgid]?.msgstr?.[0];
    if (typeof translation !== "string" || !translation.trim()) {
      count += 1;
    }
  }
  return count;
}
function countTranslationsToSend({
  po,
  sourcePo,
  entries,
  config,
}: {
  po: PoFile;
  sourcePo: PoFile;
  entries: SourceEntry[];
  config: LinguiTranslateAiConfig;
}) {
  let count = 0;
  for (const { context, msgid } of entries) {
    if (shouldSendTranslation({ po, sourcePo, context, msgid, config })) {
      count += 1;
    }
  }
  return count;
}
function getEmptyTranslationEntries({
  po,
  entries,
}: {
  po: PoFile;
  entries: SourceEntry[];
}) {
  return entries.filter(({ context, msgid }) => {
    const translation = po.translations?.[context]?.[msgid]?.msgstr?.[0];
    return typeof translation !== "string" || !translation.trim();
  });
}
function scanLocalesFromFolder({
  projectRoot,
  config,
}: {
  projectRoot: string;
  config: LinguiTranslateAiConfig;
}): LocaleConfig[] {
  const absoluteLocalesDir = getAbsoluteLocalesDir({ projectRoot, config });
  if (!fs.existsSync(absoluteLocalesDir)) {
    return [];
  }
  return fs
    .readdirSync(absoluteLocalesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((locale) => locale !== config.sourceLocale)
    .filter((locale) =>
      fs.existsSync(getLocalePoPath({ projectRoot, config, locale })),
    )
    .map((locale) => ({ labelRaw: locale, locale, fullLocale: locale }));
}

type NormalizedLocaleConfig = {
  labelRaw: string;
  locale: string;
  fullLocale: string;
};

function normalizeLocaleConfig(localeConfig: unknown): NormalizedLocaleConfig {
  if (typeof localeConfig === "string") {
    return {
      labelRaw: localeConfig,
      locale: localeConfig,
      fullLocale: localeConfig,
    };
  }

  const config = localeConfig as NormalizedLocaleConfig;

  return {
    labelRaw: config.labelRaw,
    locale: config.locale,
    fullLocale: config.fullLocale,
  };
}

function resolveLocaleConfigs({
  projectRoot,
  config,
  requestedLocale,
}: {
  projectRoot: string;
  config: LinguiTranslateAiConfig;
  requestedLocale?: string;
}): LocaleConfig[] {
  const localeConfigs =
    config.locales.length > 0
      ? config.locales.map(normalizeLocaleConfig)
      : scanLocalesFromFolder({ projectRoot, config });
  return localeConfigs
    .filter((localeConfig) => localeConfig.locale !== config.sourceLocale)
    .filter((localeConfig) => {
      if (!requestedLocale) return true;
      return localeConfig.locale === requestedLocale;
    });
}
function createLocaleState({
  langConfig,
  projectRoot,
  config,
  sourcePo,
  entries,
}: {
  langConfig: LocaleConfig;
  projectRoot: string;
  config: LinguiTranslateAiConfig;
  sourcePo: PoFile;
  entries: SourceEntry[];
}): LocaleState {
  const poPath = getLocalePoPath({
    projectRoot,
    config,
    locale: langConfig.locale,
  });
  if (!fs.existsSync(poPath)) {
    return {
      langConfig,
      poPath,
      exists: false,
      rawPoText: "",
      po: null,
      cursor: 0,
      isDone: true,
      didSaveAnyChanges: false,
      totalAppliedFixes: 0,
      totalIgnoredFixes: 0,
    };
  }
  const rawPoText = fs.readFileSync(poPath, "utf8");
  const po = parsePoText(rawPoText);
  for (const { context, msgid } of entries) {
    ensureTargetEntry({ po, sourcePo, context, msgid });
  }
  return {
    langConfig,
    poPath,
    exists: true,
    rawPoText,
    po,
    cursor: 0,
    isDone: false,
    didSaveAnyChanges: false,
    totalAppliedFixes: 0,
    totalIgnoredFixes: 0,
  };
}
function addWorkItemToBatch({
  batch,
  sourcePo,
  entries,
  state,
  entryIndex,
}: {
  batch: WorkBatch;
  sourcePo: PoFile;
  entries: SourceEntry[];
  state: LocaleState;
  entryIndex: number;
}) {
  if (!state.po) return;
  const { context, msgid } = entries[entryIndex];
  const sourceId = getEntrySourceId(entryIndex);
  const sourceEntry = sourcePo.translations[context][msgid];
  const targetEntry = ensureTargetEntry({
    po: state.po,
    sourcePo,
    context,
    msgid,
  });
  const src = msgid;
  const trg = targetEntry.msgstr[0] || "";
  const ctx = getEntryContext(sourceEntry, context);
  if (!batch.srcs[sourceId]) {
    batch.srcs[sourceId] = { src };
    if (ctx) {
      batch.srcs[sourceId].ctx = ctx;
    }
  }
  if (!batch.files[state.langConfig.locale]) {
    batch.files[state.langConfig.locale] = {
      lng: state.langConfig.labelRaw,
      loc: state.langConfig.fullLocale,
      trgs: {},
    };
  }
  batch.files[state.langConfig.locale].trgs[sourceId] = trg;
  batch.idToEntry.set(`${state.langConfig.locale}:${sourceId}`, {
    locale: state.langConfig.locale,
    sourceId,
    context,
    msgid,
    sourceText: src,
    currentTranslation: trg,
    state,
    wasEmpty: !trg.trim(),
  });
  batch.count += 1;
}
function createNextWorkBatch({
  sourcePo,
  entries,
  localeStates,
  config,
}: {
  sourcePo: PoFile;
  entries: SourceEntry[];
  localeStates: LocaleState[];
  config: LinguiTranslateAiConfig;
}): WorkBatch {
  const limit =
    typeof config.maxTranslationsPerRequest === "number"
      ? config.maxTranslationsPerRequest
      : null;
  const batch: WorkBatch = {
    srcs: {},
    files: {},
    idToEntry: new Map(),
    count: 0,
  };
  for (const state of localeStates) {
    if (!state.exists || state.isDone || !state.po) continue;
    if (limit !== null && batch.count >= limit) {
      break;
    }
    while (state.cursor < entries.length) {
      if (limit !== null && batch.count >= limit) {
        return batch;
      }
      const entryIndex = state.cursor;
      const { context, msgid } = entries[entryIndex];
      state.cursor += 1;
      if (
        !shouldSendTranslation({
          po: state.po,
          sourcePo,
          context,
          msgid,
          config,
        })
      ) {
        continue;
      }
      addWorkItemToBatch({ batch, sourcePo, entries, state, entryIndex });
      if (limit !== null && batch.count >= limit) {
        return batch;
      }
    }
    state.isDone = true;
    if (limit === null && batch.count > 0) {
      return batch;
    }
  }
  return batch;
}
function getBatchEmptyCount(files: WorkBatch["files"]) {
  let count = 0;
  for (const file of Object.values(files)) {
    for (const trg of Object.values(file.trgs)) {
      if (!String(trg || "").trim()) {
        count += 1;
      }
    }
  }
  return count;
}
function getBatchTargetCount(files: WorkBatch["files"]) {
  let count = 0;
  for (const file of Object.values(files)) {
    count += Object.keys(file.trgs).length;
  }
  return count;
}
function normalizeFixedDict(fixedDict: Record<string, unknown>) {
  const normalized: Record<string, Record<string, string>> = {};
  for (const [locale, corrections] of Object.entries(fixedDict)) {
    if (
      !corrections ||
      typeof corrections !== "object" ||
      Array.isArray(corrections)
    ) {
      continue;
    }
    normalized[locale] = {};
    for (const [sourceId, correction] of Object.entries(corrections)) {
      if (typeof correction === "string") {
        normalized[locale][sourceId] = correction;
      }
    }
  }
  return normalized;
}
async function requestTranslationBatch({
  srcs,
  files,
  attempt,
  emptyCount,
  config,
}: {
  srcs: WorkBatch["srcs"];
  files: WorkBatch["files"];
  attempt: number;
  emptyCount: number;
  config: LinguiTranslateAiConfig;
}) {
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) {
    throw new Error(
      `Missing API key environment variable: ${config.apiKeyEnv}`,
    );
  }
  const retryInstruction =
    attempt > 1
      ? `\n\nThis is translation attempt ${attempt}. The target maps still contain ${emptyCount} empty translations. You MUST return corrections for every target translation that is empty.`
      : "";
  const systemPrompt = getResolvedSystemPrompt(config) + retryInstruction;
  const sourcePayload = JSON.stringify({ srcs });
  const targetPayload = JSON.stringify({ files });
  const maybeCacheControl = config.openrouter.cache.enabled
    ? { cache_control: { type: "ephemeral", ttl: config.openrouter.cache.ttl } }
    : {};
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      provider: config.openrouter.provider,
      session_id: config.openrouter.sessionId,
      messages: [
        {
          role: "system",
          content: [{ type: "text", text: systemPrompt, ...maybeCacheControl }],
        },
        {
          role: "user",
          content: [
            { type: "text", text: sourcePayload, ...maybeCacheControl },
            { type: "text", text: targetPayload },
          ],
        },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `OpenRouter HTTP ${res.status}: ${JSON.stringify(data).slice(0, 1000)}`,
    );
  }
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(
      `OpenRouter returned no message content: ${JSON.stringify(data)}`,
    );
  }
  return parseModelJsonObject(content);
}
function applyTranslationFixes({
  fixedDict,
  idToEntry,
}: {
  fixedDict: Record<string, unknown>;
  idToEntry: Map<string, BatchEntry>;
}) {
  let changesMade = false;
  let appliedFixes = 0;
  let ignoredFixes = 0;
  const correctionsByLocale = new Map<string, Correction[]>();
  const normalizedFixedDict = normalizeFixedDict(fixedDict);
  for (const [locale, localeCorrections] of Object.entries(
    normalizedFixedDict,
  )) {
    for (const [sourceId, rawCorrection] of Object.entries(localeCorrections)) {
      const originalEntry = idToEntry.get(`${locale}:${sourceId}`);
      if (!originalEntry) {
        ignoredFixes += 1;
        logger.warn(
          ` ⚠️ Ignoring unknown correction ID: ${locale}.${sourceId}`,
        );
        continue;
      }
      const { context, msgid, sourceText, currentTranslation, state } =
        originalEntry;
      if (typeof rawCorrection !== "string" || !rawCorrection.trim()) {
        ignoredFixes += 1;
        state.totalIgnoredFixes += 1;
        logger.warn(` ⚠️ Ignoring empty/non-string correction for "${msgid}"`);
        continue;
      }
      const integrityResult = repairIntegrityTokens(sourceText, rawCorrection);
      if (!integrityResult.isValid) {
        ignoredFixes += 1;
        state.totalIgnoredFixes += 1;
        logger.error(
          ` ❌ Ignoring correction with unrecoverable placeholder integrity for "${msgid}"`,
        );
        logger.muted(` Current: "${currentTranslation}"`);
        logger.muted(` Proposed: "${rawCorrection}"`);
        continue;
      }
      if (integrityResult.didRepair) {
        logger.warn(` 🩹 Repaired missing placeholder(s) for "${msgid}"`);
        logger.muted(` Proposed: "${rawCorrection}"`);
        logger.muted(` Repaired: "${integrityResult.value}"`);
      }
      const corrected = matchWhitespace(sourceText, integrityResult.value);
      if (corrected === currentTranslation) {
        logger.muted(` └─ [${locale}] "${msgid}" already OK`);
        continue;
      }
      if (!state.po) {
        ignoredFixes += 1;
        state.totalIgnoredFixes += 1;
        logger.warn(` ⚠️ Missing PO state for "${msgid}"`);
        continue;
      }
      state.po.translations[context][msgid].msgstr = [corrected];
      originalEntry.currentTranslation = corrected;
      changesMade = true;
      appliedFixes += 1;
      state.totalAppliedFixes += 1;
      if (!correctionsByLocale.has(locale)) {
        correctionsByLocale.set(locale, []);
      }
      correctionsByLocale
        .get(locale)
        ?.push({ context, msgid, corrected, currentTranslation, sourceText });
      logger.info(` └─ [${locale}] "${msgid}"`);
      logger.muted(` Before: "${currentTranslation}"`);
      logger.success(` After: "${corrected}"`);
      const ratio = corrected.length / (sourceText.length || 1);
      if (ratio < 0.25 || ratio > 1.75) {
        logger.warn(` ⚠️ Extreme length deviation. Ratio: ${ratio.toFixed(2)}`);
      }
    }
  }
  return { changesMade, appliedFixes, ignoredFixes, correctionsByLocale };
}
function syncBatchWithCurrentTranslations({
  batch,
  onlyEmptyTranslations,
}: {
  batch: WorkBatch;
  onlyEmptyTranslations: boolean;
}) {
  for (const [entryKey, entry] of Array.from(batch.idToEntry.entries())) {
    const currentTranslation =
      entry.state.po?.translations?.[entry.context]?.[entry.msgid]?.msgstr?.[0] ??
      "";
    entry.currentTranslation = currentTranslation;
    const localeFile = batch.files[entry.locale];
    if (!localeFile) {
      batch.idToEntry.delete(entryKey);
      continue;
    }
    if (onlyEmptyTranslations && currentTranslation.trim()) {
      delete localeFile.trgs[entry.sourceId];
      batch.idToEntry.delete(entryKey);
      continue;
    }
    localeFile.trgs[entry.sourceId] = currentTranslation;
  }
  for (const [locale, localeFile] of Object.entries(batch.files)) {
    if (Object.keys(localeFile.trgs).length === 0) {
      delete batch.files[locale];
    }
  }
  const usedSourceIds = new Set<string>();
  for (const localeFile of Object.values(batch.files)) {
    for (const sourceId of Object.keys(localeFile.trgs)) {
      usedSourceIds.add(sourceId);
    }
  }
  for (const sourceId of Object.keys(batch.srcs)) {
    if (!usedSourceIds.has(sourceId)) {
      delete batch.srcs[sourceId];
    }
  }
  batch.count = getBatchTargetCount(batch.files);
}
function poUnquote(line: string) {
  const match = line.match(/"((?:\\.|[^"])*)"/);
  if (!match) return "";
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return match[1];
  }
}
function extractPoValue(block: string, keyword: string) {
  const lines = block.split(/\r?\n/);
  const parts: string[] = [];
  let isCollecting = false;
  for (const line of lines) {
    if (!isCollecting) {
      if (line.startsWith(`${keyword} `)) {
        isCollecting = true;
        parts.push(poUnquote(line));
      }
      continue;
    }
    if (line.startsWith('"')) {
      parts.push(poUnquote(line));
      continue;
    }
    break;
  }
  if (!isCollecting) return undefined;
  return parts.join("");
}
function poQuote(value: string) {
  return JSON.stringify(value);
}
function patchMsgstrInBlock(block: string, corrected: string) {
  const lines = block.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^(msgstr(?:\[0\])?)\s+/);
    if (!match) continue;
    const prefix = match[1];
    let end = i + 1;
    while (end < lines.length && lines[end].startsWith('"')) {
      end += 1;
    }
    lines.splice(i, end - i, `${prefix} ${poQuote(corrected)}`);
    return lines.join("\n");
  }
  lines.push(`msgstr ${poQuote(corrected)}`);
  return lines.join("\n");
}
function formatNewPoBlockFromSource({
  sourceEntry,
  context,
  msgid,
  corrected,
}: {
  sourceEntry: any;
  context: string;
  msgid: string;
  corrected: string;
}) {
  const lines: string[] = [];
  const reference = sourceEntry?.comments?.reference;
  const extracted = sourceEntry?.comments?.extracted;
  const translator = sourceEntry?.comments?.translator;
  const flag = sourceEntry?.comments?.flag;
  if (translator) {
    for (const line of String(translator).split(/\r?\n/)) {
      lines.push(`# ${line}`);
    }
  }
  if (extracted) {
    for (const line of String(extracted).split(/\r?\n/)) {
      lines.push(`#. ${line}`);
    }
  }
  if (reference) {
    lines.push(`#: ${reference}`);
  }
  if (flag) {
    lines.push(`#, ${flag}`);
  }
  if (context) {
    lines.push(`msgctxt ${poQuote(context)}`);
  }
  lines.push(`msgid ${poQuote(msgid)}`);
  lines.push(`msgstr ${poQuote(corrected)}`);
  return lines.join("\n");
}
function patchPoText({
  poText,
  sourcePo,
  corrections,
}: {
  poText: string;
  sourcePo: PoFile;
  corrections: Correction[];
}) {
  if (corrections.length === 0) {
    return { poText, patchedCount: 0, appendedCount: 0, unpatchedCount: 0 };
  }
  const correctionMap = new Map<string, Correction>();
  for (const correction of corrections) {
    correctionMap.set(
      makeEntryKey(correction.context, correction.msgid),
      correction,
    );
  }
  const chunks = poText.split(/(\r?\n\r?\n)/);
  let patchedCount = 0;
  for (let i = 0; i < chunks.length; i += 2) {
    const block = chunks[i];
    if (!block || !block.includes("msgid")) continue;
    const context = extractPoValue(block, "msgctxt") ?? "";
    const msgid = extractPoValue(block, "msgid");
    if (typeof msgid !== "string") continue;
    const key = makeEntryKey(context, msgid);
    const correction = correctionMap.get(key);
    if (!correction) continue;
    chunks[i] = patchMsgstrInBlock(block, correction.corrected);
    correctionMap.delete(key);
    patchedCount += 1;
  }
  let patchedPoText = chunks.join("");
  let appendedCount = 0;
  for (const correction of correctionMap.values()) {
    const sourceEntry =
      sourcePo.translations?.[correction.context]?.[correction.msgid];
    if (!sourceEntry) {
      logger.error(
        ` ❌ Could not append missing entry for "${correction.msgid}"`,
      );
      continue;
    }
    const newBlock = formatNewPoBlockFromSource({
      sourceEntry,
      context: correction.context,
      msgid: correction.msgid,
      corrected: correction.corrected,
    });
    const separator = patchedPoText.endsWith("\n\n")
      ? ""
      : patchedPoText.endsWith("\n")
        ? "\n"
        : "\n\n";
    patchedPoText += `${separator}${newBlock}\n`;
    appendedCount += 1;
  }
  return {
    poText: patchedPoText,
    patchedCount,
    appendedCount,
    unpatchedCount: correctionMap.size - appendedCount,
  };
}
function savePatchedLocales({
  sourcePo,
  localeStates,
  correctionsByLocale,
  config,
}: {
  sourcePo: PoFile;
  localeStates: LocaleState[];
  correctionsByLocale: Map<string, Correction[]>;
  config: LinguiTranslateAiConfig;
}) {
  for (const [locale, corrections] of correctionsByLocale.entries()) {
    const state = localeStates.find(
      (localeState) => localeState.langConfig.locale === locale,
    );
    if (!state || !state.po) continue;
    if (config.backupBeforeWrite && !config.dryRun) {
      const backupPath = `${state.poPath}.bak`;
      if (!fs.existsSync(backupPath)) {
        fs.writeFileSync(backupPath, state.rawPoText);
        logger.muted(` Backup created: ${backupPath}`);
      }
    }
    if (config.rawPatchMode) {
      const patchResult = patchPoText({
        poText: state.rawPoText,
        sourcePo,
        corrections,
      });
      state.rawPoText = patchResult.poText;
      logger.info(
        ` 🧷 [${locale}] Patched existing msgstr blocks: ${patchResult.patchedCount}`,
      );
      logger.info(
        ` ➕ [${locale}] Appended missing entries: ${patchResult.appendedCount}`,
      );
      if (patchResult.unpatchedCount > 0) {
        logger.warn(
          ` ⚠️ [${locale}] Unpatched corrections: ${patchResult.unpatchedCount}`,
        );
      }
    } else {
      state.rawPoText = compilePoText(state.po);
      logger.warn(
        ` ⚠️ [${locale}] rawPatchMode is disabled. Full PO file was reserialized.`,
      );
    }
    if (config.dryRun) {
      logger.warn(` Dry run: not writing ${state.poPath}`);
      continue;
    }
    fs.writeFileSync(state.poPath, state.rawPoText);
    state.po = parsePoText(state.rawPoText);
    state.didSaveAnyChanges = true;
    logger.success(` 💾 [${locale}] Saved ${state.poPath}`);
  }
}
async function processBatch({
  batch,
  sourcePo,
  entries,
  localeStates,
  config,
}: {
  batch: WorkBatch;
  sourcePo: PoFile;
  entries: SourceEntry[];
  localeStates: LocaleState[];
  config: LinguiTranslateAiConfig;
}) {
  if (batch.count === 0) {
    return false;
  }
  const localeList = Object.keys(batch.files);
  const sourcePayloadCharCount = JSON.stringify({ srcs: batch.srcs }).length;
  const targetPayloadCharCount = JSON.stringify({ files: batch.files }).length;
  logger.heading(`Batch: ${localeList.join(", ")}`);
  logger.info(`Translations sent: ${getBatchTargetCount(batch.files)}`);
  logger.info(`Empty translations sent: ${getBatchEmptyCount(batch.files)}`);
  logger.muted(`Cached source payload size: ${sourcePayloadCharCount} chars`);
  logger.muted(`Dynamic target payload size: ${targetPayloadCharCount} chars`);
  for (
    let attempt = 1;
    attempt <= config.maxTranslationAttempts;
    attempt += 1
  ) {
    const emptyCount = getBatchEmptyCount(batch.files);
    if (config.onlyEmptyTranslations && emptyCount === 0) {
      logger.success("No empty translations left in this batch.");
      return true;
    }
    logger.info(`Attempt ${attempt}/${config.maxTranslationAttempts}`);
    try {
      const fixedDict = await requestTranslationBatch({
        srcs: batch.srcs,
        files: batch.files,
        attempt,
        emptyCount,
        config,
      });
      const normalizedFixedDict = normalizeFixedDict(fixedDict);
      const returnedFixCount = Object.values(normalizedFixedDict).reduce(
        (sum, localeCorrections) => sum + Object.keys(localeCorrections).length,
        0,
      );
      logger.info(`Model returned ${returnedFixCount} correction(s).`);
      if (returnedFixCount === 0 && emptyCount > 0) {
        logger.warn(
          "Model returned no fixes, but this batch contains empty translations.",
        );
      }
      const { changesMade, appliedFixes, ignoredFixes, correctionsByLocale } =
        applyTranslationFixes({ fixedDict, idToEntry: batch.idToEntry });
      logger.info(`Applied fixes in batch: ${appliedFixes}`);
      logger.info(`Ignored fixes in batch: ${ignoredFixes}`);
      syncBatchWithCurrentTranslations({
        batch,
        onlyEmptyTranslations: config.onlyEmptyTranslations,
      });
      if (changesMade) {
        savePatchedLocales({
          sourcePo,
          localeStates,
          correctionsByLocale,
          config,
        });
        for (const state of localeStates) {
          if (!state.exists || !state.po) continue;
          for (const { context, msgid } of entries) {
            ensureTargetEntry({ po: state.po, sourcePo, context, msgid });
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Error validating batch: ${message}`);
      if (message.includes("429")) {
        logger.warn("Rate limited. Sleeping before retrying...");
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        attempt -= 1;
      } else {
        return false;
      }
    }
  }
  return true;
}
function parsePositiveIntegerOption(value: string | undefined) {
  if (value === undefined) return undefined;

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received: ${value}`);
  }

  return parsed;
}

function applyCliOverrides({
  config,
  options,
}: {
  config: LinguiTranslateAiConfig;
  options: TranslateCommandOptions;
}): LinguiTranslateAiConfig {
  return {
    ...config,
    onlyEmptyTranslations: options.onlyEmpty ?? config.onlyEmptyTranslations,
    dryRun: options.dryRun ?? config.dryRun,

    maxTranslationsPerRequest:
      parsePositiveIntegerOption(options.maxTranslationsPerRequest) ??
      config.maxTranslationsPerRequest,

    maxRequestsPerRun:
      parsePositiveIntegerOption(options.maxRequests) ??
      config.maxRequestsPerRun,

    maxTranslationsPerRun:
      parsePositiveIntegerOption(options.maxTranslations) ??
      config.maxTranslationsPerRun,
  };
}
function estimateRun({
  localeStates,
  sourcePo,
  entries,
  config,
}: {
  localeStates: LocaleState[];
  sourcePo: PoFile;
  entries: SourceEntry[];
  config: LinguiTranslateAiConfig;
}): RunEstimate {
  let localeFilesWithWork = 0;
  let totalTranslationsToSend = 0;
  for (const state of localeStates) {
    if (!state.exists || !state.po) continue;
    const count = countTranslationsToSend({
      po: state.po,
      sourcePo,
      entries,
      config,
    });
    if (count > 0) {
      localeFilesWithWork += 1;
      totalTranslationsToSend += count;
    }
  }
  const estimatedRequests =
    config.maxTranslationsPerRequest === null
      ? localeFilesWithWork
      : Math.ceil(totalTranslationsToSend / config.maxTranslationsPerRequest);
  return { localeFilesWithWork, totalTranslationsToSend, estimatedRequests };
}
function printRunPreview({
  projectRoot,
  config,
  localeStates,
  sourcePo,
  entries,
}: {
  projectRoot: string;
  config: LinguiTranslateAiConfig;
  localeStates: LocaleState[];
  sourcePo: PoFile;
  entries: SourceEntry[];
}) {
  const estimate = estimateRun({ localeStates, sourcePo, entries, config });
  logger.heading("Translation preview");
  logger.info(`Project root: ${projectRoot}`);
  logger.info(`Model: ${config.model}`);
  logger.info(
    `System prompt: ${config.systemPrompt ? "custom from config" : "built-in default"}`,
  );
  logger.info(`Provider: ${config.provider}`);
  logger.info(`API key env: ${config.apiKeyEnv}`);
  logger.info(`Source locale: ${config.sourceLocale}`);
  logger.info(`Locales dir: ${config.localesDir}`);
  logger.info(`PO file name: ${config.poFileName}`);
  logger.info(
    `Only empty translations: ${config.onlyEmptyTranslations ? "yes" : "no"}`,
  );
  logger.info(
    `Max translations per request: ${
      config.maxTranslationsPerRequest === null
        ? "unlimited"
        : config.maxTranslationsPerRequest
    }`,
  );

  logger.info(
    `Max requests per run: ${
      config.maxRequestsPerRun === null ? "unlimited" : config.maxRequestsPerRun
    }`,
  );

  logger.info(
    `Max translations per run: ${
      config.maxTranslationsPerRun === null
        ? "unlimited"
        : config.maxTranslationsPerRun
    }`,
  );
  logger.info(`Max translation attempts: ${config.maxTranslationAttempts}`);
  logger.info(`Raw patch mode: ${config.rawPatchMode ? "yes" : "no"}`);
  logger.info(`Dry run: ${config.dryRun ? "yes" : "no"}`);
  logger.info(
    `Backup before write: ${config.backupBeforeWrite ? "yes" : "no"}`,
  );
  logger.heading("Detected locale files");
  for (const state of localeStates) {
    if (!state.exists || !state.po) {
      logger.warn(`- ${state.langConfig.locale}: missing ${state.poPath}`);
      continue;
    }
    const totalToSend = countTranslationsToSend({
      po: state.po,
      sourcePo,
      entries,
      config,
    });
    logger.info(
      `- ${state.langConfig.locale}: ${entries.length} source strings, ${countEmptyTranslations({ po: state.po, entries })} empty, ${totalToSend} will be sent`,
    );
  }
  logger.heading("Run estimate");
  logger.info(`Locale files with work: ${estimate.localeFilesWithWork}`);
  logger.info(`Translations to send: ${estimate.totalTranslationsToSend}`);
  logger.info(
    `Estimated AI requests without caps: ${estimate.estimatedRequests}`,
  );

  if (
    config.maxRequestsPerRun !== null &&
    estimate.estimatedRequests > config.maxRequestsPerRun
  ) {
    logger.warn(
      `This run will stop after ${config.maxRequestsPerRun} request(s) because maxRequestsPerRun is enabled.`,
    );
  }

  if (
    config.maxTranslationsPerRun !== null &&
    estimate.totalTranslationsToSend > config.maxTranslationsPerRun
  ) {
    logger.warn(
      `This run will stop after ${config.maxTranslationsPerRun} translation(s) because maxTranslationsPerRun is enabled.`,
    );
  }
  return estimate;
}
async function runTranslationPipeline({
  projectRoot,
  config,
  requestedLocale,
}: {
  projectRoot: string;
  config: LinguiTranslateAiConfig;
  requestedLocale?: string;
}) {
  const sourcePoPath = getSourcePoPath({ projectRoot, config });
  if (!fs.existsSync(sourcePoPath)) {
    throw new Error(`Source PO file missing: ${sourcePoPath}`);
  }
  const sourcePo = parsePoText(fs.readFileSync(sourcePoPath, "utf8"));
  const entries = getSourceEntries(sourcePo);
  const localeConfigs = resolveLocaleConfigs({
    projectRoot,
    config,
    requestedLocale,
  });
  if (localeConfigs.length === 0) {
    throw new Error(
      requestedLocale
        ? `No matching locale found for "${requestedLocale}".`
        : "No target locale files found.",
    );
  }
  const localeStates = localeConfigs.map((langConfig) =>
    createLocaleState({ langConfig, projectRoot, config, sourcePo, entries }),
  );
  const estimate = printRunPreview({
    projectRoot,
    config,
    localeStates,
    sourcePo,
    entries,
  });
  if (estimate.estimatedRequests === 0) {
    logger.success("Nothing to translate.");
    return;
  }
  return { sourcePo, entries, localeStates, estimate };
}
export async function runTranslateCommand(options: TranslateCommandOptions) {
  const cwd = process.cwd();
  let config = loadConfig(cwd) ?? createDefaultConfig();
  const initialDetection = detectLinguiProject({ cwd, config });
  if (!initialDetection.hasPackageJson || !initialDetection.projectRoot) {
    logger.error(
      "This does not look like a package.json project. Run this command from your project root.",
    );
    process.exit(1);
  }
  if (
    !initialDetection.hasLinguiDependency &&
    !initialDetection.hasLinguiConfig
  ) {
    logger.error(
      "This does not look like a Lingui project. No @lingui dependency or lingui.config.* file was detected.",
    );
    process.exit(1);
  }
  if (!loadConfig(cwd)) {
    const result = writeDefaultConfig(initialDetection.projectRoot);
    logger.warn(`No config found. Created ${result.configPath}`);
    logger.info("Review the config, then run translation again.");
    process.exit(1);
  }
  config = applyCliOverrides({ config, options });

  if (!process.env[config.apiKeyEnv]) {
    logger.error(`Missing API key environment variable: ${config.apiKeyEnv}`);
    process.exit(1);
  }
  const projectRoot = initialDetection.projectRoot;
  let preparedRun:
    | {
        sourcePo: PoFile;
        entries: SourceEntry[];
        localeStates: LocaleState[];
        estimate: RunEstimate;
      }
    | undefined;
  try {
    preparedRun = await runTranslationPipeline({
      projectRoot,
      config,
      requestedLocale: options.locale,
    });
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  if (!preparedRun) {
    process.exit(0);
  }
  if (!options.yes) {
    const confirmed = await confirmPrompt(
      "Continue with this translation run?",
    );
    if (!confirmed) {
      logger.warn("Cancelled.");
      process.exit(0);
    }
  }
  logger.heading("Starting translation");
  let requestsCompleted = 0;
  let translationsSentThisRun = 0;

  while (true) {
    const batch = createNextWorkBatch({
      sourcePo: preparedRun.sourcePo,
      entries: preparedRun.entries,
      localeStates: preparedRun.localeStates,
      config,
    });
    if (batch.count === 0) {
      break;
    }

    if (
      config.maxRequestsPerRun !== null &&
      requestsCompleted >= config.maxRequestsPerRun
    ) {
      logger.warn(
        `Stopped because maxRequestsPerRun=${config.maxRequestsPerRun} was reached.`,
      );
      break;
    }

    if (
      config.maxTranslationsPerRun !== null &&
      translationsSentThisRun >= config.maxTranslationsPerRun
    ) {
      logger.warn(
        `Stopped because maxTranslationsPerRun=${config.maxTranslationsPerRun} was reached.`,
      );
      break;
    }
    await processBatch({
      batch,
      sourcePo: preparedRun.sourcePo,
      entries: preparedRun.entries,
      localeStates: preparedRun.localeStates,
      config,
    });
    requestsCompleted += 1;
    translationsSentThisRun += batch.count;
  }
  for (const state of preparedRun.localeStates) {
    if (!state.exists || !state.po) continue;
    const emptyAfterAllAttempts = countEmptyTranslations({
      po: state.po,
      entries: preparedRun.entries,
    });
    logger.heading(`Summary: ${state.langConfig.locale}`);
    logger.info(`Applied fixes total: ${state.totalAppliedFixes}`);
    logger.info(`Ignored fixes total: ${state.totalIgnoredFixes}`);
    logger.info(
      `Empty translations after translation: ${emptyAfterAllAttempts}`,
    );
    if (emptyAfterAllAttempts > 0) {
      logger.warn(
        `${emptyAfterAllAttempts} empty translation(s) still remain after translation.`,
      );
      const remainingEmptyEntries = getEmptyTranslationEntries({
        po: state.po,
        entries: preparedRun.entries,
      });
      for (const { context, msgid } of remainingEmptyEntries.slice(0, 25)) {
        logger.muted(`- Empty: ${context ? `[${context}] ` : ""}${msgid}`);
      }
      if (remainingEmptyEntries.length > 25) {
        logger.muted(`...and ${remainingEmptyEntries.length - 25} more`);
      }
    }
    if (!state.didSaveAnyChanges) {
      logger.success(
        `No translation fixes needed for ${state.langConfig.locale}.`,
      );
    }
  }
  logger.success("Full translation pipeline complete.");
}
