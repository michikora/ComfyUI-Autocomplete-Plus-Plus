import { settingValues } from "./settings.js";
import { getActiveControllerNode } from "./main.js";

export const modelInfoCache = new Map();
export const modelThumbStatusCache = new Map();

export function getCanvasIntegrationsOverrides() {
    const overrides = {
        hasController: false,
        enableLoraEmbedding: "Default (From Settings)",
        loraPathMode: "Default (From Settings)",
        loraManagerMode: "Default (From Settings)"
    };

    const node = getActiveControllerNode("AutocompletePlusIntegrationsController");
    if (node) {
        overrides.hasController = true;

        if (node.widgets && Array.isArray(node.widgets)) {
            for (const w of node.widgets) {
                if (w.name === "enable_lora_embedding") overrides.enableLoraEmbedding = w.value || "Default (From Settings)";
                else if (w.name === "lora_path_mode") overrides.loraPathMode = w.value || "Default (From Settings)";
                else if (w.name === "lora_manager_mode") overrides.loraManagerMode = w.value || "Default (From Settings)";
            }
        }
    }

    return overrides;
}

export function getEffectiveIntegrationsSettings() {
    const overrides = getCanvasIntegrationsOverrides();
    const effective = {
        enableModels: settingValues.enableModels,
        loraPathMode: settingValues.loraPathMode || "Auto",
        loraManagerMode: settingValues.loraManagerMode
    };

    if (!overrides.hasController) {
        return effective;
    }

    if (overrides.enableLoraEmbedding === "Enabled") effective.enableModels = true;
    else if (overrides.enableLoraEmbedding === "Disabled") effective.enableModels = false;

    if (overrides.loraManagerMode === "Enabled" || overrides.loraManagerMode === "Disabled") {
        effective.loraManagerMode = overrides.loraManagerMode;
    }

    if (overrides.loraPathMode && overrides.loraPathMode !== "Default (From Settings)") {
        effective.loraPathMode = overrides.loraPathMode;
    }

    return effective;
}

const CACHE_TTL_MS = 6000;
const RETRY_COOLDOWN_MS = 30000;
export const cache = new Map();
let unavailableUntil = 0;
let isUnavailableLogged = false;

let cachedCivitaiHost = "civitai.com";
let cachedLMSyntaxFormat = null;
let lastLMSettingsFetchTime = 0;
const LM_SETTINGS_REFRESH_INTERVAL_MS = 5000;

export function getLastLMSettingsFetchTime() {
    return lastLMSettingsFetchTime;
}

export async function fetchLMSettings(timeoutMs = 1500) {
    if (!isLoraManagerAvailable()) {
        return {
            civitaiHost: cachedCivitaiHost,
            syntaxFormat: cachedLMSyntaxFormat || "legacy"
        };
    }

    try {
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

        const res = await fetch("/api/lm/settings", {
            cache: "no-store",
            signal: controller ? controller.signal : undefined
        }).catch(() => null);

        if (timeoutId) clearTimeout(timeoutId);

        if (res && res.ok) {
            const data = await res.json().catch(() => null);
            const host = data?.settings?.civitai_host || data?.civitai_host;
            if (host && typeof host === "string") {
                cachedCivitaiHost = host.trim();
            }
            const rawFormat = String(data?.settings?.lora_syntax_format || data?.lora_syntax_format || "").toLowerCase().trim();
            if (rawFormat === "full" || rawFormat === "legacy") {
                cachedLMSyntaxFormat = rawFormat;
            }
            lastLMSettingsFetchTime = Date.now();
        }
    } catch (_) {}

    return {
        civitaiHost: cachedCivitaiHost,
        syntaxFormat: cachedLMSyntaxFormat || "legacy"
    };
}

export function getCachedLMSyntaxFormat() {
    if (Date.now() - lastLMSettingsFetchTime > LM_SETTINGS_REFRESH_INTERVAL_MS && isLoraManagerAvailable()) {
        fetchLMSettings(1500).catch(() => {});
    }
    return cachedLMSyntaxFormat || "legacy";
}

export async function fetchLMSyntaxFormat(timeoutMs = 500) {
    await fetchLMSettings(timeoutMs);
    return cachedLMSyntaxFormat || "legacy";
}

function stripExtensionBasename(path) {
    if (!path) return "";
    const clean = String(path).replace(/\\/g, "/").split("/").pop();
    return clean.replace(/\.(safetensors|ckpt|pt|bin)$/i, "");
}

function stripExtensionKeepPath(path) {
    if (!path) return "";
    const clean = String(path).replace(/\\/g, "/").trim();
    return clean.replace(/\.(safetensors|ckpt|pt|bin)$/i, "");
}

function extractSubfolderPath(path) {
    if (!path) return "";
    const clean = String(path).replace(/\\/g, "/").trim().replace(/^\/+|\/+$/g, "");
    const lastSlash = clean.lastIndexOf("/");
    if (lastSlash === -1) return "";
    return clean.substring(0, lastSlash);
}

function describeQuery(partialTag) {
    const trimmed = String(partialTag || "").trim();
    const loraMatch = trimmed.match(/^<lora:(.*)$/i);
    if (loraMatch) return { kind: "loras", search: loraMatch[1] };

    const embMatch = trimmed.match(/^(?:embedding|emb):(.*)$/i);
    if (embMatch) return { kind: "embeddings", search: embMatch[1] };

    if (trimmed.startsWith("__")) {
        return { kind: "wildcards", search: trimmed.replace(/^__/, "").replace(/__$/, "") };
    }

    return null;
}

export async function searchLoraManager(partialTag, mode = "auto") {
    if (mode === "disabled" || !partialTag) return [];
    if (Date.now() < unavailableUntil) return [];

    const descriptor = describeQuery(partialTag);
    if (!descriptor) return [];

    const rawSearch = descriptor.search || "";
    // If the search contains subfolders (e.g. 'Anima/' or 'Anima/con'), extract filename part for backend LM lookup
    const lastSlash = rawSearch.lastIndexOf("/");
    const searchParam = lastSlash !== -1 ? rawSearch.substring(lastSlash + 1).trim() : rawSearch;
    const limit = lastSlash !== -1 ? 100 : 35;

    const url = `/api/lm/${descriptor.kind}/relative-paths?search=${encodeURIComponent(searchParam)}&limit=${limit}`;
    
    const cached = cache.get(url);
    if (cached && cached.expiresAt > Date.now()) return cached.results;

    try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        
        if (payload && payload.success === true && Array.isArray(payload.relative_paths)) {
            const results = payload.relative_paths.map(path => {
                if (descriptor.kind === "loras") {
                    const clean = stripExtensionBasename(path);
                    const subfolder = extractSubfolderPath(path);
                    const insertPath = subfolder ? `${subfolder}/${clean}` : clean;
                    return {
                        text: `<lora:${insertPath}:1.0>`,
                        display: `<lora:${clean}:1.0>`,
                        type: "lora",
                        category: "lora",
                        count: 0,
                        subfolder: subfolder,
                        source: "lora_manager",
                        sourceLabel: "LM",
                        cleanName: clean,
                        rawPath: path
                    };
                }
                const cleanPath = stripExtensionKeepPath(path);
                const subfolder = extractSubfolderPath(path);
                const baseName = cleanPath.split("/").pop();
                return {
                    text: `embedding:${cleanPath}`,
                    display: `embedding:${cleanPath}`,
                    type: "embeddings",
                    category: "embeddings",
                    count: 0,
                    subfolder: subfolder,
                    source: "lora_manager",
                    sourceLabel: "LM",
                    cleanName: baseName,
                    rawPath: path
                };
            });

            cache.set(url, { expiresAt: Date.now() + CACHE_TTL_MS, results });
            unavailableUntil = 0;
            isUnavailableLogged = false;
            return results;
        }
        return [];
    } catch (err) {
        unavailableUntil = Date.now() + RETRY_COOLDOWN_MS;
        if (!isUnavailableLogged && mode === "enabled") {
            console.debug("[Autocomplete++] LoRA Manager API unavailable:", err.message);
            isUnavailableLogged = true;
        }
        return [];
    }
}

export function isLoraManagerAvailable() {
    return Date.now() >= unavailableUntil;
}

export function recordLoraManagerFailure() {
    unavailableUntil = Date.now() + RETRY_COOLDOWN_MS;
}

export async function fetchLoraManagerPreviewUrl(rawPath, cleanName) {
    if (!isLoraManagerAvailable()) return "";

    const cached = getCachedLoraPreviewUrl(rawPath, cleanName);
    if (cached) return cached;

    const queryKey = rawPath || cleanName;
    if (!queryKey) return "";

    try {
        const info = await fetchLoraModelInfo(queryKey);
        if (info && info.previewUrl) {
            return info.previewUrl;
        }
    } catch (_) {}

    return "";
}


export function getCachedLoraPreviewUrl(rawPath, cleanName) {
    if (rawPath && modelInfoCache.has(rawPath)) {
        const info = modelInfoCache.get(rawPath);
        if (info && info.previewUrl) return info.previewUrl;
    }
    if (cleanName && modelInfoCache.has(cleanName)) {
        const info = modelInfoCache.get(cleanName);
        if (info && info.previewUrl) return info.previewUrl;
    }
    return "";
}

export function parseTriggerWords(input) {
    if (!input) return [];
    const list = Array.isArray(input) ? input : [input];
    const results = [];
    const seen = new Set();

    list.forEach(item => {
        if (!item) return;
        const parts = String(item).split(/[\r\n,]+/);
        parts.forEach(part => {
            const clean = part.trim();
            if (clean) {
                // Normalize internal spaces to underscores after trimming (e.g. "hair ribbon" -> "hair_ribbon")
                const normalized = clean.replace(/\s+/g, "_");
                if (!seen.has(normalized.toLowerCase())) {
                    seen.add(normalized.toLowerCase());
                    results.push(normalized);
                }
            }
        });
    });

    return results;
}

export function formatSourcesShortLabel(sources) {
    if (!sources || sources.length === 0) return "";
    if (sources.length === 1) {
        const name = sources[0].cleanName || sources[0].loraPath || "";
        return name.length > 12 ? name.substring(0, 11) + "…" : name;
    }
    if (sources.length === 2) {
        const n1 = sources[0].cleanName || "";
        const n2 = sources[1].cleanName || "";
        const s1 = n1.length > 7 ? n1.substring(0, 6) + "…" : n1;
        const s2 = n2.length > 7 ? n2.substring(0, 6) + "…" : n2;
        return `${s1}, ${s2}`;
    }
    const n1 = sources[0].cleanName || "";
    const s1 = n1.length > 7 ? n1.substring(0, 6) + "…" : n1;
    return `${s1}, +${sources.length - 1} LoRAs`;
}

export function resolveExactLoraPath(inputName, loraList = []) {
    if (!inputName) return "";
    const cleanInput = String(inputName).replace(/\\/g, "/").trim();
    const cleanInputLower = cleanInput.toLowerCase();
    const cleanWithoutExtLower = cleanInputLower.replace(/\.(safetensors|ckpt|pt|bin)$/i, "");

    // 1. Exact full relative path match against actual filesystem paths in loraList
    for (const l of loraList) {
        const lNorm = String(l).replace(/\\/g, "/");
        const lNormWithoutExtLower = lNorm.toLowerCase().replace(/\.(safetensors|ckpt|pt|bin)$/i, "");
        if (lNorm.toLowerCase() === cleanInputLower || lNormWithoutExtLower === cleanWithoutExtLower) {
            return lNorm; // Returns exact disk path preserving real extension (.safetensors, .ckpt, .pt, etc.)
        }
    }

    // 2. Basename match across all subfolders against actual filesystem paths in loraList
    const inputBaseNameLower = cleanWithoutExtLower.split("/").pop();
    for (const l of loraList) {
        const lNorm = String(l).replace(/\\/g, "/");
        const lBaseNameLower = lNorm.toLowerCase().split("/").pop().replace(/\.(safetensors|ckpt|pt|bin)$/i, "");
        if (lBaseNameLower === inputBaseNameLower) {
            return lNorm; // Returns exact disk path with real folder structure and real disk extension
        }
    }

    // 3. If model list is loaded and this model doesn't exist locally, return empty to skip querying
    if (Array.isArray(loraList) && loraList.length > 0) {
        return "";
    }

    return cleanInput;
}

export function extractTrainedBlocksAndWords(obj, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 6) return { triggerWords: [], compoundBlocks: [] };
    const triggerWords = [];
    const compoundBlocks = [];

    if (Array.isArray(obj)) {
        for (const item of obj) {
            const res = extractTrainedBlocksAndWords(item, depth + 1);
            triggerWords.push(...res.triggerWords);
            compoundBlocks.push(...res.compoundBlocks);
        }
        return {
            triggerWords: [...new Set(triggerWords)],
            compoundBlocks: compoundBlocks
        };
    }

    for (const [key, val] of Object.entries(obj)) {
        const keyLower = key.toLowerCase();
        if (keyLower === "trainedwords" || keyLower === "trigger_words" || keyLower === "triggerwords") {
            const list = Array.isArray(val) ? val : [val];
            list.forEach(rawItem => {
                if (typeof rawItem === "string" && rawItem.trim()) {
                    const rawClean = rawItem.trim().replace(/,+$/, "").trim();
                    const parsed = parseTriggerWords(rawClean);
                    if (parsed.length > 0) {
                        parsed.forEach(w => triggerWords.push(w));
                        if (parsed.length > 1 || rawItem.includes(",")) {
                            compoundBlocks.push({
                                rawText: rawClean,
                                tags: parsed
                            });
                        }
                    }
                }
            });
        } else if (typeof val === "object" && val !== null) {
            const res = extractTrainedBlocksAndWords(val, depth + 1);
            triggerWords.push(...res.triggerWords);
            compoundBlocks.push(...res.compoundBlocks);
        }
    }

    return {
        triggerWords: [...new Set(triggerWords)],
        compoundBlocks: compoundBlocks
    };
}

export function extractTrainedWordsFromPayload(obj, depth = 0) {
    return extractTrainedBlocksAndWords(obj, depth).triggerWords;
}
// Civitai domain host management
export async function refreshCivitaiHost() {
    await fetchLMSettings(1500);
    return cachedCivitaiHost;
}

export function getCivitaiHost() {
    if (Date.now() - lastLMSettingsFetchTime > LM_SETTINGS_REFRESH_INTERVAL_MS && isLoraManagerAvailable()) {
        fetchLMSettings(1500).catch(() => {});
    }
    return cachedCivitaiHost;
}

export function resolveCivitaiUrl(rawUrl, targetHost = null) {
    if (!rawUrl || typeof rawUrl !== "string") return "";
    const host = targetHost || getCivitaiHost();
    // Only rewrite civitai URLs, keep HuggingFace / other URLs intact
    if (/^https?:\/\/(www\.)?civitai\.(com|red)/i.test(rawUrl)) {
        return rawUrl.replace(/^https?:\/\/(www\.)?civitai\.(com|red)/i, `https://${host}`);
    }
    return rawUrl;
}

export const PLACEHOLDER_IMG_URL = new URL("../img/placeholder.webp", import.meta.url).href;
export const ERROR_404_IMG_URL = new URL("../img/404.webp", import.meta.url).href;

export const ICON_URLS = {
    loramanager: new URL("../icons/loramanager.svg", import.meta.url).href,
    civitai: new URL("../icons/civitai.svg", import.meta.url).href,
    civitaiRed: new URL("../icons/civitai-red.svg", import.meta.url).href,
    huggingface: new URL("../icons/huggingface.svg", import.meta.url).href
};

export function getLoraManagerIconImg() {
    return `<img src="${ICON_URLS.loramanager}" class="acIconImg" alt="LoRA Manager" />`;
}

export function getExternalLinkMeta(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return null;
    const finalUrl = resolveCivitaiUrl(rawUrl);
    const host = getCivitaiHost().toLowerCase();
    const isCivitai = /^https?:\/\/(www\.)?civitai\.(com|red)/i.test(finalUrl);
    const isHF = /^https?:\/\/(www\.)?huggingface\.co/i.test(finalUrl);

    if (isCivitai) {
        const isRed = host.includes("red") || finalUrl.includes("civitai.red");
        const iconUrl = isRed ? ICON_URLS.civitaiRed : ICON_URLS.civitai;
        return {
            type: isRed ? "civitai-red" : "civitai",
            name: isRed ? "Civitai Red" : "Civitai",
            url: finalUrl,
            iconUrl: iconUrl,
            iconImg: `<img src="${iconUrl}" class="acIconImg" alt="${isRed ? "Civitai Red" : "Civitai"}" />`,
            tooltip: `Open on ${isRed ? "Civitai Red" : "Civitai"} ↗`
        };
    }

    if (isHF) {
        return {
            type: "huggingface",
            name: "Hugging Face",
            url: finalUrl,
            iconUrl: ICON_URLS.huggingface,
            iconImg: `<img src="${ICON_URLS.huggingface}" class="acIconImg" alt="Hugging Face" />`,
            tooltip: "Open on Hugging Face ↗"
        };
    }

    return {
        type: "web",
        name: "Web Page",
        url: finalUrl,
        iconUrl: "",
        iconImg: `<span class="acExternalArrow">↗</span>`,
        tooltip: "Open Model Page (External ↗)"
    };
}

export function openCivitaiUrl(rawUrl) {
    if (!rawUrl) return;
    const finalUrl = resolveCivitaiUrl(rawUrl);
    window.open(finalUrl, "_blank");
    refreshCivitaiHost();
}

export function extractCivitaiUrlFromPayload(obj, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 6) return "";

    const host = getCivitaiHost();
    const civitai = obj.civitai || {};
    const modelId = civitai.modelId || civitai.model_id || obj.modelId || obj.model_id;
    const versionId = civitai.id || civitai.versionId || civitai.version_id || obj.modelVersionId || obj.versionId;

    if (modelId) {
        if (versionId) {
            return `https://${host}/models/${modelId}?modelVersionId=${versionId}`;
        }
        return `https://${host}/models/${modelId}`;
    }

    if (obj.hf_url || obj.huggingface_url) {
        return String(obj.hf_url || obj.huggingface_url);
    }

    if (civitai.url) {
        return resolveCivitaiUrl(String(civitai.url), host);
    }

    if (obj.url && typeof obj.url === "string" && obj.url.startsWith("http")) {
        return resolveCivitaiUrl(obj.url, host);
    }

    for (const [key, val] of Object.entries(obj)) {
        if (typeof val === "object" && val !== null) {
            const found = extractCivitaiUrlFromPayload(val, depth + 1);
            if (found) return found;
        }
    }

    return "";
}

export async function fetchLoraModelInfo(loraPath, loraList = [], forceRefresh = false) {
    if (!loraPath || !isLoraManagerAvailable()) return { triggerWords: [], compoundBlocks: [], civitaiUrl: "", previewUrl: "" };

    if (!forceRefresh) {
        const cached = modelInfoCache.get(loraPath);
        if (cached) return cached;
    }

    // Check if model exists locally in loraList (if loraList is loaded)
    const resolved = resolveExactLoraPath(loraPath, loraList);
    if (Array.isArray(loraList) && loraList.length > 0 && !resolved) {
        const emptyResult = { triggerWords: [], compoundBlocks: [], civitaiUrl: "", previewUrl: "" };
        modelInfoCache.set(loraPath, emptyResult);
        return emptyResult;
    }

    // Extract clean model basename without extension for search query
    const targetName = resolved || loraPath;
    const cleanBasename = targetName.split("/").pop().replace(/\.(safetensors|ckpt|pt|bin)$/i, "").trim();

    if (!cleanBasename) {
        const emptyResult = { triggerWords: [], compoundBlocks: [], civitaiUrl: "", previewUrl: "" };
        modelInfoCache.set(loraPath, emptyResult);
        return emptyResult;
    }

    const encodedSearch = encodeURIComponent(cleanBasename);
    const searchUrl = `/api/lm/loras/list?search=${encodedSearch}`;

    try {
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), 1500) : null;

        const res = await fetch(searchUrl, {
            cache: "no-store",
            signal: controller ? controller.signal : undefined
        }).catch(() => null);

        if (timeoutId) clearTimeout(timeoutId);

        if (res && res.ok) {
            const payload = await res.json().catch(() => null);
            if (payload) {
                let targetModel = null;
                const models = Array.isArray(payload) ? payload : (payload.items || payload.loras || payload.models || payload.data || [payload]);

                if (Array.isArray(models) && models.length > 0) {
                    const cleanLower = cleanBasename.toLowerCase();
                    // Match best candidate from returned search results
                    targetModel = models.find(m => {
                        const mFileName = String(m.file_name || "").toLowerCase();
                        const mName = String(m.name || m.file_path || m.model_name || "").toLowerCase();
                        const mBase = mName.split("/").pop().replace(/\.(safetensors|ckpt|pt|bin)$/i, "");
                        return mFileName === cleanLower || mBase === cleanLower;
                    }) || models[0];
                } else if (payload && typeof payload === "object") {
                    targetModel = payload;
                }

                if (targetModel) {
                    const { triggerWords, compoundBlocks } = extractTrainedBlocksAndWords(targetModel);
                    const civitaiUrl = extractCivitaiUrlFromPayload(targetModel);
                    const previewUrl = targetModel.preview_url || targetModel.previewUrl || "";
                    const fullPath = targetModel.file_path || targetModel.filePath || "";
                    const modelName = targetModel.model_name || targetModel.modelName || "";
                    const fileName = targetModel.file_name || targetModel.fileName || cleanBasename;
                    const baseModel = targetModel.base_model || targetModel.baseModel || "";
                    const fileSize = targetModel.file_size || targetModel.fileSize || 0;
                    const folder = targetModel.folder || "";
                    const notes = targetModel.notes || "";
                    const usageTips = targetModel.usage_tips || targetModel.usageTips || "";
                    const sha256 = (targetModel.sha256 || targetModel.hash || "").toLowerCase();

                    const result = {
                        triggerWords,
                        compoundBlocks,
                        civitaiUrl,
                        previewUrl,
                        fullPath,
                        modelName,
                        fileName,
                        baseModel,
                        fileSize,
                        folder,
                        notes,
                        usageTips,
                        sha256,
                        civitaiInfo: targetModel.civitai || null,
                        rawModel: targetModel
                    };
                    modelInfoCache.set(loraPath, result);
                    if (resolved && resolved !== loraPath) modelInfoCache.set(resolved, result);
                    return result;
                }
            }
        }
    } catch (e) {
        // Fallback silently on network errors
    }

    const emptyResult = { triggerWords: [], compoundBlocks: [], civitaiUrl: "", previewUrl: "", fullPath: "", modelName: "", fileName: "", baseModel: "", fileSize: 0, folder: "", notes: "", usageTips: "" };
    modelInfoCache.set(loraPath, emptyResult);
    if (resolved && resolved !== loraPath) modelInfoCache.set(resolved, emptyResult);
    return emptyResult;
}

export async function getLoadedLorasTriggerWords(loraPaths, loraList = [], forceRefresh = false) {
    if (!Array.isArray(loraPaths) || loraPaths.length === 0 || !isLoraManagerAvailable()) {
        return new Map();
    }

    const tagToSourcesMap = new Map();

    // Fetch model infos in parallel
    const infos = await Promise.all(loraPaths.map(p => fetchLoraModelInfo(p, loraList, forceRefresh)));

    // Insert into map in order of active LoRAs
    loraPaths.forEach((p, idx) => {
        const info = infos[idx] || { triggerWords: [], compoundBlocks: [] };
        const cleanName = stripExtensionBasename(p);
        const compoundBlocks = Array.isArray(info.compoundBlocks) ? info.compoundBlocks : [];

        info.triggerWords.forEach(tag => {
            const tagLower = tag.toLowerCase();
            if (!tagToSourcesMap.has(tagLower)) {
                tagToSourcesMap.set(tagLower, {
                    tag: tag,
                    sources: []
                });
            }
            const entry = tagToSourcesMap.get(tagLower);
            if (!entry.sources.some(s => s.loraPath === p)) {
                const matchingBlocks = compoundBlocks
                    .filter(b => b.tags.some(t => t.toLowerCase() === tagLower))
                    .map(b => b.rawText);

                entry.sources.push({
                    loraPath: p,
                    cleanName: cleanName,
                    civitaiUrl: info.civitaiUrl || "",
                    previewUrl: info.previewUrl || "",
                    compoundBlocks: matchingBlocks,
                    allCompoundBlocks: compoundBlocks.map(b => typeof b === "string" ? b : b.rawText),
                    triggerWords: info.triggerWords || [],
                    fullPath: info.fullPath || "",
                    modelName: info.modelName || "",
                    fileName: info.fileName || "",
                    baseModel: info.baseModel || "",
                    fileSize: info.fileSize || 0,
                    folder: info.folder || "",
                    notes: info.notes || "",
                    usageTips: info.usageTips || "",
                    sha256: info.sha256 || "",
                    civitaiInfo: info.civitaiInfo || null,
                    rawModel: info.rawModel || null
                });
            }
        });
    });

    return tagToSourcesMap;
}

