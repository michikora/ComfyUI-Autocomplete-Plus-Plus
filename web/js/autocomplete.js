import { app } from "/scripts/app.js";
import { settingValues, id, isComfyThemeLight, logDebug } from "./settings.js";
import { getFixedCaretCoordinates } from "./caret-position.js";
import { isLoraManagerAvailable, fetchLoraManagerPreviewUrl, getLoadedLorasTriggerWords, formatSourcesShortLabel, getCachedLoraPreviewUrl, openCivitaiUrl, resolveCivitaiUrl, getEffectiveIntegrationsSettings, getLoraManagerIconImg, getExternalLinkMeta, fetchLoraModelInfo, fetchLMSyntaxFormat, getCachedLMSyntaxFormat, getLastLMSettingsFetchTime, modelInfoCache, modelThumbStatusCache, PLACEHOLDER_IMG_URL, ERROR_404_IMG_URL } from "./lora-manager-provider.js";
import { openLoraInfoModal } from "./lora-info-modal.js";
import { formatTagUnderscores, buildUnderscoreExclusionSet, getEffectiveFormattingSettings, isKeepUnderscoresTextarea } from "./auto-formatter.js";
import { getActiveControllerNode } from "./main.js";

// Category definitions
const DANBOORU_CATEGORIES = {
    0: "general",
    1: "artist",
    3: "copyright",
    4: "character",
    5: "meta"
};

const E621_CATEGORIES = {
    0: "general",
    1: "artist",
    3: "copyright",
    4: "character",
    5: "species",
    6: "invalid",
    7: "meta",
    8: "lore"
};

const csvCache = new Map();

export function getCanvasDictionariesOverrides() {
    const overrides = {
        hasController: false,
        tagFile: "Default (From Settings)",
        extraFilesMode: "Default (From Settings)",
        extraFiles: "",
        translationFile: "Default (From Settings)"
    };

    const node = getActiveControllerNode("AutocompletePlusDictionariesController");
    if (node) {
        overrides.hasController = true;

        if (node.widgets && Array.isArray(node.widgets)) {
            for (const w of node.widgets) {
                if (w.name === "tag_file") overrides.tagFile = w.value || "Default (From Settings)";
                else if (w.name === "extra_tag_files_mode") overrides.extraFilesMode = w.value || "Default (From Settings)";
                else if (w.name === "extra_tag_files") overrides.extraFiles = typeof w.value === "string" ? w.value : "";
                else if (w.name === "translation_file") overrides.translationFile = w.value || "Default (From Settings)";
            }
        }
    }

    return overrides;
}

export function getEffectiveDictionarySettings() {
    const overrides = getCanvasDictionariesOverrides();
    const effective = {
        tagFile: settingValues.tagFile || "danbooru.csv",
        extraFiles: settingValues.extraFiles || "",
        translationFile: settingValues.translationFile || "None"
    };

    if (!overrides.hasController) {
        return effective;
    }

    if (overrides.tagFile && overrides.tagFile !== "Default (From Settings)") {
        effective.tagFile = overrides.tagFile;
    }

    if (overrides.extraFilesMode === "None (Disable Extra Files)") {
        effective.extraFiles = "";
    } else if (overrides.extraFilesMode === "Override (Use Custom List)") {
        effective.extraFiles = overrides.extraFiles ? overrides.extraFiles.trim() : "";
    } else {
        effective.extraFiles = settingValues.extraFiles || "";
    }

    if (overrides.translationFile && overrides.translationFile !== "Default (From Settings)") {
        effective.translationFile = overrides.translationFile;
    }

    return effective;
}

export function buildLoadedDictionaryIndex(mainFilename, extraFilesString) {
    const rawFiles = [];
    if (mainFilename && mainFilename !== "None") {
        rawFiles.push(mainFilename.trim());
    }
    if (extraFilesString && extraFilesString.trim()) {
        extraFilesString.split(",").map(s => s.trim()).filter(Boolean).forEach(f => {
            if (!rawFiles.includes(f)) rawFiles.push(f);
        });
    }

    const fileInfos = rawFiles.map(filename => {
        const rawBase = filename.replace(/\.[^/.]+$/, "").trim();
        const hasSpace = /\s+/.test(rawBase);
        return {
            filename,
            rawBase,
            hasSpace,
            isE621: filename.toLowerCase().includes("e621")
        };
    });

    const usedSlugs = new Set();
    const resultList = [];

    // Pass 1: Files without spaces keep their exact raw base name
    fileInfos.forEach(info => {
        if (!info.hasSpace) {
            const slug = info.rawBase;
            usedSlugs.add(slug.toLowerCase());
            resultList.push({
                filename: info.filename,
                rawBase: info.rawBase,
                slug: slug,
                prefix: "/" + slug + " ",
                label: formatSourceLabel(info.filename),
                isE621: info.isE621,
                normalizedKeys: [
                    slug.toLowerCase(),
                    slug.replace(/[\s_-]+/g, "").toLowerCase()
                ]
            });
        }
    });

    // Pass 2: Resolve slugs for filenames with spaces
    fileInfos.forEach(info => {
        if (info.hasSpace) {
            const words = info.rawBase.split(/\s+/).filter(Boolean);
            const pascalWords = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

            const candPascal = pascalWords.join("");
            const candUnderscore = words.join("_");
            const candHyphen = words.join("-");
            const candPipe = words.join("|");

            let chosenSlug = candPipe; // fallback
            for (const cand of [candPascal, candUnderscore, candHyphen]) {
                if (!usedSlugs.has(cand.toLowerCase())) {
                    chosenSlug = cand;
                    break;
                }
            }

            usedSlugs.add(chosenSlug.toLowerCase());
            resultList.push({
                filename: info.filename,
                rawBase: info.rawBase,
                slug: chosenSlug,
                prefix: "/" + chosenSlug + " ",
                label: formatSourceLabel(info.filename),
                isE621: info.isE621,
                normalizedKeys: [
                    chosenSlug.toLowerCase(),
                    info.rawBase.toLowerCase(),
                    info.rawBase.replace(/[\s_-]+/g, "").toLowerCase(),
                    candPascal.toLowerCase(),
                    candUnderscore.toLowerCase(),
                    candHyphen.toLowerCase(),
                    candPipe.toLowerCase()
                ]
            });
        }
    });

    return resultList;
}

export function getActiveCategories(dictFilter = null, allLoadedDictionaries = []) {
    let hasE621 = false;
    let hasDanbooruOrGeneric = false;

    if (dictFilter) {
        hasE621 = Boolean(dictFilter.isE621);
        hasDanbooruOrGeneric = !hasE621;
    } else {
        hasE621 = allLoadedDictionaries.some(d => d.isE621);
        hasDanbooruOrGeneric = allLoadedDictionaries.some(d => !d.isE621) || allLoadedDictionaries.length === 0;
    }

    const list = [];
    const prefixBase = dictFilter ? `/${dictFilter.slug} ` : "/";

    // 0: General
    list.push({ num: 0, name: "general", prefix: `${prefixBase}general `, catIds: [0], alias: ["gen"] });
    // 1: Artist
    list.push({ num: 1, name: "artist", prefix: `${prefixBase}artist `, catIds: [1], alias: ["art"] });
    // 3: Copyright
    list.push({ num: 3, name: "copyright", prefix: `${prefixBase}copyright `, catIds: [3], alias: ["copy"] });
    // 4: Character
    list.push({ num: 4, name: "character", prefix: `${prefixBase}character `, catIds: [4], alias: ["char"] });

    // 5: Species (Only present when e621 is active)
    if (hasE621) {
        list.push({ num: 5, name: "species", prefix: `${prefixBase}species `, catIds: [5], targetE621Only: true, alias: ["spec"] });
    }

    // Meta (Different category ID depending on dictionary)
    if (hasDanbooruOrGeneric && hasE621) {
        // Both loaded: meta maps to cat 5 for Danbooru/generic and cat 7 for e621
        list.push({ num: 7, name: "meta", prefix: `${prefixBase}meta `, catIds: [5, 7], isMeta: true, alias: [] });
    } else if (hasE621 && !hasDanbooruOrGeneric) {
        // Only e621 loaded: meta is cat 7
        list.push({ num: 7, name: "meta", prefix: `${prefixBase}meta `, catIds: [7], isMeta: true, alias: [] });
    } else {
        // Only Danbooru or Generic loaded: meta is cat 5 (species and lore excluded)
        list.push({ num: 5, name: "meta", prefix: `${prefixBase}meta `, catIds: [5], isMeta: true, alias: [] });
    }

    // 8: Lore (Only present when e621 is active)
    if (hasE621) {
        list.push({ num: 8, name: "lore", prefix: `${prefixBase}lore `, catIds: [8], targetE621Only: true, alias: [] });
    }

    return list;
}

function formatSourceLabel(filename) {
    if (!filename) return "Tag";
    const clean = filename.replace(/\.(csv|json|txt|yaml)$/i, "").trim();
    if (!clean) return "Tag";
    return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function getCleanModelName(fullPath) {
    if (!fullPath) return "";
    const clean = String(fullPath).replace(/\\/g, "/").split("/").pop();
    return clean.replace(/\.(safetensors|ckpt|pt|bin)$/i, "");
}

function extractSubfolderPath(fullPath) {
    if (!fullPath) return "";
    const clean = String(fullPath).replace(/\\/g, "/").trim().replace(/^\/+|\/+$/g, "");
    const lastSlash = clean.lastIndexOf("/");
    if (lastSlash === -1) return "";
    return clean.substring(0, lastSlash);
}

function isLoraPrefix(query) {
    if (!query.startsWith("<")) return false;
    const qLower = query.toLowerCase();
    if (qLower.startsWith("<lora:")) return false; // Already full prefix
    const prefix = "<lora:";
    return prefix.startsWith(qLower);
}

function isTriggerPrefix(query) {
    if (!query || !query.startsWith("<")) return false;
    const qLower = query.toLowerCase();
    if (qLower.startsWith("<trigger:")) return false;
    return "<trigger:".startsWith(qLower);
}

function isExplicitTriggerMode(query) {
    return (query || "").toLowerCase().startsWith("<trigger:");
}

function extractTriggerKeyword(query) {
    const q = (query || "").toLowerCase();
    if (q.startsWith("<trigger:")) {
        return query.substring(9).trim();
    }
    return "";
}

function isEmbeddingTrigger(query) {
    const qLower = query.toLowerCase();
    if (qLower.startsWith("emb:") || qLower.startsWith("embedding:")) return false;
    const prefix = "embedding:";
    if (qLower.length >= 2 && prefix.startsWith(qLower)) return true;
    return false;
}

function parseCSV(text) {
    if (!text) return [];
    const lines = text.split(/\r?\n/);
    const results = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith("#")) continue;

        const row = [];
        let insideQuote = false;
        let entry = "";

        for (let j = 0; j < line.length; j++) {
            const char = line[j];
            if (char === '"') {
                if (insideQuote && line[j + 1] === '"') {
                    entry += '"';
                    j++;
                } else {
                    insideQuote = !insideQuote;
                }
            } else if (char === ',' && !insideQuote) {
                row.push(entry.trim());
                entry = "";
            } else {
                entry += char;
            }
        }
        row.push(entry.trim());
        results.push(row);
    }
    return results;
}

function formatCount(num) {
    const n = Number(num);
    if (isNaN(n) || n <= 0) return "";
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    return String(n);
}

function escapeHTML(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function scoreAndFilterModelItem(item, subQuery) {
    const q = (subQuery || "").trim().toLowerCase();
    if (!q) {
        return { match: true, score: 0 };
    }

    const fullPath = (item.rawPath || item.rawName || item.cleanName || "").replace(/\\/g, "/");
    const fullPathLower = fullPath.toLowerCase();
    const cleanLower = (item.cleanName || "").toLowerCase();
    const subfolderLower = (item.subfolder || "").toLowerCase();

    const lastSlash = q.lastIndexOf("/");

    if (lastSlash !== -1) {
        const targetFolder = q.substring(0, lastSlash).trim();
        const fileSub = q.substring(lastSlash + 1).trim();

        // Check if item is inside the requested targetFolder hierarchy (supports arbitrary depth)
        const folderMatches = subfolderLower === targetFolder ||
            subfolderLower.startsWith(targetFolder + "/") ||
            subfolderLower.endsWith("/" + targetFolder) ||
            subfolderLower.includes(targetFolder) ||
            fullPathLower.startsWith(targetFolder + "/");

        if (!folderMatches) {
            return { match: false, score: 0 };
        }

        if (!fileSub) {
            // User entered "folder/" -> list all items in this folder
            return { match: true, score: 1000000 };
        }

        // File-level scoring within the matching folder
        if (cleanLower === fileSub) {
            return { match: true, score: 10000000 }; // Exact filename match
        }
        if (cleanLower.startsWith(fileSub)) {
            return { match: true, score: 5000000 }; // Prefix match
        }
        if (cleanLower.includes("_" + fileSub) || cleanLower.includes("-" + fileSub)) {
            return { match: true, score: 3000000 }; // Word boundary match
        }
        if (cleanLower.includes(fileSub)) {
            return { match: true, score: 1000000 }; // Substring match
        }
        if (fullPathLower.includes(fileSub)) {
            return { match: true, score: 500000 }; // Deep sub-subfolder path match
        }

        return { match: false, score: 0 };
    }

    // No slash in query -> Global search across all folders
    if (cleanLower === q) return { match: true, score: 10000000 }; // Exact filename
    if (cleanLower.startsWith(q)) return { match: true, score: 5000000 }; // Prefix match
    if (cleanLower.includes("_" + q) || cleanLower.includes("-" + q)) return { match: true, score: 3000000 }; // Word boundary
    if (cleanLower.includes(q)) return { match: true, score: 1000000 }; // Substring match
    if (subfolderLower.startsWith(q) || subfolderLower.includes("/" + q)) return { match: true, score: 800000 }; // Subfolder prefix
    if (fullPathLower.includes(q)) return { match: true, score: 400000 }; // Full relative path substring

    return { match: false, score: 0 };
}

function getLoraFolderSuggestions(loras, subQuery) {
    const q = (subQuery || "").trim();
    const qLower = q.toLowerCase();
    const lastSlash = qLower.lastIndexOf("/");

    let currentFolderLower = "";
    let filterQueryLower = "";

    if (lastSlash !== -1) {
        currentFolderLower = qLower.substring(0, lastSlash).trim();
        filterQueryLower = qLower.substring(lastSlash + 1).trim();
    } else {
        currentFolderLower = "";
        filterQueryLower = qLower;
    }

    const prefixLower = currentFolderLower ? currentFolderLower + "/" : "";

    const seenDirs = new Set();
    const folderItems = [];

    loras.forEach(l => {
        const subfolder = extractSubfolderPath(l);
        const subfolderLower = subfolder.toLowerCase();

        if (subfolder && (prefixLower === "" || subfolderLower.startsWith(prefixLower) || subfolderLower === currentFolderLower)) {
            let rel = "";
            let originalPrefix = "";

            if (prefixLower === "") {
                rel = subfolder;
                originalPrefix = "";
            } else if (subfolderLower.startsWith(prefixLower)) {
                originalPrefix = subfolder.substring(0, prefixLower.length);
                rel = subfolder.substring(prefixLower.length);
            }

            const parts = rel.split("/").filter(Boolean);
            if (parts.length > 0) {
                const nextDir = parts[0];
                const nextDirLower = nextDir.toLowerCase();

                if (!seenDirs.has(nextDirLower)) {
                    seenDirs.add(nextDirLower);
                    if (!filterQueryLower || nextDirLower.includes(filterQueryLower)) {
                        const fullDirPath = originalPrefix + nextDir;
                        folderItems.push({
                            text: `<lora:${fullDirPath}/`,
                            display: `<lora:${fullDirPath}/`,
                            type: "lora_dir",
                            category: "lora",
                            count: 0,
                            source: "lora",
                            sourceLabel: "Folder",
                            cleanName: nextDir,
                            subfolder: originalPrefix.replace(/\/$/, "")
                        });
                    }
                }
            }
        }
    });
    folderItems.sort((a, b) => (a.cleanName || "").localeCompare(b.cleanName || "", undefined, { numeric: true, sensitivity: "base" }));
    return folderItems;
}

function getActiveWorkflowLoras(currentText = "") {
    const activeLoras = new Set();

    try {
        if (typeof window !== "undefined") {
            const appInstance = window.app || (typeof app !== "undefined" ? app : null);
            if (appInstance && appInstance.graph && Array.isArray(appInstance.graph._nodes)) {
                appInstance.graph._nodes.forEach(node => {
                    if (node && node.mode === 0) {
                        const typeLower = String(node.type || node.comfyClass || node.title || "").toLowerCase();
                        const isLoader = typeLower.replace(/\s+/g, "").includes("loraloader") || typeLower.includes("loramanager");

                        if (isLoader && Array.isArray(node.widgets)) {
                            node.widgets.forEach(w => {
                                if (!w) return;
                                const val = String(w.value || "").trim();
                                if (!val || val === "None" || val === "none") return;

                                // Extract <lora:path:weight> syntax from textareas (e.g. Lora Loader LoraManager)
                                const loraMatches = val.matchAll(/<lora:([^:>]+)(?::[0-9.-]+)?>/gi);
                                for (const m of loraMatches) {
                                    if (m[1]) activeLoras.add(m[1].trim());
                                }

                                // Extract combo / filename values
                                const wNameLower = String(w.name || "").toLowerCase();
                                if (wNameLower.includes("lora") && !val.startsWith("<lora:")) {
                                    activeLoras.add(val);
                                }
                            });
                        }
                    }
                });
            }
        }
    } catch (_) {}

    if (currentText) {
        try {
            const loraMatches = String(currentText).matchAll(/<lora:([^:>]+)(?::[0-9.-]+)?>/gi);
            for (const m of loraMatches) {
                if (m[1]) activeLoras.add(m[1].trim());
            }
        } catch (_) {}
    }

    return [...activeLoras];
}

export function createThumbBadgeStack({ baseModel, civitaiUrl, hfUrl, isLMActive }) {
    if (!isLMActive) return null;

    const stack = document.createElement("div");
    stack.className = "acThumbBadgeStack";

    // 1. LM Badge (Top)
    const lmBadge = document.createElement("div");
    lmBadge.className = "acThumbBadge acThumbBadgeLm";
    lmBadge.title = "Managed by LoRA Manager";
    lmBadge.innerHTML = getLoraManagerIconImg();
    stack.appendChild(lmBadge);

    // 2. Base Model Badge (Middle, if available)
    if (baseModel) {
        const baseBadge = document.createElement("div");
        baseBadge.className = "acThumbBadge acThumbBadgeBase";
        baseBadge.title = `Base Model: ${baseModel}`;
        baseBadge.textContent = baseModel;
        stack.appendChild(baseBadge);
    }

    // 3. External Link Badge (Bottom, if available)
    const rawUrl = civitaiUrl || hfUrl || "";
    const extMeta = getExternalLinkMeta(rawUrl);
    if (extMeta) {
        const extBadge = document.createElement("div");
        extBadge.className = `acThumbBadge acThumbBadgeExt acExt-${extMeta.type}`;
        extBadge.title = extMeta.tooltip;
        extBadge.innerHTML = `${extMeta.iconImg}<span>${extMeta.name}</span>`;
        extBadge.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            e.preventDefault();
            openCivitaiUrl(extMeta.url);
        });
        stack.appendChild(extBadge);
    }

    return stack;
}

export function updateThumbBadgeStack(stack, { baseModel, civitaiUrl, hfUrl }) {
    if (!stack) return;

    // Check if base badge already exists
    let baseBadge = stack.querySelector(".acThumbBadgeBase");
    if (!baseBadge && baseModel) {
        baseBadge = document.createElement("div");
        baseBadge.className = "acThumbBadge acThumbBadgeBase";
        baseBadge.title = `Base Model: ${baseModel}`;
        baseBadge.textContent = baseModel;
        const lmBadge = stack.querySelector(".acThumbBadgeLm");
        if (lmBadge && lmBadge.nextSibling) {
            stack.insertBefore(baseBadge, lmBadge.nextSibling);
        } else {
            stack.appendChild(baseBadge);
        }
    }

    // Check if ext badge already exists
    let extBadge = stack.querySelector(".acThumbBadgeExt");
    const rawUrl = civitaiUrl || hfUrl || "";
    const extMeta = getExternalLinkMeta(rawUrl);
    if (!extBadge && extMeta) {
        extBadge = document.createElement("div");
        extBadge.className = `acThumbBadge acThumbBadgeExt acExt-${extMeta.type}`;
        extBadge.title = extMeta.tooltip;
        extBadge.innerHTML = `${extMeta.iconImg}<span>${extMeta.name}</span>`;
        extBadge.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            e.preventDefault();
            openCivitaiUrl(extMeta.url);
        });
        stack.appendChild(extBadge);
    }
}

export class TagCompleteEngine {
    constructor() {
        this.mainTags = [];
        this.extraTags = [];
        this.loadedDictionaries = [];
        this.translations = new Map();
        this.reverseTranslations = new Map();
        this.loras = [];
        this.loraDuplicatesSet = new Set();
        this.isInsideLoraPrefixSession = false;
        this.embeddings = [];
        this.wildcards = [];
        this.wildcardCache = new Map();
        this.currentLoadedTagFile = null;
        this.currentLoadedExtraFiles = null;
        this.currentLoadedTranslationFile = null;

        this.target = null;
        this.isVisible = false;
        this.isInserting = false;
        this.suppressNextSearch = false;
        this.currentPreviewUrl = null;
        this.currentPreviewTitle = null;
        this.results = [];
        this.selectedIndex = 0;
        this.currentTagword = "";
        this.tagwordStart = 0;
        this.tagwordEnd = 0;

        this.domRoot = null;
        this.domList = null;
        this.domContainer = null;

        // Keyboard navigation hover lock state
        this.ignoreMouseHover = false;
        this.currentMouseX = -1;
        this.currentMouseY = -1;
        this.lockAnchorX = -1;
        this.lockAnchorY = -1;

        // Key repeat suppression state
        this.isKeyRepeating = false;
        this.hasPendingInput = false;

        // Floating thumbnail preview cards
        this.loraPreviewCard = null;
        this.previewCard = null;
        this.previewImg = null;
        this.previewTitle = null;
        this.triggerPreviewCard = null;

        this.userUsageMap = this.loadUserUsage();

        window.addEventListener("tagcomplete-clear-favor-history", () => {
            this.userUsageMap = {};
            try {
                localStorage.removeItem("Comfy.TagComplete.UserTagUsage");
            } catch (_) {}
            try {
                fetch("/autocomplete-plus-plus/user-data", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "clear_usage", timestamp: Date.now() })
                }).catch(() => {});
            } catch (_) {}
        });

        // Sync user usage and settings with backend user_data.json
        this.syncUserUsageAndSettingsWithBackend();

        this.createDOM();
        this.bindGlobalEvents();
    }

    async syncUserUsageAndSettingsWithBackend() {
        try {
            const resp = await fetch("/autocomplete-plus-plus/user-data").catch(() => null);
            if (!resp || !resp.ok) return;
            const res = await resp.json().catch(() => null);
            if (!res || !res.success || !res.data) return;

            const serverData = res.data;
            const serverSettings = serverData.settings || {};
            const serverUsage = serverData.tag_usage || {};

            // 1. Settings reconciliation (Auto-seed on first launch, reconcile on subsequent runs)
            const currentLocalSettings = {
                "Enabled": settingValues.enabled,
                "KeyAcceptTab": settingValues.keyAcceptTab,
                "KeyAcceptEnter": settingValues.keyAcceptEnter,
                "IgnoredNodeTypes": settingValues.ignoredNodeTypes,
                "OverrideNodeTypes": settingValues.overrideNodeTypes,
                "TagFile": settingValues.tagFile,
                "ExtraFiles": settingValues.extraFiles,
                "TranslationFile": settingValues.translationFile,
                "SearchTranslation": settingValues.searchTranslation,
                "ShowTranslations": settingValues.showTranslations,
                "TranslationOldFormat": settingValues.oldFormat,
                "ShowWikiLinks": settingValues.showWikiLinks,
                "PreviewPosition": settingValues.previewPosition,
                "LoraManagerMode": settingValues.loraManagerMode,
                "EnableModels": settingValues.enableModels,
                "AnimaArtistMode": settingValues.animaArtistMode,
                "ReplaceUnderscore": settingValues.replaceUnderscore,
                "EscapeParentheses": settingValues.escapeParentheses,
                "FrequencySort": settingValues.frequencySort,
                "FavorMinCount": settingValues.favorMinCount,
                "FavorMaxAge": settingValues.favorMaxAge,
                "FavorMaxTags": settingValues.favorMaxTags,
                "AutoFormatOnBlur": settingValues.autoFormatOnBlur,
                "FormatSpaceAfterComma": settingValues.formatSpaceAfterComma,
                "FormatTrimPromptEndComma": settingValues.formatTrimPromptEndComma,
                "FormatTrimLineEndComma": settingValues.formatTrimLineEndComma,
                "FormatReplaceUnderscore": settingValues.formatReplaceUnderscore,
                "FormatKeepUnderscoresList": settingValues.formatKeepUnderscoresList,
                "AutoInsertComma": settingValues.autoInsertComma,
                "MaxSuggestions": settingValues.maxSuggestions,
                "EnablePromptExpansion": settingValues.enablePromptExpansion,
                "DynamicPromptMode": settingValues.dynamicPromptMode,
                "WildcardMode": settingValues.wildcardMode,
                "EnableHotkeyEnhance": settingValues.enableHotkeyEnhance,
                "EnableTagWeightHotkey": settingValues.enableTagWeightHotkey,
                "EnableTagJumpHotkey": settingValues.enableTagJumpHotkey,
                "EnableTagSwapHotkey": settingValues.enableTagSwapHotkey
            };

            const serverHasSettings = serverSettings && Object.keys(serverSettings).length > 0;

            if (!serverHasSettings) {
                // Seed default local settings to backend on initial startup
                fetch("/autocomplete-plus-plus/user-data", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action: "save_settings",
                        settings: currentLocalSettings,
                        timestamp: Date.now()
                    })
                }).catch(() => {});
            } else {
                // Server already has settings: Server is source of truth for differing keys
                const missingSettingsToUpload = {};
                for (const [k, v] of Object.entries(currentLocalSettings)) {
                    if (serverSettings[k] === undefined && v !== undefined) {
                        missingSettingsToUpload[k] = v;
                    }
                }
                if (Object.keys(missingSettingsToUpload).length > 0) {
                    fetch("/autocomplete-plus-plus/user-data", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            action: "save_settings",
                            settings: missingSettingsToUpload,
                            timestamp: Date.now()
                        })
                    }).catch(() => {});
                }

                for (const [key, val] of Object.entries(serverSettings)) {
                    if (val !== undefined && val !== null) {
                        try {
                            const storageKey = "Comfy.Settings." + id + "." + key;
                            const localValRaw = localStorage.getItem(storageKey);
                            const localVal = localValRaw !== null ? JSON.parse(localValRaw) : undefined;
                            if (localVal !== val) {
                                localStorage.setItem(storageKey, JSON.stringify(val));
                                const camelKey = key.charAt(0).toLowerCase() + key.slice(1);
                                if (camelKey in settingValues) {
                                    settingValues[camelKey] = val;
                                }
                            }
                        } catch (_) {}
                    }
                }
            }

            // 2. Tag usage synchronization
            const localUsage = this.userUsageMap || {};
            const localKeys = Object.keys(localUsage);
            const serverKeys = Object.keys(serverUsage);
            const localCount = localKeys.length;
            const serverCount = serverKeys.length;

            const isDisasterLoss = (localCount === 0 && serverCount > 0) ||
                                  (serverCount >= 10 && localCount < Math.max(3, Math.floor(serverCount * 0.2)));

            if (isDisasterLoss) {
                // Restore server data if local usage data is missing or empty
                this.userUsageMap = { ...serverUsage };
                this.saveUserUsage();
                logDebug(`[Autocomplete++] Restored user tag usage from user_data.json (${serverCount} tags).`);
            } else {
                // Merge local and server entries, keeping max count and latest lastUsed
                let hasMergedChanges = false;
                const merged = { ...serverUsage };

                for (const [tag, localEntry] of Object.entries(localUsage)) {
                    const serverEntry = merged[tag];
                    if (!serverEntry) {
                        merged[tag] = localEntry;
                        hasMergedChanges = true;
                    } else {
                        const localCnt = typeof localEntry === "number" ? localEntry : (localEntry?.count || 0);
                        const serverCnt = typeof serverEntry === "number" ? serverEntry : (serverEntry?.count || 0);
                        const localTime = typeof localEntry === "object" ? (localEntry?.lastUsed || 0) : 0;
                        const serverTime = typeof serverEntry === "object" ? (serverEntry?.lastUsed || 0) : 0;

                        const maxCnt = Math.max(localCnt, serverCnt);
                        const latestTime = Math.max(localTime, serverTime);

                        merged[tag] = {
                            count: maxCnt,
                            lastUsed: latestTime || Date.now()
                        };
                        if (maxCnt !== serverCnt || latestTime !== serverTime) {
                            hasMergedChanges = true;
                        }
                    }
                }

                this.userUsageMap = merged;
                this.saveUserUsage();

                // If local had new / updated data, persist merged back to server JSON once at startup
                if (hasMergedChanges || localCount > serverCount || (serverCount === 0 && localCount > 0)) {
                    fetch("/autocomplete-plus-plus/user-data", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            action: "save_usage",
                            tag_usage: merged,
                            timestamp: Date.now()
                        })
                    }).catch(() => {});
                }
            }
        } catch (e) {
            console.debug("[Autocomplete++] User data sync error:", e);
        }
    }

    loadUserUsage() {
        try {
            const raw = localStorage.getItem("Comfy.TagComplete.UserTagUsage");
            if (raw) {
                const parsed = JSON.parse(raw);
                if (typeof parsed === "object" && parsed !== null) {
                    return parsed;
                }
            }
        } catch (_) {}
        return {};
    }

    saveUserUsage() {
        try {
            localStorage.setItem("Comfy.TagComplete.UserTagUsage", JSON.stringify(this.userUsageMap));
        } catch (_) {}
    }

    getTagUsage(tag) {
        if (!tag || !settingValues.frequencySort) return 0;
        const clean = tag.toLowerCase().replace(/[\s_\\\-]+/g, "");
        const entry = this.userUsageMap[clean];
        if (!entry) return 0;

        let count = 0;
        let lastUsed = null;
        if (typeof entry === "number") {
            count = entry;
        } else if (entry && typeof entry.count === "number") {
            count = entry.count;
            lastUsed = entry.lastUsed;
        }

        // Apply Time Decay / Max Age Check (0 = Never expire)
        const maxAgeDays = settingValues.favorMaxAge !== undefined ? settingValues.favorMaxAge : 30;
        if (maxAgeDays > 0 && lastUsed) {
            const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
            if (Date.now() - lastUsed > maxAgeMs) {
                return 0; // Expired by time decay
            }
        }

        return count;
    }

    recordTagUsage(tag) {
        if (!tag) return;
        const clean = tag.toLowerCase().replace(/[\s_\\\-]+/g, "");
        if (!clean) return;

        const current = this.getTagUsage(tag);
        this.userUsageMap[clean] = {
            count: current + 1,
            lastUsed: Date.now()
        };

        // Dynamic safety cap: settingValues.favorMaxTags (10,000 - 50,000) with LRU pruning
        const maxCap = settingValues.favorMaxTags || 10000;
        const triggerThreshold = maxCap + Math.min(2000, Math.floor(maxCap * 0.1));
        const keys = Object.keys(this.userUsageMap);
        if (keys.length > triggerThreshold) {
            const sorted = keys
                .map(k => ({ key: k, entry: this.userUsageMap[k] }))
                .sort((a, b) => ((b.entry && b.entry.lastUsed) || 0) - ((a.entry && a.entry.lastUsed) || 0))
                .slice(0, maxCap);
            const pruned = {};
            for (const item of sorted) {
                pruned[item.key] = item.entry;
            }
            this.userUsageMap = pruned;
        }

        this.saveUserUsage();
    }

    createDOM() {
        this.domContainer = document.createElement("div");
        this.domContainer.className = "autocompleteParent";
        this.domContainer.id = "tagcomplete-popup-container";

        // Restore persisted width from localStorage onto the outer container
        const savedWidth = localStorage.getItem("comfyui-tagcomplete-width");
        if (savedWidth) {
            this.domContainer.style.width = savedWidth;
        }

        // Observe resize on outer container to persist user-adjusted width
        if (window.ResizeObserver) {
            const ro = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    if (entry.contentRect && entry.contentRect.width > 200) {
                        localStorage.setItem("comfyui-tagcomplete-width", `${Math.round(entry.contentRect.width)}px`);
                    }
                }
            });
            ro.observe(this.domContainer);
        }

        this.domRoot = document.createElement("div");
        this.domRoot.className = "autocompleteResults";

        this.domList = document.createElement("ul");
        this.domList.className = "autocompleteResultsList";

        this.domRoot.appendChild(this.domList);
        this.domContainer.appendChild(this.domRoot);
        document.body.appendChild(this.domContainer);

        // Global pointer delta & click tracker to release keyboard navigation lock upon intentional mouse motion (>= 4px from anchor) or clicks
        window.addEventListener("mousemove", (e) => {
            this.checkMouseUnlock(e.clientX, e.clientY);
        }, { passive: true });

        window.addEventListener("mousedown", (e) => {
            this.unlockMouseHover();
            this.currentMouseX = e.clientX;
            this.currentMouseY = e.clientY;
        }, { passive: true });

        // 1. Create regular floating preview card (for LoRA / Embeddings single thumbnail)
        this.loraPreviewCard = document.createElement("div");
        this.loraPreviewCard.className = "acPreviewCard";
        this.loraPreviewCard.id = "tagcomplete-preview-card";

        this.previewImg = document.createElement("img");
        this.previewImg.className = "acPreviewImg";
        this.previewImg.alt = "Preview";
        this.loraPreviewCard.appendChild(this.previewImg);

        this.previewTitle = document.createElement("div");
        this.previewTitle.className = "acPreviewTitle";
        this.loraPreviewCard.appendChild(this.previewTitle);

        document.body.appendChild(this.loraPreviewCard);
        this.previewCard = this.loraPreviewCard; // alias for backwards compatibility

        // 2. Create dedicated floating multi-model preview card (for Trigger Words)
        this.triggerPreviewCard = document.createElement("div");
        this.triggerPreviewCard.className = "acTriggerPreviewCard";
        this.triggerPreviewCard.id = "tagcomplete-trigger-preview-card";
        document.body.appendChild(this.triggerPreviewCard);

        // 3. Create independent floating compound prompt sets card (appears above preview card)
        this.compoundContainer = document.createElement("div");
        this.compoundContainer.className = "acCompoundFloatingContainer";
        this.compoundContainer.id = "tagcomplete-compound-card";
        document.body.appendChild(this.compoundContainer);

        // Create Multi-LoRA Info Popover Dialog with downward pointer
        this.infoPopover = document.createElement("div");
        this.infoPopover.className = "acInfoPopover";
        this.infoPopover.id = "tagcomplete-info-popover";
        document.body.appendChild(this.infoPopover);

        // Prevent pointer and mouse events inside popup containers from propagating to outer modals / backdrop dismissal listeners
        const popupContainers = [
            this.domContainer,
            this.loraPreviewCard,
            this.triggerPreviewCard,
            this.compoundContainer,
            this.infoPopover
        ];

        popupContainers.forEach(el => {
            if (!el) return;
            const stopPropagation = (e) => {
                e.stopPropagation();
            };
            el.addEventListener("pointerdown", stopPropagation);
            el.addEventListener("mousedown", stopPropagation);
            el.addEventListener("mouseup", stopPropagation);
            el.addEventListener("click", stopPropagation);
            el.addEventListener("wheel", stopPropagation, { passive: true });
        });
    }

    bindGlobalEvents() {
        window.addEventListener("tagcomplete-reload-tags", () => {
            this.loadAllData();
        });

        // Hide info popover when scrolling dropdown list or wheeling
        if (this.domRoot) {
            this.domRoot.addEventListener("scroll", () => this.hideInfoPopover(), { passive: true });
        }
        if (this.domContainer) {
            this.domContainer.addEventListener("wheel", () => this.hideInfoPopover(), { passive: true });
        }
        window.addEventListener("wheel", () => {
            if (this.infoPopover && this.infoPopover.style.display !== "none") {
                this.hideInfoPopover();
            }
        }, { passive: true });

        // Hide popup on click outside
        document.addEventListener("mousedown", (e) => {
            if (
                this.isVisible &&
                !this.domContainer.contains(e.target) &&
                (!this.loraPreviewCard || !this.loraPreviewCard.contains(e.target)) &&
                (!this.triggerPreviewCard || !this.triggerPreviewCard.contains(e.target)) &&
                (!this.compoundContainer || !this.compoundContainer.contains(e.target)) &&
                (!this.infoPopover || !this.infoPopover.contains(e.target)) &&
                e.target !== this.target
            ) {
                this.hide();
            }
        });
    }

    async loadCSVFile(filename) {
        if (!filename || filename === "None") return [];
        const cleanName = filename.trim();
        if (csvCache.has(cleanName)) {
            return csvCache.get(cleanName);
        }
        try {
            const res = await fetch(`/autocomplete-plus-plus/tags/file/${encodeURIComponent(cleanName)}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = await res.text();
            const parsed = parseCSV(text);
            csvCache.set(cleanName, parsed);
            return parsed;
        } catch (e) {
            console.warn(`[Autocomplete++] Failed to load CSV '${cleanName}':`, e);
            return [];
        }
    }

    async loadAllData(force = false) {
        const effDicts = getEffectiveDictionarySettings();

        if (!force &&
            this.currentLoadedTagFile === effDicts.tagFile &&
            this.currentLoadedExtraFiles === effDicts.extraFiles &&
            this.currentLoadedTranslationFile === effDicts.translationFile &&
            this.mainTags && this.mainTags.length > 0) {
            return;
        }

        this.currentLoadedTagFile = effDicts.tagFile;
        this.currentLoadedExtraFiles = effDicts.extraFiles;
        this.currentLoadedTranslationFile = effDicts.translationFile;

        // 0. Build dynamic index of all active loaded dictionaries
        this.loadedDictionaries = buildLoadedDictionaryIndex(effDicts.tagFile, effDicts.extraFiles);

        // 1. Load Main Tags
        if (effDicts.tagFile && effDicts.tagFile !== "None") {
            const mainLabel = formatSourceLabel(effDicts.tagFile);
            const raw = await this.loadCSVFile(effDicts.tagFile);
            this.mainTags = raw.map(row => ({
                name: row[0] || "",
                category: parseInt(row[1], 10) || 0,
                count: parseInt(row[2], 10) || 0,
                aliases: row[3] ? row[3].split(",").map(a => a.trim()).filter(Boolean) : [],
                sourceFile: effDicts.tagFile.toLowerCase(),
                sourceLabel: mainLabel
            }));
        } else {
            this.mainTags = [];
        }

        // 2. Load Extra Tag Files (supports comma-separated list of files)
        this.extraTags = [];
        if (effDicts.extraFiles && effDicts.extraFiles.trim()) {
            const extraFileNames = effDicts.extraFiles
                .split(",")
                .map(s => s.trim())
                .filter(Boolean);

            for (const ef of extraFileNames) {
                const extraLabel = formatSourceLabel(ef);
                const raw = await this.loadCSVFile(ef);
                raw.forEach(row => {
                    const tagObj = {
                        name: row[0] || "",
                        category: parseInt(row[1], 10) || 0,
                        count: parseInt(row[2], 10) || 0,
                        aliases: row[3] ? row[3].split(",").map(a => a.trim()).filter(Boolean) : [],
                        sourceFile: ef.toLowerCase(),
                        sourceLabel: extraLabel
                    };
                    this.extraTags.push(tagObj);

                    // If extra file has 5th column translation, map it directly
                    if (row[4]) {
                        this.translations.set(tagObj.name.toLowerCase(), row[4]);
                    }
                });
            }
        }

        // 3. Load Translation File
        this.translations.clear();
        this.reverseTranslations.clear();
        if (effDicts.translationFile && effDicts.translationFile !== "None") {
            const rawTrans = await this.loadCSVFile(effDicts.translationFile);
            rawTrans.forEach(row => {
                const tag = (row[0] || "").trim().toLowerCase();
                let trans = "";
                if (row.length > 2) {
                    trans = row[1] || "";
                } else if (row.length === 2) {
                    trans = row[1] || "";
                }
                if (tag && trans) {
                    this.translations.set(tag, trans);

                    const transLower = trans.toLowerCase();
                    if (!this.reverseTranslations.has(transLower)) {
                        this.reverseTranslations.set(transLower, []);
                    }
                    this.reverseTranslations.get(transLower).push(row[0].trim());
                }
            });
        }

        // 4. Load Models & Wildcards
        try {
            const [loras, embeddings, wildcards] = await Promise.all([
                fetch("/autocomplete-plus-plus/models/loras").then(r => r.json()).catch(() => []),
                fetch("/autocomplete-plus-plus/models/embeddings").then(r => r.json()).catch(() => []),
                fetch("/autocomplete-plus-plus/models/wildcards").then(r => r.json()).catch(() => [])
            ]);
            this.loras = loras || [];
            this.embeddings = embeddings || [];
            this.wildcards = wildcards || [];
            this.rebuildLoraDuplicatesSet();
        } catch (e) {
            console.warn("[Autocomplete++] Failed to load model lists:", e);
        }

        logDebug(`[Autocomplete++] Loaded ${this.mainTags.length} main tags, ${this.extraTags.length} extra tags, ${this.translations.size} translations, ${this.loras.length} LoRAs, ${this.embeddings.length} Embeddings.`);
    }

    rebuildLoraDuplicatesSet() {
        this.loraDuplicatesSet = new Set();
        if (!Array.isArray(this.loras)) return;
        const nameCounts = new Map();
        for (const l of this.loras) {
            const base = getCleanModelName(l).toLowerCase();
            nameCounts.set(base, (nameCounts.get(base) || 0) + 1);
        }
        for (const [name, count] of nameCounts) {
            if (count > 1) {
                this.loraDuplicatesSet.add(name);
            }
        }
    }

    async fetchWildcardLines(fileName) {
        if (!fileName) return [];
        const cleanName = fileName.replace(/^__/, "").replace(/__$/, "").replace(/\.txt$/i, "").trim();
        if (this.wildcardCache.has(cleanName)) {
            return this.wildcardCache.get(cleanName);
        }

        try {
            const res = await fetch(`/autocomplete-plus-plus/wildcards/content?name=${encodeURIComponent(cleanName)}`);
            if (res.ok) {
                const data = await res.json();
                if (data && Array.isArray(data.lines)) {
                    this.wildcardCache.set(cleanName, data.lines);
                    return data.lines;
                }
            }
        } catch (e) {
            console.warn(`[Autocomplete++] Failed to fetch wildcard content for '${cleanName}':`, e);
        }
        return [];
    }

    getWildcardFolderItems(currentFolder, filterQuery = "") {
        const items = [];
        const seenDirs = new Set();
        const prefix = currentFolder ? currentFolder + "/" : "";
        const fQuery = filterQuery.toLowerCase();

        this.wildcards.forEach(wc => {
            if (wc.startsWith(prefix)) {
                const rel = wc.substring(prefix.length);
                const parts = rel.split("/");
                if (parts.length > 1) {
                    const dirName = parts[0];
                    if (!seenDirs.has(dirName)) {
                        seenDirs.add(dirName);
                        if (!fQuery || dirName.toLowerCase().includes(fQuery)) {
                            const fullDirPath = prefix + dirName;
                            items.push({
                                text: `__${fullDirPath}/`,
                                display: `__${fullDirPath}/`,
                                type: "wildcard_dir",
                                category: "wildcard",
                                count: 0,
                                sourceLabel: "Wildcard"
                            });
                        }
                    }
                } else {
                    const fileName = parts[0];
                    if (!fQuery || fileName.toLowerCase().includes(fQuery)) {
                        const fullFilePath = prefix + fileName;
                        items.push({
                            text: `__${fullFilePath}/`,
                            display: `__${fullFilePath}/`,
                            type: "wildcard_file_step",
                            category: "wildcard",
                            count: 0,
                            sourceLabel: "Wildcard",
                            wildcardPath: fullFilePath
                        });
                    }
                }
            }
        });

        // Natural A-Z alphabetical sorting with subdirectories first
        items.sort((a, b) => {
            if (a.type !== b.type) {
                if (a.type === "wildcard_dir") return -1;
                if (b.type === "wildcard_dir") return 1;
            }
            const nameA = (a.display || a.text || "").toLowerCase();
            const nameB = (b.display || b.text || "").toLowerCase();
            return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: "base" });
        });

        return items;
    }

    extractTagword(element) {
        const text = element.value || "";
        let cursor = element.selectionStart;

        if (element.selectionStart !== element.selectionEnd) {
            const selected = text.substring(element.selectionStart, element.selectionEnd);
            if (selected.startsWith("<") && selected.endsWith(">")) {
                cursor = element.selectionEnd;
            } else if (selected.startsWith("(") && selected.endsWith(")")) {
                const inner = selected.slice(1, -1).trim();
                if (/^(?:embedding|emb):/i.test(inner)) {
                    this.tagwordStart = element.selectionStart + 1;
                    this.tagwordEnd = element.selectionEnd - 1;
                    this.currentTagword = inner;
                    return inner;
                }
            } else if (/^(?:embedding|emb):/i.test(selected)) {
                cursor = element.selectionEnd;
            }
        }

        // 1. Check if cursor is inside __...__
        let wcStart = -1;
        let i = cursor;
        while (i >= 2) {
            const c = text[i - 1];
            if (c === '\n' || c === '\r' || c === ',') break;
            if (text.substring(i - 2, i) === "__") {
                wcStart = i - 2;
                break;
            }
            i--;
        }

        if (wcStart !== -1) {
            let wcEnd = -1;
            let j = wcStart + 2;
            while (j <= text.length - 2) {
                const c = text[j];
                if (c === '\n' || c === '\r' || c === ',') break;
                if (text.substring(j, j + 2) === "__") {
                    wcEnd = j + 2;
                    break;
                }
                j++;
            }

            if (wcEnd !== -1 && cursor <= wcEnd) {
                this.tagwordStart = wcStart;
                this.tagwordEnd = wcEnd;
                this.currentTagword = text.substring(wcStart, cursor);
                return text.substring(wcStart, wcEnd);
            }
        }

        // 2. Determine if cursor is inside an unclosed Dynamic Prompt { ... } or Alternation [ ... ]
        let insideChoiceContainer = false;
        let depthBrace = 0;
        let depthBracket = 0;
        for (let k = cursor - 1; k >= 0; k--) {
            const ch = text[k];
            const esc = (k > 0 && text[k - 1] === '\\');
            if (esc) continue;
            if (ch === '}') depthBrace++;
            else if (ch === '{') {
                if (depthBrace > 0) depthBrace--;
                else { insideChoiceContainer = true; break; }
            } else if (ch === ']') depthBracket++;
            else if (ch === '[') {
                if (depthBracket > 0) depthBracket--;
                else { insideChoiceContainer = true; break; }
            } else if (ch === '\n' || ch === '\r') {
                break;
            }
        }

        // 3. Backward scan for tagword start
        let start = cursor;
        while (start > 0) {
            const c = text[start - 1];
            const isEscaped = (start - 2 >= 0 && text[start - 2] === '\\');
            if (c === ',' || c === '\n' || c === '\r') {
                break;
            }
            if (c === '<') {
                start = start - 1;
                break;
            }
            if (!isEscaped) {
                if (c === '(' || c === '[' || c === '{' || c === '}' || c === ')') {
                    break;
                }
                if (c === '|' && insideChoiceContainer) {
                    break;
                }
            }
            start--;
        }

        const raw = text.substring(start, cursor);
        const tagword = raw.trimStart();
        const leadingWhitespace = raw.length - tagword.length;

        this.tagwordStart = start + leadingWhitespace;
        this.tagwordEnd = cursor;
        this.currentTagword = tagword;

        return tagword;
    }

    isAnimaWorkflowActive() {
        const fmtSettings = getEffectiveFormattingSettings();
        if (fmtSettings.animaArtistMode === "Enabled") return true;
        if (fmtSettings.animaArtistMode === "Disabled") return false;

        // "Auto" mode: Traverse current canvas node graph
        if (typeof window === "undefined" || !window.app || !window.app.graph || !Array.isArray(window.app.graph._nodes)) {
            return false;
        }

        let hasUnetLoader = false;
        let hasVaeLoader = false;
        let hasClipLoader = false;

        for (const node of window.app.graph._nodes) {
            if (!node || node.mode === 2) continue; // Skip muted/disabled nodes
            const typeLower = (node.type || "").toLowerCase();

            if (typeLower.includes("unetloader") || typeLower.includes("diffusionloader") || (node.widgets && node.widgets.some(w => w.name === "unet_name"))) {
                hasUnetLoader = true;
            }
            if (typeLower.includes("vaeloader") || (node.widgets && node.widgets.some(w => w.name === "vae_name"))) {
                hasVaeLoader = true;
            }
            if (typeLower.includes("cliploader") || typeLower.includes("dualcliploader") || (node.widgets && node.widgets.some(w => w.name === "clip_name" || (w.name === "type" && String(w.value).includes("qwen"))))) {
                hasClipLoader = true;
            }
        }

        return hasUnetLoader && hasVaeLoader && hasClipLoader;
    }

    async searchCandidates(query) {
        if (!query) return [];
        await this.loadAllData();

        const qLower = query.toLowerCase();
        let candidates = [];

        // 0.7. Anima Model Artist Search Mode (@...)
        if (qLower.startsWith("@") && this.isAnimaWorkflowActive()) {
            const rawSub = query.substring(1);
            const subClean = rawSub.replace(/ /g, "_").replace(/\\/g, "").trim().toLowerCase();

            const formatItem = (t, isArtist = false, matchedAlias = null) => {
                const tagName = t.name;
                const tagTrans = (settingValues.searchTranslation || settingValues.showTranslations) ? this.translations.get(tagName.toLowerCase()) : null;
                const cleanText = isArtist ? `@${tagName}` : tagName;
                let displayText = cleanText;

                if (matchedAlias) {
                    const aliasTrans = (settingValues.searchTranslation || settingValues.showTranslations) ? this.translations.get(matchedAlias.toLowerCase()) : null;
                    const aliasLabel = isArtist ? `@${matchedAlias}` : matchedAlias;
                    const fullAliasLabel = (aliasTrans && settingValues.showTranslations) ? `${aliasLabel} [${aliasTrans}]` : aliasLabel;
                    const fullTagLabel = (tagTrans && settingValues.showTranslations) ? `${cleanText} [${tagTrans}]` : cleanText;
                    displayText = `${fullAliasLabel} ➝ ${fullTagLabel}`;
                } else if (tagTrans && settingValues.showTranslations) {
                    displayText = `${cleanText} [${tagTrans}]`;
                }

                return {
                    text: cleanText,
                    display: displayText,
                    category: t.category,
                    catId: t.category,
                    count: t.count || 0,
                    type: isArtist ? "artist" : undefined,
                    source: "tag",
                    sourceLabel: isArtist ? "Artist" : (t.category === 0 ? "General" : "Tag"),
                    sourceFile: t.sourceFile,
                    matchedAlias: matchedAlias
                };
            };

            if (subClean === "") {
                // User typed solely "@":
                // 1. Regular non-artist entries whose name literally starts with "@" (sorted A-Z)
                // 2. Regular non-artist entries whose name literally contains "@" (sorted A-Z)
                // 3. Artist tags (category: 1), displayed as @artist_name, sorted by count descending
                const literalAtHead = [];
                const literalAtContains = [];
                const allArtistTags = [];
                const seen = new Set();

                const collectTags = (list) => {
                    if (!Array.isArray(list)) return;
                    for (const t of list) {
                        const nameLower = (t.name || "").toLowerCase();
                        if (t.category === 1) {
                            if (!seen.has(nameLower)) {
                                seen.add(nameLower);
                                allArtistTags.push(t);
                            }
                        } else {
                            if (nameLower.startsWith("@")) {
                                if (!seen.has(nameLower)) {
                                    seen.add(nameLower);
                                    literalAtHead.push(t);
                                }
                            } else if (nameLower.includes("@")) {
                                if (!seen.has(nameLower)) {
                                    seen.add(nameLower);
                                    literalAtContains.push(t);
                                }
                            }
                        }
                    }
                };

                collectTags(this.mainTags);
                collectTags(this.extraTags);

                // Sort literal @ items A-Z
                literalAtHead.sort((a, b) => a.name.localeCompare(b.name));
                literalAtContains.sort((a, b) => a.name.localeCompare(b.name));

                // Sort Artist tags by count descending
                allArtistTags.sort((a, b) => (b.count || 0) - (a.count || 0));

                const maxLimit = settingValues.maxSuggestions || 15;

                return [
                    ...literalAtHead.map(t => formatItem(t, false)),
                    ...literalAtContains.map(t => formatItem(t, false)),
                    ...allArtistTags.map(t => formatItem(t, true))
                ].slice(0, maxLimit);
            } else {
                // User typed "@" followed by query string (e.g. "@wada" or "@c"):
                // Supports primary tag, aliases, and translations
                const prefixArtists = [];
                const containsArtists = [];
                const prefixOthers = [];
                const containsOthers = [];
                const seen = new Set();
                const rawKeyword = rawSub.trim().toLowerCase();

                const collectSubQuery = (list) => {
                    if (!Array.isArray(list)) return;
                    for (const t of list) {
                        const nameLower = (t.name || "").toLowerCase();
                        const cleanTagNameLower = nameLower.replace(/\\/g, "");
                        if (seen.has(nameLower)) continue;

                        const tagTrans = this.translations.get(nameLower);
                        const cleanTrans = (tagTrans && settingValues.searchTranslation) ? tagTrans.toLowerCase().trim() : null;

                        if (t.category === 1) {
                            let matched = false;
                            // 1. Primary Name & Translation Prefix Match
                            if (cleanTagNameLower.startsWith(subClean) || (cleanTrans && cleanTrans.startsWith(rawKeyword))) {
                                seen.add(nameLower);
                                prefixArtists.push({ tag: t, alias: null });
                                matched = true;
                            }

                            // 2. Alias Prefix Match
                            if (!matched && t.aliases && t.aliases.length > 0) {
                                for (const al of t.aliases) {
                                    const alClean = al.toLowerCase().replace(/\\/g, "");
                                    const alTrans = settingValues.searchTranslation ? this.translations.get(al.toLowerCase()) : null;
                                    const alTransClean = alTrans ? alTrans.toLowerCase().trim() : null;
                                    if (alClean.startsWith(subClean) || (alTransClean && alTransClean.startsWith(rawKeyword))) {
                                        seen.add(nameLower);
                                        prefixArtists.push({ tag: t, alias: al });
                                        matched = true;
                                        break;
                                    }
                                }
                            }

                            // 3. Primary Name Word Boundary & Contains Match
                            if (!matched) {
                                if (cleanTagNameLower.includes(subClean) || (cleanTrans && cleanTrans.includes(rawKeyword))) {
                                    seen.add(nameLower);
                                    containsArtists.push({ tag: t, alias: null });
                                    matched = true;
                                }
                            }

                            // 4. Alias Contains Match
                            if (!matched && t.aliases && t.aliases.length > 0) {
                                for (const al of t.aliases) {
                                    const alClean = al.toLowerCase().replace(/\\/g, "");
                                    const alTrans = settingValues.searchTranslation ? this.translations.get(al.toLowerCase()) : null;
                                    const alTransClean = alTrans ? alTrans.toLowerCase().trim() : null;
                                    if (alClean.includes(subClean) || (alTransClean && alTransClean.includes(rawKeyword))) {
                                        seen.add(nameLower);
                                        containsArtists.push({ tag: t, alias: al });
                                        matched = true;
                                        break;
                                    }
                                }
                            }
                        } else {
                            if (nameLower.startsWith("@" + subClean)) {
                                seen.add(nameLower);
                                prefixOthers.push({ tag: t, alias: null });
                            } else if (nameLower.includes("@" + subClean)) {
                                seen.add(nameLower);
                                containsOthers.push({ tag: t, alias: null });
                            }
                        }
                    }
                };

                collectSubQuery(this.mainTags);
                collectSubQuery(this.extraTags);

                // Sort artist groups by count descending, with A-Z fallback
                prefixArtists.sort((a, b) => (b.tag.count || 0) !== (a.tag.count || 0) ? (b.tag.count || 0) - (a.tag.count || 0) : a.tag.name.localeCompare(b.tag.name));
                containsArtists.sort((a, b) => (b.tag.count || 0) !== (a.tag.count || 0) ? (b.tag.count || 0) - (a.tag.count || 0) : a.tag.name.localeCompare(b.tag.name));

                // Non-artist groups maintain standard A-Z order
                prefixOthers.sort((a, b) => a.tag.name.localeCompare(b.tag.name));
                containsOthers.sort((a, b) => a.tag.name.localeCompare(b.tag.name));

                const maxLimit = settingValues.maxSuggestions || 15;

                return [
                    ...prefixArtists.map(item => formatItem(item.tag, true, item.alias)),
                    ...prefixOthers.map(item => formatItem(item.tag, false, item.alias)),
                    ...containsArtists.map(item => formatItem(item.tag, true, item.alias)),
                    ...containsOthers.map(item => formatItem(item.tag, false, item.alias))
                ].slice(0, maxLimit);
            }
        }

        const intSettings = getEffectiveIntegrationsSettings();

        // 1. Explicit LoRA Search Mode (<lora:name)
        if (qLower.startsWith("<lora:") && intSettings.enableModels) {
            const sub = qLower.substring(6).split(":")[0].trim().toLowerCase();

            // Track activation session: sync with LM settings with 500ms timeout
            if (!this.isInsideLoraPrefixSession || (Date.now() - getLastLMSettingsFetchTime() > 5000)) {
                this.isInsideLoraPrefixSession = true;
                if (isLoraManagerAvailable() && (intSettings.loraPathMode === "Auto" || !intSettings.loraPathMode)) {
                    await fetchLMSyntaxFormat(500).catch(() => {});
                }
            }

            const loraPathMode = intSettings.loraPathMode || "Auto";
            const isLMSyntaxFull = (getCachedLMSyntaxFormat() === "full");

            const rawList = this.loras.map(l => {
                const cleanName = getCleanModelName(l);
                const subfolder = extractSubfolderPath(l);
                const insertPath = subfolder ? `${subfolder}/${cleanName}` : cleanName;
                const isDuplicate = this.loraDuplicatesSet ? this.loraDuplicatesSet.has(cleanName.toLowerCase()) : false;

                let shouldInsertPath = false;
                if (loraPathMode === "Full Path") {
                    shouldInsertPath = true;
                } else if (loraPathMode === "Filename Only") {
                    shouldInsertPath = false;
                } else { // "Auto" (Default)
                    if (isLoraManagerAvailable() && isLMSyntaxFull) {
                        shouldInsertPath = true;
                    } else {
                        shouldInsertPath = isDuplicate;
                    }
                }

                const finalInsertName = shouldInsertPath ? insertPath : cleanName;

                return {
                    text: `<lora:${finalInsertName}:1.0>`,
                    display: `<lora:${cleanName}:1.0>`,
                    type: "lora",
                    category: "lora",
                    count: 0,
                    subfolder: subfolder,
                    source: "lora",
                    sourceLabel: "LoRA",
                    cleanName: cleanName,
                    insertPath: insertPath,
                    isDuplicate: isDuplicate,
                    rawPath: l,
                    rawName: l
                };
            });

            // Pinned immediate subfolders at current navigation path (A-Z)
            const folderItems = getLoraFolderSuggestions(this.loras, sub);

            // Unified scoring, A-Z full-path sorting and Favor ranking
            const favorThreshold = settingValues.favorMinCount !== undefined ? settingValues.favorMinCount : 5;
            const favorPool = [];
            const normalPool = [];

            rawList.forEach(item => {
                const scored = scoreAndFilterModelItem(item, sub);
                if (!scored.match) return;

                item.score = scored.score;

                const fullPath = (item.rawPath || item.rawName || item.cleanName || "").replace(/\\/g, "/");
                const userUsage = this.getTagUsage(item.cleanName) || this.getTagUsage(fullPath) || this.getTagUsage(item.text) || 0;
                item.userUsageCount = userUsage;

                if (settingValues.frequencySort && userUsage >= favorThreshold) {
                    item.isFav = true;
                    favorPool.push(item);
                } else {
                    item.isFav = false;
                    normalPool.push(item);
                }
            });

            // 1. Sort Favor pool by score descending, then usage count
            favorPool.sort((a, b) => (b.score !== a.score ? b.score - a.score : b.userUsageCount - a.userUsageCount));
            const topFavors = favorPool.slice(0, 3);
            let rank = 1;
            topFavors.forEach(f => { f.favRank = rank++; });

            if (favorPool.length > 3) {
                normalPool.push(...favorPool.slice(3));
            }

            // 2. Sort normal pool: default to score descending, then strict A-Z by full relative subfolder path
            normalPool.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                const pathA = (a.rawPath || a.rawName || a.cleanName || "").toLowerCase();
                const pathB = (b.rawPath || b.rawName || b.cleanName || "").toLowerCase();
                return pathA.localeCompare(pathB, undefined, { numeric: true, sensitivity: "base" });
            });

            const maxLimit = settingValues.maxSuggestions || 15;
            return folderItems.concat(topFavors).concat(normalPool).slice(0, maxLimit);
        } else {
            this.isInsideLoraPrefixSession = false;
        }

        // 2. Explicit Embedding Search Mode (embedding:name or emb:name)
        if ((qLower.startsWith("embedding:") || qLower.startsWith("emb:")) && intSettings.enableModels) {
            const sub = (qLower.startsWith("embedding:") ? qLower.substring(10) : qLower.substring(4)).split(":")[0].trim().toLowerCase();

            const rawList = this.embeddings.map(e => {
                const cleanPath = String(e).replace(/\\/g, "/").replace(/\.(safetensors|ckpt|pt|bin)$/i, "");
                const baseName = cleanPath.split("/").pop();
                const subfolder = extractSubfolderPath(e);

                return {
                    text: `embedding:${cleanPath}`,
                    display: `embedding:${cleanPath}`,
                    type: "embeddings",
                    category: "embeddings",
                    count: 0,
                    subfolder: subfolder,
                    source: "embeddings",
                    sourceLabel: "EM",
                    cleanName: baseName,
                    rawPath: e
                };
            });

            // Unified scoring, A-Z full-path sorting and Favor ranking for Embeddings
            const favorThreshold = settingValues.favorMinCount !== undefined ? settingValues.favorMinCount : 5;
            const favorPool = [];
            const normalPool = [];

            rawList.forEach(item => {
                const scored = scoreAndFilterModelItem(item, sub);
                if (!scored.match) return;

                item.score = scored.score;

                const fullPath = (item.rawPath || item.cleanName || "").replace(/\\/g, "/");
                const userUsage = this.getTagUsage(item.cleanName) || this.getTagUsage(fullPath) || this.getTagUsage(item.text) || 0;
                item.userUsageCount = userUsage;

                if (settingValues.frequencySort && userUsage >= favorThreshold) {
                    item.isFav = true;
                    favorPool.push(item);
                } else {
                    item.isFav = false;
                    normalPool.push(item);
                }
            });

            // 1. Sort Favor pool by score descending, then usage count
            favorPool.sort((a, b) => (b.score !== a.score ? b.score - a.score : b.userUsageCount - a.userUsageCount));
            const topFavors = favorPool.slice(0, 3);
            let rank = 1;
            topFavors.forEach(f => { f.favRank = rank++; });

            if (favorPool.length > 3) {
                normalPool.push(...favorPool.slice(3));
            }

            // 2. Sort normal pool: default to score descending, then strict A-Z by full relative path
            normalPool.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                const pathA = (a.rawPath || a.cleanName || "").toLowerCase();
                const pathB = (b.rawPath || b.cleanName || "").toLowerCase();
                return pathA.localeCompare(pathB, undefined, { numeric: true, sensitivity: "base" });
            });

            const maxLimit = settingValues.maxSuggestions || 15;
            return topFavors.concat(normalPool.slice(0, maxLimit)).slice(0, maxLimit);
        }

        // 2.5. Explicit LoRA Trigger Word Search Mode (<trigger:...)
        if (isExplicitTriggerMode(query) && intSettings.loraManagerMode !== "Disabled" && isLoraManagerAvailable()) {
            const currentEditingText = this.target ? this.target.value : "";
            const activeLoras = getActiveWorkflowLoras(currentEditingText);
            const sub = extractTriggerKeyword(query);
            const normalizedSub = sub.replace(/ /g, "_").trim().toLowerCase();

            const triggerCandidates = [];
            if (activeLoras.length > 0) {
                const triggerMap = await getLoadedLorasTriggerWords(activeLoras, this.loras, true);
                if (triggerMap && triggerMap.size > 0) {
                    let orderIdx = 0;
                    triggerMap.forEach((entry, tagLower) => {
                        const currentOrder = orderIdx++;
                        let score = 0;
                        if (!normalizedSub) {
                            score = 1000;
                        } else if (tagLower === normalizedSub) {
                            score = 20000000;
                        } else if (tagLower.startsWith(normalizedSub)) {
                            score = 15000000;
                        } else if (tagLower.includes("_" + normalizedSub) || tagLower.includes("-" + normalizedSub) || tagLower.includes("(" + normalizedSub)) {
                            score = 13000000;
                        } else if (tagLower.includes(normalizedSub)) {
                            score = 11000000;
                        }

                        if (score > 0) {
                            triggerCandidates.push({
                                text: entry.tag,
                                display: entry.tag,
                                type: "trigger_word",
                                category: "trigger",
                                count: 0,
                                source: "trigger",
                                sourceLabel: "Trigger",
                                sources: entry.sources,
                                subfolder: formatSourcesShortLabel(entry.sources),
                                score: score,
                                orderIndex: currentOrder,
                                isFav: false,
                                userUsageCount: 0
                            });
                        }
                    });

                    triggerCandidates.sort((a, b) => {
                        if (b.score !== a.score) return b.score - a.score;
                        return (a.orderIndex || 0) - (b.orderIndex || 0);
                    });
                }
            }

            // For explicit trigger mode (<trigger:), bypass standard maxSuggestions setting 
            // so users can see all loaded LoRA trigger words, with a safety hard ceiling of 300
            const TRIGGER_HARD_LIMIT = 300;
            return triggerCandidates.slice(0, TRIGGER_HARD_LIMIT);
        }

        // 3. Wildcard Trigger & Directory Hierarchy
        if (query.startsWith("_")) {
            // Case A: Single "_" or double "__" without path -> Show root items
            if (query === "_" || query === "__") {
                const rootItems = this.getWildcardFolderItems("", "");
                if (rootItems.length > 0) {
                    return rootItems.slice(0, settingValues.maxSuggestions);
                }
            }

            // Clean query inner text (strip leading "__" and optional trailing "__")
            const inner = query.replace(/^__/, "").replace(/__$/, "");

            // Check if inner corresponds to a wildcard file path with a slash (e.g. `samples/jewel/` or `samples/jewel/d`)
            let matchedWildcardFile = null;
            let fileSubQuery = "";

            for (const wc of this.wildcards) {
                if (inner === wc + "/" || inner.startsWith(wc + "/")) {
                    matchedWildcardFile = wc;
                    fileSubQuery = inner.substring(wc.length + 1).toLowerCase();
                    break;
                }
            }

            if (matchedWildcardFile) {
                // Candidate 1: Standard finished wildcard syntax (__path/file__)
                candidates.push({
                    text: `__${matchedWildcardFile}__`,
                    display: `__${matchedWildcardFile}__`,
                    type: "wildcard_syntax_complete",
                    category: "wildcard",
                    count: 0,
                    sourceLabel: "Wildcard",
                    wildcardPath: matchedWildcardFile
                });

                // Candidates 2+: Words inside the wildcard file filtered by subquery
                const lines = await this.fetchWildcardLines(matchedWildcardFile);
                lines.forEach(line => {
                    if (!fileSubQuery || line.toLowerCase().includes(fileSubQuery)) {
                        candidates.push({
                            text: line,
                            display: line,
                            type: "wildcard_item",
                            category: "wildcard",
                            count: 0,
                            sourceLabel: "Wildcard",
                            wildcardPath: matchedWildcardFile
                        });
                    }
                });
                return candidates.slice(0, settingValues.maxSuggestions);
            }

            // Case C: Searching directories / files under current path
            if (query.startsWith("__")) {
                const lastSlash = inner.lastIndexOf("/");
                if (lastSlash !== -1) {
                    const folderPath = inner.substring(0, lastSlash);
                    const filter = inner.substring(lastSlash + 1);

                    const folderItems = this.getWildcardFolderItems(folderPath, filter);
                    if (folderItems.length > 0) {
                        return folderItems.slice(0, settingValues.maxSuggestions);
                    }
                } else {
                    const rootItems = this.getWildcardFolderItems("", inner);
                    if (rootItems.length > 0) {
                        return rootItems.slice(0, settingValues.maxSuggestions);
                    }
                }
            }
        }

        // 4. Multi-Tier Slash Filter (Dictionary & Category Scopes)
        let activeDictFilter = null;
        let activeCatFilter = null;
        let isSlashMode = false;
        let searchKeyword = qLower;
        let slashCategoryList = null;

        if (query.startsWith("/")) {
            isSlashMode = true;
            const fullTrimmed = query.substring(1).trimStart();
            const spaceIndex = fullTrimmed.indexOf(" ");
            const firstToken = (spaceIndex !== -1 ? fullTrimmed.substring(0, spaceIndex) : fullTrimmed).toLowerCase();
            const afterFirst = (spaceIndex !== -1 ? fullTrimmed.substring(spaceIndex + 1) : "");

            // 1. Check if firstToken matches any loaded Dictionary (Exact match)
            const matchedDict = this.loadedDictionaries.find(d =>
                d.normalizedKeys.includes(firstToken) ||
                d.slug.toLowerCase() === firstToken ||
                d.rawBase.toLowerCase() === firstToken
            );

            if (matchedDict) {
                activeDictFilter = matchedDict;
                slashCategoryList = getActiveCategories(matchedDict, this.loadedDictionaries);

                if (afterFirst) {
                    const secondTrimmed = afterFirst.trimStart();
                    const secondSpaceIndex = secondTrimmed.indexOf(" ");
                    const secondToken = (secondSpaceIndex !== -1 ? secondTrimmed.substring(0, secondSpaceIndex) : secondTrimmed).toLowerCase();
                    const subQuery = (secondSpaceIndex !== -1 ? secondTrimmed.substring(secondSpaceIndex + 1) : "");

                    const matchedCat = slashCategoryList.find(c => c.name === secondToken || c.alias.includes(secondToken));
                    if (matchedCat) {
                        activeCatFilter = matchedCat;
                        searchKeyword = subQuery.toLowerCase();
                    } else {
                        searchKeyword = secondTrimmed.toLowerCase();
                    }
                } else {
                    // Exact dictionary token reached without additional query (e.g. "/danbooru" or "/danbooru ")
                    searchKeyword = "";
                }
            } else {
                // 2. Check if firstToken is an exact Category (e.g. "/general" or "/artist" or "/general 1girl")
                slashCategoryList = getActiveCategories(null, this.loadedDictionaries);
                const matchedCat = slashCategoryList.find(c => c.name === firstToken || c.alias.includes(firstToken));

                if (matchedCat) {
                    activeCatFilter = matchedCat;
                    searchKeyword = afterFirst.toLowerCase();
                } else {
                    // 3. Prefix matching in-progress (e.g. "/dan" or "/art" or "/")
                    searchKeyword = (fullTrimmed || "/").toLowerCase();
                }
            }
        }

        // 5. Standard Tag, Alias, and Translation Search (Filtered if dictionary or category filter active)
        const normalizedQuery = searchKeyword.replace(/ /g, "_").replace(/\\/g, "").trim().toLowerCase();
        const rawKeyword = searchKeyword.trim().toLowerCase();
        const isFilterModeOnly = isSlashMode && (activeDictFilter || activeCatFilter) && !normalizedQuery;
        const seen = new Set();

        const processTag = (tagItem, isMainDict = true) => {
            const tagName = tagItem.name;
            const tagNameLower = tagName.toLowerCase();
            const cleanTagNameLower = tagNameLower.replace(/\\/g, "");
            if (seen.has(tagNameLower)) return;

            // Apply dictionary filter if active
            if (activeDictFilter) {
                if (tagItem.sourceFile !== activeDictFilter.filename.toLowerCase()) {
                    return;
                }
            }

            // Apply category filter if active
            if (activeCatFilter) {
                const tagSourceIsE621 = (tagItem.sourceFile || "").includes("e621");

                if (activeCatFilter.targetE621Only && !tagSourceIsE621) {
                    return;
                }

                if (activeCatFilter.isMeta) {
                    if (tagSourceIsE621) {
                        if (tagItem.category !== 7) return;
                    } else {
                        if (tagItem.category !== 5) return;
                    }
                } else {
                    if (!activeCatFilter.catIds.includes(tagItem.category)) {
                        return;
                    }
                }
            }

            let tier = 0; 
            // Tier Hierarchy:
            // 1 = Primary / Translation Exact Match
            // 2 = Primary / Translation Prefix (Head) Match
            // 3 = Alias Exact Match (demoted 1 tier below Primary Head match)
            // 4 = Primary Word Boundary Match (_query, -query, (query)
            // 5 = Alias Prefix / Word Boundary Match
            // 6 = Primary / Translation Substring Fuzzy Match
            // 7 = Alias Substring Fuzzy Match

            let matchedAlias = null;
            let score = 0;

            const tagTrans = this.translations.get(tagNameLower);
            const cleanTrans = (tagTrans && settingValues.searchTranslation) ? tagTrans.toLowerCase().trim() : null;

            const isSingleChar = normalizedQuery.length === 1 && normalizedQuery !== "/";

            if (isFilterModeOnly) {
                // If user just typed "/danbooru", "/danbooru ", or "/artist", show all tags in scope sorted by count
                tier = 1;
                score = tagItem.count || 0;
            } else if (normalizedQuery.length > 0) {
                // 1. Primary Tag & Translation Exact Match (Tier 1)
                if (cleanTagNameLower === normalizedQuery || (cleanTrans && cleanTrans === rawKeyword)) {
                    tier = 1;
                }

                // 2. Primary Tag & Translation Prefix (Head) Match (Tier 2 - StartsWith)
                if (!tier) {
                    if (cleanTagNameLower.startsWith(normalizedQuery) || (cleanTrans && cleanTrans.startsWith(rawKeyword))) {
                        tier = 2;
                    }
                }

                // 3. Alias Exact Match (Tier 3 - Placed below Primary Head/Prefix matches, Translation unaffected)
                if (!tier && tagItem.aliases && tagItem.aliases.length > 0) {
                    for (const al of tagItem.aliases) {
                        const alClean = al.toLowerCase().replace(/\\/g, "");
                        const alTrans = (settingValues.searchTranslation) ? this.translations.get(al.toLowerCase()) : null;
                        const alTransClean = alTrans ? alTrans.toLowerCase().trim() : null;
                        if (alClean === normalizedQuery || (alTransClean && alTransClean === rawKeyword)) {
                            tier = 3;
                            matchedAlias = al;
                            break;
                        }
                    }
                }

                // 4. Primary Tag Word Boundary Match (Tier 4 - e.g. `_query` or `-query` or `(query` in name)
                if (!tier && !isSingleChar) {
                    const isWordBoundary = cleanTagNameLower.includes("_" + normalizedQuery) ||
                                           cleanTagNameLower.includes("-" + normalizedQuery) ||
                                           cleanTagNameLower.includes("(" + normalizedQuery);
                    if (isWordBoundary) {
                        tier = 4;
                    }
                }

                // 5. Alias Prefix & Word Boundary Match (Tier 5 - Head/Prefix always active; Word boundary active for length >= 2)
                if (!tier && tagItem.aliases && tagItem.aliases.length > 0) {
                    for (const al of tagItem.aliases) {
                        const alClean = al.toLowerCase().replace(/\\/g, "");
                        const alTrans = (settingValues.searchTranslation) ? this.translations.get(al.toLowerCase()) : null;
                        const alTransClean = alTrans ? alTrans.toLowerCase().trim() : null;
                        const isAliasPrefix = alClean.startsWith(normalizedQuery) || (alTransClean && alTransClean.startsWith(rawKeyword));
                        const isAliasWordBoundary = !isSingleChar && (
                            alClean.includes("_" + normalizedQuery) ||
                            alClean.includes("-" + normalizedQuery) ||
                            alClean.includes("(" + normalizedQuery)
                        );
                        if (isAliasPrefix || isAliasWordBoundary) {
                            tier = 5;
                            matchedAlias = al;
                            break;
                        }
                    }
                }

                // 6. Primary Tag & Translation Substring Fuzzy Match (Tier 6 - Contains, active for length >= 2)
                if (!tier && !isSingleChar) {
                    if (cleanTagNameLower.includes(normalizedQuery) || (cleanTrans && cleanTrans.includes(rawKeyword))) {
                        tier = 6;
                    }
                }

                // 7. Alias Substring Fuzzy Match (Tier 7 - Contains, active for length >= 2)
                if (!tier && !isSingleChar && tagItem.aliases && tagItem.aliases.length > 0) {
                    for (const al of tagItem.aliases) {
                        const alClean = al.toLowerCase().replace(/\\/g, "");
                        const alTrans = (settingValues.searchTranslation) ? this.translations.get(al.toLowerCase()) : null;
                        const alTransClean = alTrans ? alTrans.toLowerCase().trim() : null;
                        if (alClean.includes(normalizedQuery) || (alTransClean && alTransClean.includes(rawKeyword))) {
                            tier = 7;
                            matchedAlias = al;
                            break;
                        }
                    }
                }
            }

            if (tier > 0) {
                seen.add(tagNameLower);
                const aliasTrans = matchedAlias ? this.translations.get(matchedAlias.toLowerCase()) : null;

                let displayText = tagName;
                if (matchedAlias) {
                    const aliasLabel = aliasTrans && settingValues.showTranslations ? `${matchedAlias} [${aliasTrans}]` : matchedAlias;
                    const tagLabel = tagTrans && settingValues.showTranslations ? `${tagName} [${tagTrans}]` : tagName;
                    displayText = `${aliasLabel} ➝ ${tagLabel}`;
                } else if (tagTrans && settingValues.showTranslations) {
                    displayText = `${tagName} [${tagTrans}]`;
                }

                // Score Calculation
                const userUsage = this.getTagUsage(tagName);
                const isFav = userUsage > 0 && settingValues.frequencySort;

                if (isFilterModeOnly) {
                    score = tagItem.count || 0;
                } else {
                    let tierBase = 0;
                    if (tier === 1) tierBase = 10000000;
                    else if (tier === 2) tierBase = 5000000;
                    else if (tier === 3) tierBase = 3500000;
                    else if (tier === 4) tierBase = 2000000;
                    else if (tier === 5) tierBase = 1200000;
                    else if (tier === 6) tierBase = 500000;
                    else if (tier === 7) tierBase = 300000;

                    // Main Dictionary Priority Bonus (ensures main dictionary ranks higher within every tier)
                    const mainDictBonus = isMainDict ? 100000 : 0;
                    const usageBonus = isFav ? (userUsage * 10000) : 0;
                    const brevityBonus = Math.max(0, 2000 - Math.min(2000, tagName.length * 20));

                    // For artists (Category 1 / /artist), prioritize higher post count (popularity) within each tier
                    const isArtistTag = tagItem.category === 1 || (activeCatFilter && activeCatFilter.name === "artist");
                    const countBonus = isArtistTag
                        ? Math.min(99999, tagItem.count || 0)
                        : Math.min(1000, Math.log10((tagItem.count || 1) + 1) * 100);

                    score = tierBase + mainDictBonus + usageBonus + (isArtistTag ? 0 : brevityBonus) + countBonus;
                }

                candidates.push({
                    text: tagName,
                    display: displayText,
                    category: tagItem.category,
                    count: tagItem.count,
                    sourceFile: tagItem.sourceFile,
                    sourceLabel: tagItem.sourceLabel,
                    matchedAlias: matchedAlias,
                    score: score,
                    isFav: isFav,
                    userUsageCount: userUsage
                });
            }
        };

        for (let i = 0; i < this.mainTags.length; i++) {
            processTag(this.mainTags[i], true);
        }

        for (let i = 0; i < this.extraTags.length; i++) {
            processTag(this.extraTags[i], false);
        }

        const maxLimit = settingValues.maxSuggestions || 15;
        let finalCandidates = [];

        if (settingValues.frequencySort) {
            const favorThreshold = settingValues.favorMinCount !== undefined ? settingValues.favorMinCount : 5;
            const favorPool = candidates.filter(c => c.userUsageCount && c.userUsageCount >= favorThreshold);
            favorPool.sort((a, b) => {
                if (b.userUsageCount !== a.userUsageCount) return b.userUsageCount - a.userUsageCount;
                return b.score - a.score;
            });
            const topFavors = favorPool.slice(0, 3);
            const topFavorsSet = new Set(topFavors);
            let rank = 1;
            for (const f of topFavors) {
                f.isFav = true;
                f.favRank = rank++;
            }
            const rest = [];
            for (const c of candidates) {
                if (!topFavorsSet.has(c)) {
                    c.isFav = false;
                    c.favRank = 0;
                    rest.push(c);
                }
            }
            rest.sort((a, b) => b.score - a.score);
            finalCandidates = topFavors.concat(rest.slice(0, maxLimit));
        } else {
            candidates.sort((a, b) => b.score - a.score);
            finalCandidates = candidates.slice(0, maxLimit);
        }

        // Check for active workflow LoRA trigger words when LoRA Manager integration is enabled
        if (intSettings.loraManagerMode !== "Disabled" && isLoraManagerAvailable() && normalizedQuery.length > 0 && !isSlashMode) {
            try {
                const currentEditingText = this.target ? this.target.value : "";
                const activeLoras = getActiveWorkflowLoras(currentEditingText);

                if (activeLoras.length > 0) {
                    const triggerCandidates = [];
                    const triggerMap = await getLoadedLorasTriggerWords(activeLoras, this.loras);

                    if (triggerMap && triggerMap.size > 0) {
                        triggerMap.forEach((entry, tagLower) => {
                            let score = 0;
                            if (tagLower === normalizedQuery) {
                                score = 20000000;
                            } else if (tagLower.startsWith(normalizedQuery)) {
                                score = 15000000;
                            } else if (tagLower.includes("_" + normalizedQuery) || tagLower.includes("-" + normalizedQuery) || tagLower.includes("(" + normalizedQuery)) {
                                score = 13000000;
                            } else if (tagLower.includes(normalizedQuery)) {
                                score = 11000000;
                            }

                            if (score > 0) {
                                triggerCandidates.push({
                                    text: entry.tag,
                                    display: entry.tag,
                                    type: "trigger_word",
                                    category: "trigger",
                                    count: 0,
                                    source: "trigger",
                                    sourceLabel: "Trigger",
                                    sources: entry.sources,
                                    subfolder: formatSourcesShortLabel(entry.sources),
                                    score: score,
                                    isFav: false,
                                    userUsageCount: 0
                                });
                            }
                        });

                        if (triggerCandidates.length > 0) {
                            triggerCandidates.sort((a, b) => b.score - a.score);
                            // Coexistence Rule: Limit to top 3 trigger words to avoid flooding normal dictionary tags
                            const topTriggers = triggerCandidates.slice(0, 3);
                            finalCandidates = topTriggers.concat(finalCandidates).slice(0, maxLimit);
                        }
                    }
                }
            } catch (err) {
                console.warn("[Autocomplete++] Trigger word injection error:", err);
            }
        }

        // Prepend Shortcuts when typing slash commands:
        if (isSlashMode) {
            const prefixItems = [];
            const rawInner = query.substring(1).trim().toLowerCase();

            if (!activeDictFilter && !activeCatFilter) {
                // Case A: At root slash or partial prefix (e.g. "/", "/dan", "/art")
                
                // 1. Matching Dictionaries:
                for (const d of this.loadedDictionaries) {
                    const dictMatches = !rawInner ||
                        d.prefix.toLowerCase().startsWith(qLower) ||
                        `/${d.slug}`.toLowerCase().startsWith(qLower) ||
                        d.normalizedKeys.some(k => `/${k}`.startsWith(qLower));

                    if (dictMatches) {
                        // 1a. Add the dictionary prefix itself (e.g. "/danbooru ")
                        prefixItems.push({
                            text: d.prefix,
                            display: d.prefix,
                            type: "dict_prefix",
                            count: 0,
                            sourceLabel: "Dictionary"
                        });

                        // If user is typing this dictionary prefix, expand subcategories
                        if (rawInner) {
                            const subCats = getActiveCategories(d, this.loadedDictionaries);
                            for (const sc of subCats) {
                                prefixItems.push({
                                    text: sc.prefix,
                                    display: sc.prefix,
                                    type: "category_prefix",
                                    category: sc.num,
                                    categoryName: sc.name,
                                    count: 0,
                                    sourceLabel: "Category"
                                });
                            }
                        }
                    }
                }

                // 2. Matching Global Categories (e.g. "/general ", "/artist "):
                const catList = slashCategoryList || getActiveCategories(null, this.loadedDictionaries);
                for (const sc of catList) {
                    if (
                        !rawInner ||
                        sc.prefix.toLowerCase().startsWith(qLower) ||
                        `/${sc.name}`.startsWith(qLower) ||
                        sc.alias.some(a => `/${a}`.startsWith(qLower))
                    ) {
                        prefixItems.push({
                            text: sc.prefix,
                            display: sc.prefix,
                            type: "category_prefix",
                            category: sc.num,
                            categoryName: sc.name,
                            count: 0,
                            sourceLabel: "Category"
                        });
                    }
                }
            } else if (activeDictFilter && !activeCatFilter) {
                // Case B: Dictionary is active (e.g. "/danbooru" or "/danbooru " or "/danbooru art")
                const dictCats = slashCategoryList || getActiveCategories(activeDictFilter, this.loadedDictionaries);
                
                for (const sc of dictCats) {
                    const catMatches = !searchKeyword ||
                        sc.name.startsWith(searchKeyword) ||
                        sc.alias.some(a => a.startsWith(searchKeyword)) ||
                        sc.prefix.toLowerCase().startsWith(qLower) ||
                        `/${activeDictFilter.slug} ${sc.name}`.toLowerCase().startsWith(qLower);

                    if (catMatches) {
                        prefixItems.push({
                            text: sc.prefix,
                            display: sc.prefix,
                            type: "category_prefix",
                            category: sc.num,
                            categoryName: sc.name,
                            count: 0,
                            sourceLabel: "Category"
                        });
                    }
                }
            }

            if (prefixItems.length > 0) {
                finalCandidates = prefixItems.concat(finalCandidates);
            }
        }

        // Check active workflow LoRA trigger availability
        let hasActiveTriggers = false;
        if (intSettings.loraManagerMode !== "Disabled" && isLoraManagerAvailable()) {
            try {
                const currentEditingText = this.target ? this.target.value : "";
                const activeLoras = getActiveWorkflowLoras(currentEditingText);
                if (activeLoras.length > 0) {
                    const triggerMap = await getLoadedLorasTriggerWords(activeLoras, this.loras);
                    if (triggerMap && triggerMap.size > 0) {
                        hasActiveTriggers = true;
                    }
                }
            } catch (_) {}
        }

        // Prepend "<trigger:" shortcut if user is typing <t, <tr, <tri, <trig, <trigger, OR if user typed "<" and active triggers exist
        const showTriggerShortcut = isTriggerPrefix(query) && (query !== "<" || hasActiveTriggers) && intSettings.loraManagerMode !== "Disabled" && isLoraManagerAvailable();

        if (showTriggerShortcut) {
            finalCandidates.unshift({
                text: "<trigger:",
                display: "<trigger:",
                type: "trigger_prefix",
                category: "trigger",
                count: 0,
                sourceLabel: "Trigger"
            });
        }

        // Prepend "<lora:" shortcut at index 0 (placed above <trigger:) if query matches LoRA prefix
        if (isLoraPrefix(query) && intSettings.enableModels) {
            finalCandidates.unshift({
                text: "<lora:",
                display: "<lora:",
                type: "lora_prefix",
                category: "lora",
                count: 0,
                sourceLabel: "LoRA"
            });
        }

        // Prepend "embedding:" shortcut at index 0 if user typed "em..."
        if (isEmbeddingTrigger(query) && intSettings.enableModels) {
            finalCandidates.unshift({
                text: "embedding:",
                display: "embedding:",
                type: "embedding_prefix",
                category: "embeddings",
                count: 0,
                source: "embeddings",
                sourceLabel: "EM"
            });
        }

        return finalCandidates.slice(0, maxLimit);
    }

    renderResults() {
        this.hideInfoPopover();
        this.domList.innerHTML = "";
        if (this.results.length === 0) {
            this.hide();
            return;
        }

        this.results.forEach((item, index) => {
            const li = document.createElement("li");
            if (index === this.selectedIndex) {
                li.classList.add("selected");
            }

            const flexDiv = document.createElement("div");
            flexDiv.className = "resultsFlexContainer";

            // Left container: Wiki button / spacer + Tag name / translation
            const leftDiv = document.createElement("div");
            leftDiv.className = "acItemLeft";

            const isSpecialType = item.type === "lora" || item.type === "lora_prefix" || item.type === "lora_dir" || item.type === "embeddings" || item.type === "embedding_prefix" || item.type === "wildcard" || item.type === "wildcard_dir" || item.type === "wildcard_file_step" || item.type === "wildcard_syntax_complete" || item.type === "wildcard_item" || item.type === "category_prefix" || item.type === "dict_prefix" || item.type === "trigger_word" || item.type === "trigger_prefix";

            let catClass = "ac-cat-general";
            if (item.type === "trigger_word" || item.type === "trigger_prefix" || item.category === "trigger") catClass = "ac-cat-trigger";
            else if (item.type === "lora" || item.type === "lora_prefix" || item.type === "lora_dir") catClass = "ac-cat-lora";
            else if (item.type === "embeddings" || item.type === "embedding_prefix") catClass = "ac-cat-embedding";
            else if (item.type && item.type.startsWith("wildcard")) catClass = "ac-cat-wildcard";
            else if (item.type === "dict_prefix") catClass = "ac-cat-dict";
            else if (item.type === "category_prefix") catClass = `ac-cat-${item.categoryName || "general"}`;
            else {
                const cats = (item.sourceFile || "").includes("e621") ? E621_CATEGORIES : DANBOORU_CATEGORIES;
                const catName = cats[item.category] || "general";
                catClass = `ac-cat-${catName}`;
            }

            // 1. Wiki Button or Info Button or Alignment Placeholder
            if (!isSpecialType) {
                const sourceFileLower = (item.sourceFile || "").toLowerCase();
                const isDanbooru = sourceFileLower.includes("danbooru");
                const isE621 = sourceFileLower.includes("e621");

                if (settingValues.showWikiLinks && (isDanbooru || isE621)) {
                    const wikiBtn = document.createElement("a");
                    wikiBtn.className = "ac-wiki-btn";
                    wikiBtn.textContent = "wiki";
                    wikiBtn.title = isE621 ? "Open e621 Wiki Page" : "Open Danbooru Wiki Page";

                    const wikiUrl = isE621
                        ? `https://e621.net/wiki_pages/${encodeURIComponent(item.text)}`
                        : `https://danbooru.donmai.us/wiki_pages/${encodeURIComponent(item.text)}`;

                    wikiBtn.href = wikiUrl;
                    wikiBtn.target = "_blank";

                    const handleWikiAction = (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        window.open(wikiUrl, "_blank");
                    };
                    wikiBtn.addEventListener("pointerdown", handleWikiAction);
                    wikiBtn.addEventListener("mousedown", handleWikiAction);

                    leftDiv.appendChild(wikiBtn);
                } else {
                    const placeholder = document.createElement("span");
                    placeholder.className = "ac-wiki-placeholder";
                    leftDiv.appendChild(placeholder);
                }
            } else if (item.type === "trigger_word") {
                const allSources = Array.isArray(item.sources) ? item.sources.filter(Boolean) : [];
                if (allSources.length > 0) {
                    const isMulti = allSources.length > 1;
                    const single = allSources[0];
                    const hasExternalLink = Boolean(single && (single.civitaiUrl || single.hfUrl));

                    const infoBtn = document.createElement("a");
                    infoBtn.className = "ac-wiki-btn ac-info-btn";
                    infoBtn.textContent = "INFO";
                    infoBtn.href = "javascript:void(0);";
                    infoBtn.title = isMulti
                        ? `Open Model Details (${allSources.length} models available - click to select)`
                        : `Open Model Details (${single.cleanName || single.loraPath || "LoRA"})`;

                    const handleAction = (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (isMulti || hasExternalLink) {
                            this.showInfoPopover(allSources, infoBtn);
                        } else {
                            openLoraInfoModal(single);
                        }
                    };

                    infoBtn.addEventListener("pointerdown", handleAction);
                    infoBtn.addEventListener("mousedown", handleAction);
                    infoBtn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                    });

                    leftDiv.appendChild(infoBtn);
                } else {
                    const placeholder = document.createElement("span");
                    placeholder.className = "ac-wiki-placeholder";
                    leftDiv.appendChild(placeholder);
                }
            }

            // 2. Tag Item Text
            const textDiv = document.createElement("div");
            textDiv.className = `acListItem ${catClass}`;

            let htmlContent = escapeHTML(item.display);
            if (this.currentTagword && item.type !== "embedding_prefix" && item.type !== "lora_prefix" && item.type !== "category_prefix" && item.type !== "dict_prefix") {
                if (item.type === "lora_dir") {
                    // For folder items: only highlight the matched folder query within the folder name, never the <lora: prefix
                    const rawFolderSub = this.currentTagword.replace(/^<lora:/i, "").trim();
                    const lastSlash = rawFolderSub.lastIndexOf("/");
                    const folderQuery = (lastSlash !== -1 ? rawFolderSub.substring(lastSlash + 1) : rawFolderSub).trim();
                    const escapedDisplay = escapeHTML(item.display);
                    if (folderQuery) {
                        const escapedQuery = escapeHTML(folderQuery);
                        const reg = new RegExp(escapedQuery.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
                        const prefix = escapedDisplay.startsWith("&lt;lora:") ? "&lt;lora:" : "";
                        const pathPart = escapedDisplay.substring(prefix.length);
                        htmlContent = prefix + pathPart.replace(reg, (match) => `<b>${match}</b>`);
                    } else {
                        htmlContent = escapedDisplay;
                    }
                } else {
                    const escapedTagword = escapeHTML(this.currentTagword);
                    const reg = new RegExp(escapedTagword.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
                    htmlContent = htmlContent.replace(reg, (match) => `<b>${match}</b>`);
                }
            }
            textDiv.innerHTML = htmlContent;
            leftDiv.appendChild(textDiv);

            flexDiv.appendChild(leftDiv);

            // Right container: count/subfolder and origin badge
            const rightDiv = document.createElement("div");
            rightDiv.className = "acItemRight";

            if (item.count > 0) {
                const metaDiv = document.createElement("div");
                metaDiv.className = "acMetaText";
                metaDiv.textContent = formatCount(item.count);
                rightDiv.appendChild(metaDiv);
            } else if (item.subfolder) {
                const subfolderDiv = document.createElement("div");
                subfolderDiv.className = "acMetaText";
                subfolderDiv.textContent = item.subfolder;
                subfolderDiv.title = `Path: ${item.subfolder}`;
                rightDiv.appendChild(subfolderDiv);
            }

            // Frequent tag badge (Favor)
            if (item.isFav) {
                const favBadge = document.createElement("span");
                const rankClass = item.favRank ? `ac-badge-fav-${item.favRank}` : "ac-badge-fav-1";
                favBadge.className = `ac-origin-badge ${rankClass}`;
                favBadge.textContent = "Favor";
                favBadge.title = `Frequently used by you (${item.userUsageCount} times, Rank #${item.favRank || 1})`;
                rightDiv.appendChild(favBadge);
            }

            // 2. Source origin badge (pinned to the right edge)
            if (item.sourceLabel) {
                const originBadge = document.createElement("span");
                originBadge.className = "ac-origin-badge";

                let badgeTypeClass = "ac-badge-tag";
                if (item.type === "dict_prefix" || item.sourceLabel === "Dictionary") badgeTypeClass = "ac-badge-dict";
                else if (item.type === "category_prefix" || item.sourceLabel === "Category") badgeTypeClass = "ac-badge-cat";
                else if (item.sourceLabel === "LoRA" || item.type === "lora_dir") badgeTypeClass = "ac-badge-lora";
                else if (item.sourceLabel === "Trigger" || item.type === "trigger_word") badgeTypeClass = "ac-badge-trigger";
                else if (item.sourceLabel === "EM") badgeTypeClass = "ac-badge-em";
                else if (item.sourceLabel === "Wildcard") badgeTypeClass = "ac-badge-wc";
                else if (item.sourceLabel === "Filter") badgeTypeClass = "ac-badge-cat";
                else badgeTypeClass = "ac-badge-tag";

                originBadge.classList.add(badgeTypeClass);
                originBadge.textContent = item.sourceLabel;
                originBadge.title = `Origin: ${item.sourceLabel}`;
                rightDiv.appendChild(originBadge);
            }

            flexDiv.appendChild(rightDiv);
            li.appendChild(flexDiv);

            // Mouse move to select when mouse physically moves over the item
            li.addEventListener("mousemove", (e) => {
                if (this.checkMouseUnlock(e.clientX, e.clientY)) {
                    if (this.selectedIndex !== index) {
                        this.selectedIndex = index;
                        this.updateSelection();
                    }
                }
            });

            // Mouse enter to select (safely ignored if under keyboard navigation lock or micro-jitter)
            li.addEventListener("mouseenter", (e) => {
                if (this.checkMouseUnlock(e.clientX, e.clientY)) {
                    if (this.selectedIndex !== index) {
                        this.selectedIndex = index;
                        this.updateSelection();
                    }
                }
            });

            // Handle item selection on click
            const handleItemSelect = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.unlockMouseHover();
                this.selectedIndex = index;
                this.insertTag(item);
            };

            li.addEventListener("pointerdown", handleItemSelect);
            li.addEventListener("mousedown", handleItemSelect);
            li.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
            });

            this.domList.appendChild(li);
        });

        this.updatePosition();
        this.show();
        this.updateSelection();

        // Lightly pre-warm LM model info for top visible LoRA candidates
        const intSettings = getEffectiveIntegrationsSettings();
        if (intSettings.loraManagerMode !== "Disabled" && isLoraManagerAvailable()) {
            const topLoras = this.results.slice(0, 4).filter(r => r.type === "lora");
            topLoras.forEach(item => {
                const targetKey = item.rawPath || item.cleanName;
                if (targetKey && !modelInfoCache.has(targetKey)) {
                    fetchLoraModelInfo(targetKey).catch(() => {});
                }
            });
        }
    }

    lockMouseHover() {
        this.ignoreMouseHover = true;
        this.lockAnchorX = this.currentMouseX;
        this.lockAnchorY = this.currentMouseY;
    }

    unlockMouseHover() {
        this.ignoreMouseHover = false;
        this.lockAnchorX = -1;
        this.lockAnchorY = -1;
    }

    checkMouseUnlock(x, y) {
        this.currentMouseX = x;
        this.currentMouseY = y;
        if (!this.ignoreMouseHover) return true;
        if (this.lockAnchorX === -1 || this.lockAnchorY === -1) {
            this.unlockMouseHover();
            return true;
        }
        const distSq = (x - this.lockAnchorX) ** 2 + (y - this.lockAnchorY) ** 2;
        if (distSq >= 16) { // 4px Euclidean distance threshold from lock anchor
            this.unlockMouseHover();
            return true;
        }
        return false;
    }

    updateCompoundGridFlow(isFlippedRight, customR) {
        if (!this.compoundContainer) return;
        const allCards = Array.from(this.compoundContainer.children);
        const totalRendered = allCards.length;
        if (totalRendered === 0) return;
        const R = customR || Math.max(1, Math.ceil(totalRendered / 2));

        allCards.forEach((cardEl, idx) => {
            const k = idx + 1; // 1-indexed: Card 1 is the primary author set
            if (!isFlippedRight) {
                // Normal (Left of dropdown): Inner column is Column 2 (Right Col), Outer is Column 1 (Left Col)
                if (k <= R) {
                    cardEl.style.gridColumn = "2";
                    cardEl.style.gridRow = `${R - k + 1}`;
                } else {
                    cardEl.style.gridColumn = "1";
                    cardEl.style.gridRow = `${k - R}`;
                }
            } else {
                // Flipped (Right of dropdown): Inner column is Column 1 (Left Col), Outer is Column 2 (Right Col)
                if (k <= R) {
                    cardEl.style.gridColumn = "1";
                    cardEl.style.gridRow = `${R - k + 1}`;
                } else {
                    cardEl.style.gridColumn = "2";
                    cardEl.style.gridRow = `${k - R}`;
                }
            }
        });
    }

    positionLoraPreviewCard() {
        if (!this.loraPreviewCard || !this.domContainer) return;
        const rect = this.domContainer.getBoundingClientRect();
        if (rect.width === 0) return;

        const cardRect = this.loraPreviewCard.getBoundingClientRect();
        const cardWidth = cardRect.width > 0 ? cardRect.width : 275;
        const cardHeight = cardRect.height > 0 ? cardRect.height : 391;
        const cardMargin = 10;
        const screenMargin = 10;

        const spaceLeft = Math.max(0, rect.left - cardMargin - screenMargin);
        const spaceRight = Math.max(0, window.innerWidth - rect.right - cardMargin - screenMargin);

        // Determine orientation based on user preference and available space
        const isPreferredRight = settingValues.previewPosition === "Right";
        let isFlippedRight = false;

        if (!isPreferredRight) {
            // "Left" preference (Default): Stay on LEFT unless left space is less than cardWidth AND right has more space
            if (spaceLeft < cardWidth && spaceRight > spaceLeft) {
                isFlippedRight = true;
            }
        } else {
            // "Right" preference: Keep on right unless left has more space and right space is insufficient
            isFlippedRight = true;
            if (spaceRight < cardWidth && spaceLeft > spaceRight) {
                isFlippedRight = false;
            }
        }

        let left;
        if (!isFlippedRight) {
            // Left orientation: Position to the left of dropdown
            left = (rect.left - cardMargin) - cardWidth;
        } else {
            // Right orientation: Position to the right of dropdown
            left = rect.right + cardMargin;
        }

        let top = rect.top;
        if (top + cardHeight > window.innerHeight - 10) {
            top = Math.max(10, window.innerHeight - cardHeight - 10);
        }

        if (typeof this.loraPreviewCard.style.setProperty === "function") {
            this.loraPreviewCard.style.setProperty("top", `${top}px`, "important");
            this.loraPreviewCard.style.setProperty("left", `${left}px`, "important");
        } else {
            this.loraPreviewCard.style.top = `${top}px`;
            this.loraPreviewCard.style.left = `${left}px`;
        }
    }

    positionTriggerPreview() {
        if (!this.triggerPreviewCard || !this.domContainer) return;
        const rect = this.domContainer.getBoundingClientRect();
        if (rect.width === 0) return;

        const numSources = this.triggerPreviewCard.querySelectorAll(".acTriggerCol").length || 1;
        const cardMargin = 10;
        const screenMargin = 10;
        const availHeight = window.innerHeight - 30;

        // 1. Calculate natural width dynamically based on column count (including all 12px column paddings)
        let baseNaturalWidth = 264;
        let minFiftyPercentWidth = 140;

        if (numSources === 1) {
            baseNaturalWidth = 264; // 250px column + 14px outer card padding/border = 264px
            minFiftyPercentWidth = 140;
        } else if (numSources === 2) {
            baseNaturalWidth = 522; // 2 * 250px columns + 8px gap + 14px padding/border = 522px
            minFiftyPercentWidth = 260; // 2 * 120px + 8px + 12px = 260px
        } else if (numSources === 3) {
            baseNaturalWidth = 628; // 3 * 200px columns + 16px gap + 12px padding = 628px
            minFiftyPercentWidth = 380;
        } else {
            baseNaturalWidth = Math.min(640, numSources * 180 + (numSources - 1) * 8 + 12);
            minFiftyPercentWidth = Math.min(640, numSources * 110 + (numSources - 1) * 8 + 12);
        }

        // 2. Measure available space on left vs right of the dropdown candidate list (preserving 10px screen edge margin)
        const spaceLeft = Math.max(0, rect.left - cardMargin - screenMargin);
        const spaceRight = Math.max(0, window.innerWidth - rect.right - cardMargin - screenMargin);

        // Determine orientation: Stay on preferred side unless space is less than 50% min-width AND other side has more space
        const isTriggerPreferredRight = settingValues.previewPosition === "Right";
        let isFlippedRight = false;

        if (!isTriggerPreferredRight) {
            // "Left" preference: Place on left unless insufficient space and right side has more
            if (spaceLeft < minFiftyPercentWidth && spaceRight > spaceLeft) {
                isFlippedRight = true;
            }
        } else {
            // "Right" preference: Place on right unless insufficient space and left side has more
            isFlippedRight = true;
            if (spaceRight < minFiftyPercentWidth && spaceLeft > spaceRight) {
                isFlippedRight = false;
            }
        }

        const maxAvailableWidth = isFlippedRight ? spaceRight : spaceLeft;
        let targetWidth = Math.max(minFiftyPercentWidth, Math.min(baseNaturalWidth, maxAvailableWidth));

        // Apply width to triggerPreviewCard with high priority
        if (typeof this.triggerPreviewCard.style.setProperty === "function") {
            this.triggerPreviewCard.style.setProperty("width", `${targetWidth}px`, "important");
        } else {
            this.triggerPreviewCard.style.width = `${targetWidth}px`;
        }

        let cardWidth = targetWidth;

        // Calculate deterministic cardHeight based on 2:3 aspect ratio on each column
        const colOuterWidth = numSources > 1 ? (targetWidth - (numSources - 1) * 8 - 14) / numSources : (targetWidth - 14);
        const colInnerWidth = Math.max(90, colOuterWidth - 14); // - 12px column padding - 2px borders
        const expectedImgHeight = colInnerWidth * 1.5;
        let cardHeight = expectedImgHeight + 58; // + 2-line text name (25px) + 24px outer/col paddings + 5px gap + 4px borders

        const isCompoundVisible = this.compoundContainer && this.compoundContainer.style.display === "flex";
        let compoundHeight = 0;
        let compWidth = cardWidth;
        const maxScreenBudget = window.innerHeight - 20;

        if (isCompoundVisible) {
            // Restore compound preset entries for row expansion
            if (this.currentCompoundEntries && this.currentCompoundEntries.length > 0) {
                const fullExpectedCards = this.currentCompoundEntries.length > 10 ? 10 : this.currentCompoundEntries.length;
                if (this.compoundContainer.children.length !== fullExpectedCards) {
                    this.renderCompoundCards(this.currentCompoundEntries, 5, isFlippedRight);
                }
            }

            this.compoundContainer.classList.remove("compact-clamp");
            if (typeof this.compoundContainer.style.removeProperty === "function") {
                this.compoundContainer.style.removeProperty("--ac-compound-max-height");
            } else if (this.compoundContainer.style) {
                delete this.compoundContainer.style["--ac-compound-max-height"];
            }

            const numCards = this.compoundContainer.children.length;
            const totalProjectedHeight = numCards * 70 + cardHeight;
            const isTwoCol = (numCards >= 4 && (totalProjectedHeight > availHeight * 0.7)) ||
                             (numCards >= 3 && (totalProjectedHeight > availHeight));

            if (isTwoCol) {
                this.compoundContainer.classList.add("two-col");
                if (numSources <= 1) {
                    compWidth = cardWidth * 2 + 8;
                } else {
                    compWidth = cardWidth;
                }
            } else {
                this.compoundContainer.classList.remove("two-col");
                compWidth = cardWidth;
            }

            if (typeof this.compoundContainer.style.setProperty === "function") {
                this.compoundContainer.style.setProperty("width", `${compWidth}px`, "important");
            } else {
                this.compoundContainer.style.width = `${compWidth}px`;
            }

            // Trigger layout reflow
            void this.compoundContainer.offsetHeight;

            // Read DOM layout height
            compoundHeight = this.compoundContainer.offsetHeight || this.compoundContainer.scrollHeight || 0;

            let currentTotalHeight = compoundHeight + 10 + cardHeight;

            // Stage 1: Prompt text compression
            if (currentTotalHeight > maxScreenBudget) {
                const numRows = isTwoCol ? Math.ceil(numCards / 2) : numCards;
                const deltaH = currentTotalHeight - maxScreenBudget;
                // Gradually compress text max-height down to minimum 44px (3 lines)
                const targetTextHeight = Math.max(44, Math.min(100, 100 - Math.ceil(deltaH / numRows)));
                if (typeof this.compoundContainer.style.setProperty === "function") {
                    this.compoundContainer.style.setProperty("--ac-compound-max-height", `${targetTextHeight}px`);
                } else if (this.compoundContainer.style) {
                    this.compoundContainer.style["--ac-compound-max-height"] = `${targetTextHeight}px`;
                }
                this.compoundContainer.classList.add("compact-clamp");

                void this.compoundContainer.offsetHeight;
                compoundHeight = this.compoundContainer.offsetHeight || this.compoundContainer.scrollHeight || 0;
                currentTotalHeight = compoundHeight + 10 + cardHeight;
            }

            // Stage 2: Scaling of image card and compound width
            if (currentTotalHeight > maxScreenBudget) {
                const minScaleFloorWidth = minFiftyPercentWidth; // Unify with horizontal physical minimum floor
                const maxImgCardHeight = Math.max(80, maxScreenBudget - compoundHeight - 10);
                const maxImgHeight = Math.max(30, maxImgCardHeight - 58);
                const scaledColInnerWidth = Math.max(20, maxImgHeight / 1.5);
                const scaledColOuterWidth = scaledColInnerWidth + 12;
                const scaledWidth = numSources > 1 ? (numSources * scaledColOuterWidth + (numSources - 1) * 8 + 12) : (scaledColOuterWidth + 12);

                targetWidth = Math.min(targetWidth, Math.max(minScaleFloorWidth, scaledWidth));
                cardWidth = targetWidth;

                const finalColOuterWidth = numSources > 1 ? (targetWidth - (numSources - 1) * 8 - 12) / numSources : (targetWidth - 12);
                const finalColInnerWidth = Math.max(20, finalColOuterWidth - 12);
                cardHeight = finalColInnerWidth * 1.5 + 58;

                if (isTwoCol) {
                    compWidth = (numSources <= 1) ? (cardWidth * 2 + 8) : cardWidth;
                } else {
                    compWidth = cardWidth;
                }

                if (typeof this.compoundContainer.style.setProperty === "function") {
                    this.compoundContainer.style.setProperty("width", `${compWidth}px`, "important");
                } else {
                    this.compoundContainer.style.width = `${compWidth}px`;
                }
                if (typeof this.triggerPreviewCard.style.setProperty === "function") {
                    this.triggerPreviewCard.style.setProperty("width", `${cardWidth}px`, "important");
                } else {
                    this.triggerPreviewCard.style.width = `${cardWidth}px`;
                }

                void this.compoundContainer.offsetHeight;
                compoundHeight = this.compoundContainer.offsetHeight || this.compoundContainer.scrollHeight || 0;
                currentTotalHeight = compoundHeight + 10 + cardHeight;

                // Stage 3: Dynamic row reduction
                if (this.currentCompoundEntries && this.currentCompoundEntries.length > 0 && currentTotalHeight > maxScreenBudget) {
                    let currentRows = isTwoCol ? Math.max(1, Math.ceil(this.compoundContainer.children.length / 2)) : this.compoundContainer.children.length;
                    let targetRows = currentRows;

                    while (targetRows > 1 && currentTotalHeight > maxScreenBudget) {
                        targetRows--;
                        this.renderCompoundCards(this.currentCompoundEntries, targetRows, isFlippedRight);

                        this.compoundContainer.classList.add("compact-clamp");
                        if (typeof this.compoundContainer.style.setProperty === "function") {
                            this.compoundContainer.style.setProperty("--ac-compound-max-height", `44px`);
                            this.compoundContainer.style.setProperty("width", `${compWidth}px`, "important");
                        } else if (this.compoundContainer.style) {
                            this.compoundContainer.style["--ac-compound-max-height"] = `44px`;
                            this.compoundContainer.style.width = `${compWidth}px`;
                        }

                        void this.compoundContainer.offsetHeight;
                        compoundHeight = this.compoundContainer.offsetHeight || this.compoundContainer.scrollHeight || 0;
                        currentTotalHeight = compoundHeight + 10 + cardHeight;
                    }
                }
            }
        } else {
            // Image-only mode vertical adaptation (down to 50% Floor)
            if (cardHeight > maxScreenBudget) {
                const minScaleFloorWidth = minFiftyPercentWidth;
                const maxImgHeight = Math.max(30, maxScreenBudget - 58);
                const scaledColInnerWidth = Math.max(20, maxImgHeight / 1.5);
                const scaledColOuterWidth = scaledColInnerWidth + 12;
                const scaledWidth = numSources > 1 ? (numSources * scaledColOuterWidth + (numSources - 1) * 8 + 12) : (scaledColOuterWidth + 12);

                targetWidth = Math.min(targetWidth, Math.max(minScaleFloorWidth, scaledWidth));
                cardWidth = targetWidth;

                const finalColOuterWidth = numSources > 1 ? (targetWidth - (numSources - 1) * 8 - 12) / numSources : (targetWidth - 12);
                const finalColInnerWidth = Math.max(20, finalColOuterWidth - 12);
                cardHeight = finalColInnerWidth * 1.5 + 58;

                if (typeof this.triggerPreviewCard.style.setProperty === "function") {
                    this.triggerPreviewCard.style.setProperty("width", `${cardWidth}px`, "important");
                } else {
                    this.triggerPreviewCard.style.width = `${cardWidth}px`;
                }
            }
        }

        // Calculate horizontal positions
        let left;
        const maxSpanWidth = Math.max(cardWidth, compWidth);

        if (!isFlippedRight) {
            // Left orientation: Align to left side of dropdown
            left = (rect.left - cardMargin) - maxSpanWidth;
        } else {
            // Right orientation: Align to right side of dropdown
            left = rect.right + cardMargin;
        }

        // Dynamically update Inverted U-Shape layout coordinates based on orientation
        if (isCompoundVisible) {
            this.updateCompoundGridFlow(isFlippedRight);
        }

        let compoundLeft = left;
        let previewLeft = left;

        // In left-hand layout, if compound cards are wider than preview card, align preview card flush to dropdown
        if (!isFlippedRight && compWidth > cardWidth) {
            previewLeft = left + (compWidth - cardWidth);
        }

        // Read layout heights after reflow
        if (isCompoundVisible) void this.compoundContainer.offsetHeight;
        void this.triggerPreviewCard.offsetHeight;

        const finalCompoundHeight = isCompoundVisible ? (this.compoundContainer.offsetHeight || this.compoundContainer.scrollHeight || 0) : 0;
        const finalCardHeight = this.triggerPreviewCard.offsetHeight || this.triggerPreviewCard.scrollHeight || cardHeight;

        // Calculate vertical position with real-time DOM heights (10px gap between compound and preview)
        const totalHeight = isCompoundVisible ? (finalCompoundHeight + 10 + finalCardHeight) : finalCardHeight;
        let top = rect.top;

        // Vertical screen boundary clamping (lift upwards so full stack remains cleanly in viewport with 10px bottom margin)
        if (top + totalHeight > window.innerHeight - 10) {
            top = Math.max(10, window.innerHeight - totalHeight - 10);
        }

        if (isCompoundVisible) {
            if (typeof this.compoundContainer.style.setProperty === "function") {
                this.compoundContainer.style.setProperty("top", `${top}px`, "important");
                this.compoundContainer.style.setProperty("left", `${compoundLeft}px`, "important");
            } else {
                this.compoundContainer.style.top = `${top}px`;
                this.compoundContainer.style.left = `${compoundLeft}px`;
            }
            if (typeof this.triggerPreviewCard.style.setProperty === "function") {
                this.triggerPreviewCard.style.setProperty("top", `${top + finalCompoundHeight + 10}px`, "important");
                this.triggerPreviewCard.style.setProperty("left", `${previewLeft}px`, "important");
            } else {
                this.triggerPreviewCard.style.top = `${top + finalCompoundHeight + 10}px`;
                this.triggerPreviewCard.style.left = `${previewLeft}px`;
            }
        } else {
            if (typeof this.triggerPreviewCard.style.setProperty === "function") {
                this.triggerPreviewCard.style.setProperty("top", `${top}px`, "important");
                this.triggerPreviewCard.style.setProperty("left", `${previewLeft}px`, "important");
            } else {
                this.triggerPreviewCard.style.top = `${top}px`;
                this.triggerPreviewCard.style.left = `${previewLeft}px`;
            }
        }
    }

    positionPreviewCard() {
        if (this.triggerPreviewCard && this.triggerPreviewCard.style.display === "flex") {
            this.positionTriggerPreview();
        } else if (this.loraPreviewCard && this.loraPreviewCard.style.display === "flex") {
            this.positionLoraPreviewCard();
        }
    }

    showThumbnailPreview(item) {
        this.detectThemeLuminance();
        if (settingValues.previewPosition === "Disabled" || !item || (item.type !== "lora" && item.type !== "embeddings" && item.type !== "trigger_word")) {
            this.hideThumbnailPreview();
            return;
        }

        if (this.compoundContainer && item.type !== "trigger_word") {
            this.compoundContainer.style.display = "none";
            this.compoundContainer.innerHTML = "";
        }

        if (item.type === "trigger_word") {
            this.showTriggerPreview(item);
            return;
        }

        const rawPath = item.rawPath || item.rawName || "";
        const cleanName = item.cleanName || (item.text || "")
            .replace(/^<lora:/i, "")
            .replace(/:[0-9.]+>$/i, "")
            .replace(/>$/i, "")
            .replace(/^embedding:/i, "")
            .trim();

        if (!cleanName && !rawPath) {
            this.hideThumbnailPreview();
            return;
        }

        if (this.triggerPreviewCard) this.triggerPreviewCard.style.display = "none";
        if (this.compoundContainer) this.compoundContainer.style.display = "none";

        const cacheKey = `${item.type}:${rawPath || cleanName}`;
        const cachedThumb = modelThumbStatusCache.get(cacheKey);

        // Fast-path 1: Known to have no thumbnail -> render placeholder directly
        if (cachedThumb === "none") {
            renderLoraCard(PLACEHOLDER_IMG_URL);
            return;
        }

        const intSettings = getEffectiveIntegrationsSettings();
        const isLMActive = intSettings.loraManagerMode !== "Disabled" && isLoraManagerAvailable() && item.type === "lora";

        async function renderLoraCard(imgUrl) {
            if (!this.isVisible || this.results[this.selectedIndex] !== item) return;

            const targetKey = cleanName || rawPath;
            if (this.currentPreviewUrl === imgUrl && this.currentPreviewTitle === targetKey && this.loraPreviewCard && this.loraPreviewCard.style.display === "flex") {
                this.positionLoraPreviewCard();
                return;
            }

            // Pre-render Queue: Wait for BOTH image decoding and (if LM is active) model info in parallel
            const imgLoadPromise = new Promise((resolve) => {
                const img = new Image();
                img.onload = () => resolve({ ok: true, img });
                img.onerror = () => resolve({ ok: false, img });
                img.src = imgUrl;
            });

            const infoPromise = isLMActive 
                ? fetchLoraModelInfo(targetKey).catch(() => null)
                : Promise.resolve(null);

            const [imgResult, loraInfo] = await Promise.all([imgLoadPromise, infoPromise]);

            if (!this.isVisible || this.results[this.selectedIndex] !== item) return;

            if (!imgResult.ok && imgUrl !== PLACEHOLDER_IMG_URL) {
                renderLoraCard.call(this, PLACEHOLDER_IMG_URL);
                return;
            }

            this.loraPreviewCard.innerHTML = "";

            const thumbContainer = document.createElement("div");
            thumbContainer.className = "acPreviewThumbContainer";

            const cached = loraInfo || modelInfoCache.get(targetKey) || modelInfoCache.get(cleanName) || modelInfoCache.get(rawPath);

            if (isLMActive) {
                thumbContainer.classList.add("clickable");
                thumbContainer.title = `Click to view "${cleanName || rawPath}" in LoRA Manager`;
                thumbContainer.addEventListener("mousedown", async (e) => {
                    if (e.target.closest(".acThumbBadgeExt")) return;
                    e.stopPropagation();
                    e.preventDefault();
                    let hash = (cached?.sha256 || cached?.rawModel?.sha256 || cached?.rawModel?.hash || "").toLowerCase();
                    const url = hash ? `/autocomplete-plus-plus/open-in-lm?hashes=${encodeURIComponent(hash)}` : "/loras";
                    window.open(url, "_blank");
                });
            }

            this.previewImg = document.createElement("img");
            this.previewImg.className = "acPreviewImg";
            this.previewImg.alt = "Preview";
            this.previewImg.src = imgUrl;
            thumbContainer.appendChild(this.previewImg);

            let badgeStack = null;
            if (isLMActive) {
                const baseModel = cached?.baseModel || "";
                const civitaiUrl = cached?.civitaiUrl || "";
                const hfUrl = cached?.hfUrl || "";
                badgeStack = createThumbBadgeStack({
                    baseModel,
                    civitaiUrl,
                    hfUrl,
                    isLMActive
                });
                if (badgeStack) {
                    thumbContainer.appendChild(badgeStack);
                }
            }

            this.previewTitle = document.createElement("div");
            this.previewTitle.className = "acPreviewTitle";
            this.previewTitle.textContent = cleanName || rawPath;
            this.previewTitle.title = cleanName || rawPath;

            this.loraPreviewCard.appendChild(thumbContainer);
            this.loraPreviewCard.appendChild(this.previewTitle);
            this.currentPreviewUrl = imgUrl;
            this.currentPreviewTitle = targetKey;
            this.loraPreviewCard.style.display = "flex";

            this.positionLoraPreviewCard();
            requestAnimationFrame(() => {
                this.positionLoraPreviewCard();
            });
        }

        // Fast-path 2: Verified image already in cache -> render immediately (preloads and shows)
        if (cachedThumb && cachedThumb !== "none") {
            renderLoraCard.call(this, cachedThumb);
            return;
        }

        // Cache miss: Silent background probe (avoids "no thumbnail" flashing while probe is in flight)
        this.hideThumbnailPreview();

        const typeParam = item.type === "lora" ? "loras" : "embeddings";
        const queryName = rawPath || cleanName;
        const probeUrl = `/autocomplete-plus-plus/models/thumbnail?type=${typeParam}&name=${encodeURIComponent(queryName)}&info=1`;

        (async () => {
            try {
                const res = await fetch(probeUrl).catch(() => null);
                if (res && res.ok) {
                    const data = await res.json().catch(() => null);
                    if (data?.has_thumbnail && data.url) {
                        modelThumbStatusCache.set(cacheKey, data.url);
                        if (this.isVisible && this.results[this.selectedIndex] === item) {
                            renderLoraCard.call(this, data.url);
                        }
                        return;
                    }
                }
            } catch (_) {}

            // Local thumbnail not found. If LM integration is enabled, query LM once via list search
            if (isLMActive) {
                try {
                    const lmPreviewUrl = await fetchLoraManagerPreviewUrl(rawPath, cleanName);
                    if (lmPreviewUrl) {
                        modelThumbStatusCache.set(cacheKey, lmPreviewUrl);
                        if (this.isVisible && this.results[this.selectedIndex] === item) {
                            renderLoraCard.call(this, lmPreviewUrl);
                        }
                        return;
                    }
                } catch (_) {}
            }

            // Both local and LM have no thumbnail: mark as "none" and show placeholder
            modelThumbStatusCache.set(cacheKey, "none");
            if (this.isVisible && this.results[this.selectedIndex] === item) {
                renderLoraCard.call(this, PLACEHOLDER_IMG_URL);
            }
        })();
    }

    renderCompoundCards(compoundEntries, maxRows = 5, isFlippedRight = false) {
        if (!this.compoundContainer) return;
        this.compoundContainer.innerHTML = "";
        if (!compoundEntries || compoundEntries.length === 0) {
            this.compoundContainer.style.display = "none";
            return;
        }

        const totalEntries = compoundEntries.length;
        // In 1-row mode with 1 entry, capacity is 1. Otherwise 2-col capacity is 2 * maxRows.
        const capacity = (maxRows === 1 && totalEntries === 1) ? 1 : (2 * maxRows);
        const isOverLimit = totalEntries > capacity;
        const maxContentCards = isOverLimit ? (capacity - 1) : totalEntries;
        const visibleEntries = compoundEntries.slice(0, maxContentCards);
        const omittedCount = totalEntries - maxContentCards;

        visibleEntries.forEach(entry => {
            const card = document.createElement("div");
            card.className = "acCompoundCard";
            card.title = "Click to insert full prompt set";

            const header = document.createElement("div");
            header.className = "acCompoundHeader";

            const loraName = document.createElement("div");
            loraName.className = "acCompoundLoraName";
            loraName.textContent = entry.cleanName;

            const actionBadge = document.createElement("div");
            actionBadge.className = "acCompoundActionBadge";
            actionBadge.textContent = "Insert Full Set ↵";

            header.appendChild(loraName);
            header.appendChild(actionBadge);

            const body = document.createElement("div");
            body.className = "acCompoundText";
            body.textContent = entry.rawText;

            card.appendChild(header);
            card.appendChild(body);

            card.addEventListener("mousedown", (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.insertRawText(entry.rawText);
            });

            this.compoundContainer.appendChild(card);
        });

        // If over limit, append Red Omission Warning Card in the last slot
        if (isOverLimit) {
            const omittedEntries = compoundEntries.slice(maxContentCards);
            const omittedSourcesMap = new Map();
            omittedEntries.forEach(e => {
                if (e.source) {
                    omittedSourcesMap.set(e.source.loraPath || e.source.cleanName, e.source);
                }
            });
            const omittedValidSources = Array.from(omittedSourcesMap.values());

            const noticeCard = document.createElement("div");
            noticeCard.className = "acCompoundCard acOmittedNoticeCard";

            const inner = document.createElement("div");
            inner.className = "acCardInner";

            // Front face
            const front = document.createElement("div");
            front.className = "acCardFront";

            const title = document.createElement("div");
            title.className = "acOmittedTitle";
            title.textContent = `+${omittedCount} more prompt presets omitted`;

            const sub = document.createElement("div");
            sub.className = "acOmittedSub";
            sub.textContent = "Check Civitai or LoRA Manager for full list";

            const action = document.createElement("div");
            action.className = "acOmittedAction";
            action.textContent = "Click card or press F1 to view Model Details";

            front.appendChild(title);
            front.appendChild(sub);
            front.appendChild(action);

            // Back face (Multi-LoRA selector)
            const back = document.createElement("div");
            back.className = "acCardBack";

            const backTitle = document.createElement("div");
            backTitle.className = "acOmittedBackTitle";
            backTitle.textContent = "SELECT LORA:";
            back.appendChild(backTitle);

            const modelList = document.createElement("div");
            modelList.className = "acOmittedModelList";

            omittedValidSources.forEach((src, idx) => {
                const rawUrl = src.civitaiUrl || src.hfUrl || "";
                const extMeta = getExternalLinkMeta(rawUrl);

                const btnGroup = document.createElement("div");
                btnGroup.className = `acModelBtnGroup ${extMeta ? "has-ext" : "no-ext"}`;

                // 1. Left Primary Button (Open Local LoRA Manager Info Modal)
                const mainBtn = document.createElement("button");
                mainBtn.type = "button";
                mainBtn.className = "acModelBtnMain";
                mainBtn.title = "Open Local Model Info";

                const num = document.createElement("span");
                num.className = "acModelBtnNum";
                num.textContent = `${idx + 1}.`;

                const name = document.createElement("span");
                name.className = "acModelBtnName";
                name.textContent = src.cleanName || src.loraPath || `Model ${idx + 1}`;

                const lmIcon = document.createElement("span");
                lmIcon.className = "acModelBtnLmIcon";
                lmIcon.innerHTML = getLoraManagerIconImg();

                mainBtn.appendChild(num);
                mainBtn.appendChild(name);
                mainBtn.appendChild(lmIcon);

                mainBtn.addEventListener("mousedown", (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    openLoraInfoModal(src);
                });

                btnGroup.appendChild(mainBtn);

                // 2. Right Secondary Button (Open External Civitai / HF Page)
                if (extMeta) {
                    const extBtn = document.createElement("button");
                    extBtn.type = "button";
                    extBtn.className = `acModelBtnExt acExt-${extMeta.type}`;
                    extBtn.title = extMeta.tooltip;
                    extBtn.innerHTML = extMeta.iconImg;

                    extBtn.addEventListener("mousedown", (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        openCivitaiUrl(extMeta.url);
                    });

                    btnGroup.appendChild(extBtn);
                }

                modelList.appendChild(btnGroup);
            });

            back.appendChild(modelList);

            inner.appendChild(front);
            inner.appendChild(back);
            noticeCard.appendChild(inner);

            // Click handler on notice card (outside individual model buttons)
            noticeCard.addEventListener("mousedown", (e) => {
                if (e.target.closest(".acModelBtnGroup")) return;
                if (inner.classList.contains("flipped") && e.target.closest(".acOmittedModelList")) return;

                e.stopPropagation();
                e.preventDefault();

                if (omittedValidSources.length === 1) {
                    const single = omittedValidSources[0];
                    const ext = getExternalLinkMeta(single.civitaiUrl || single.hfUrl);
                    if (ext) openCivitaiUrl(ext.url);
                    else openLoraInfoModal(single);
                } else if (omittedValidSources.length > 1) {
                    inner.classList.toggle("flipped");
                } else {
                    const firstValid = this.currentCompoundEntries && this.currentCompoundEntries.find(e => e.source);
                    if (firstValid && firstValid.source) openLoraInfoModal(firstValid.source);
                }
            });

            this.compoundContainer.appendChild(noticeCard);
        }

        // Configure two-col class
        const numRendered = this.compoundContainer.children.length;
        if (numRendered >= 4 || (maxRows === 1 && numRendered >= 2) || (this.compoundContainer.classList.contains("two-col") && numRendered >= 2)) {
            this.compoundContainer.classList.add("two-col");
        } else if (numRendered < 2) {
            this.compoundContainer.classList.remove("two-col");
        }

        const computedRows = Math.min(maxRows, Math.max(1, Math.ceil(numRendered / 2)));
        this.updateCompoundGridFlow(isFlippedRight, computedRows);
        this.compoundContainer.style.display = "flex";
    }

    showTriggerPreview(item) {
        if (settingValues.previewPosition === "Disabled" || !item || !Array.isArray(item.sources) || item.sources.length === 0) {
            this.hideThumbnailPreview();
            return;
        }

        // 1. Separate Compound Prompt Sets Floating Card (placed above the thumbnail card)
        const compoundEntries = [];
        item.sources.forEach(source => {
            if (Array.isArray(source.compoundBlocks) && source.compoundBlocks.length > 0) {
                source.compoundBlocks.forEach(blockText => {
                    compoundEntries.push({
                        cleanName: source.cleanName || source.loraPath || "LoRA",
                        rawText: blockText,
                        source: source
                    });
                });
            }
        });

        this.currentCompoundEntries = compoundEntries;
        if (this.compoundContainer) {
            if (compoundEntries.length > 0) {
                this.renderCompoundCards(compoundEntries, 5, false);
            } else {
                this.compoundContainer.style.display = "none";
                this.compoundContainer.innerHTML = "";
            }
        }

        if (this.loraPreviewCard) {
            this.loraPreviewCard.style.display = "none";
        }

        // Thumbnail preview card and LoRA path
        this.triggerPreviewCard.innerHTML = "";
        this.triggerPreviewCard.style.display = "flex";

        const sources = Array.isArray(item.sources) ? item.sources : [];
        const isMulti = sources.length >= 2;

        if (isMulti) {
            this.triggerPreviewCard.classList.add("has-multi");
            this.triggerPreviewCard.title = `Click to view all ${sources.length} matching LoRAs in LoRA Manager`;

            const headerDiv = document.createElement("div");
            headerDiv.className = "acTriggerCardHeader";

            const titleDiv = document.createElement("div");
            titleDiv.className = "acTriggerCardHeaderTitle";
            titleDiv.textContent = `${sources.length} MATCHING LORAS`;

            const badge = document.createElement("button");
            badge.type = "button";
            badge.className = "acTriggerActionBadge";
            badge.textContent = `View All in LoRA Manager (${sources.length}) ↗`;
            badge.title = `Filter all ${sources.length} matching LoRAs in LoRA Manager`;

            const openMultiUrl = async () => {
                const hashList = [];
                for (const s of sources) {
                    let h = (s.sha256 || s.rawModel?.sha256 || s.rawModel?.hash || "").toLowerCase();
                    if (!h && (s.loraPath || s.cleanName)) {
                        const targetKey = s.loraPath || s.cleanName;
                        const cached = modelInfoCache.get(targetKey);
                        h = (cached?.sha256 || cached?.rawModel?.sha256 || cached?.rawModel?.hash || "").toLowerCase();
                        if (!h) {
                            try {
                                const info = await fetchLoraModelInfo(targetKey);
                                h = (info?.sha256 || info?.rawModel?.sha256 || info?.rawModel?.hash || "").toLowerCase();
                            } catch (_) {}
                        }
                    }
                    if (h && !hashList.includes(h)) hashList.push(h);
                }

                const url = hashList.length ? `/autocomplete-plus-plus/open-in-lm?hashes=${encodeURIComponent(hashList.join(","))}` : "/loras";
                window.open(url, "_blank");
            };

            badge.addEventListener("mousedown", (e) => {
                e.stopPropagation();
                e.preventDefault();
                openMultiUrl();
            });

            headerDiv.appendChild(titleDiv);
            headerDiv.appendChild(badge);
            this.triggerPreviewCard.appendChild(headerDiv);

            this.triggerPreviewCard.onmousedown = (e) => {
                if (e.target.closest(".acTriggerCol")) return;
                e.stopPropagation();
                e.preventDefault();
                openMultiUrl();
            };
        } else {
            this.triggerPreviewCard.classList.remove("has-multi");
            this.triggerPreviewCard.title = "";
            this.triggerPreviewCard.onmousedown = null;
        }

        const gridDiv = document.createElement("div");
        gridDiv.className = "acTriggerGrid";
        const numCols = Math.max(1, sources.length);
        gridDiv.style.gridTemplateColumns = `repeat(${numCols}, 1fr)`;

        const intSettings = getEffectiveIntegrationsSettings();
        const isLMActive = intSettings.loraManagerMode !== "Disabled" && isLoraManagerAvailable();

        sources.forEach(source => {
            const col = document.createElement("div");
            col.className = "acTriggerCol";
            if (isLMActive) {
                col.title = `Click to view "${source.cleanName || source.loraPath}" in LoRA Manager`;
                col.addEventListener("mousedown", async (e) => {
                    if (e.target.closest(".acThumbBadgeExt")) return;
                    e.stopPropagation();
                    e.preventDefault();
                    let hash = (source.sha256 || source.rawModel?.sha256 || source.rawModel?.hash || "").toLowerCase();
                    if (!hash && (source.loraPath || source.cleanName)) {
                        const targetKey = source.loraPath || source.cleanName;
                        const cached = modelInfoCache.get(targetKey);
                        hash = (cached?.sha256 || cached?.rawModel?.sha256 || cached?.rawModel?.hash || "").toLowerCase();
                        if (!hash) {
                            try {
                                const info = await fetchLoraModelInfo(targetKey);
                                hash = (info?.sha256 || info?.rawModel?.sha256 || info?.rawModel?.hash || "").toLowerCase();
                            } catch (_) {}
                        }
                    }
                    const url = hash ? `/autocomplete-plus-plus/open-in-lm?hashes=${encodeURIComponent(hash)}` : "/loras";
                    window.open(url, "_blank");
                });
            }

            // 1. Thumbnail Container (2:3 portrait)
            const thumbContainer = document.createElement("div");
            thumbContainer.className = "acTriggerThumbContainer";

            const rawPath = source.loraPath || "";
            const cleanName = source.cleanName || rawPath;
            const cacheKey = `lora:${rawPath || cleanName}`;
            const cachedThumb = modelThumbStatusCache.get(cacheKey);

            const initialSrc = (cachedThumb && cachedThumb !== "none")
                ? cachedThumb
                : (source.previewUrl || PLACEHOLDER_IMG_URL);

            const thumbImg = document.createElement("img");
            thumbImg.className = "acTriggerThumbImg";
            thumbImg.alt = "Thumbnail";
            thumbImg.src = initialSrc;
            thumbContainer.appendChild(thumbImg);

            let badgeStack = null;
            if (isLMActive) {
                const targetKey = rawPath || cleanName;
                const cached = modelInfoCache.get(targetKey) || modelInfoCache.get(cleanName) || modelInfoCache.get(rawPath);
                const baseModel = source.baseModel || cached?.baseModel || "";
                const civitaiUrl = source.civitaiUrl || cached?.civitaiUrl || "";
                const hfUrl = source.hfUrl || cached?.hfUrl || "";

                badgeStack = createThumbBadgeStack({
                    baseModel,
                    civitaiUrl,
                    hfUrl,
                    isLMActive
                });
                if (badgeStack) {
                    thumbContainer.appendChild(badgeStack);
                }

                if (!baseModel || !civitaiUrl) {
                    fetchLoraModelInfo(targetKey).then(info => {
                        if (info && badgeStack) {
                            updateThumbBadgeStack(badgeStack, {
                                baseModel: info.baseModel || "",
                                civitaiUrl: info.civitaiUrl || "",
                                hfUrl: info.hfUrl || ""
                            });
                        }
                    }).catch(() => {});
                }
            }

            // Fast-path: if not yet cached and no direct previewUrl, resolve in background via clean JSON probe
            if (!cachedThumb && !source.previewUrl && (rawPath || cleanName)) {
                const probeUrl = `/autocomplete-plus-plus/models/thumbnail?type=loras&name=${encodeURIComponent(rawPath || cleanName)}&info=1`;
                (async () => {
                    try {
                        const res = await fetch(probeUrl).catch(() => null);
                        if (res && res.ok) {
                            const data = await res.json().catch(() => null);
                            if (data?.has_thumbnail && data.url) {
                                modelThumbStatusCache.set(cacheKey, data.url);
                                thumbImg.src = data.url;
                                return;
                            }
                        }
                    } catch (_) {}

                    const intSettings = getEffectiveIntegrationsSettings();
                    const isLMFallbackEnabled = intSettings.loraManagerMode !== "Disabled" && isLoraManagerAvailable();

                    if (isLMFallbackEnabled) {
                        try {
                            const lmPreviewUrl = await fetchLoraManagerPreviewUrl(rawPath, cleanName);
                            if (lmPreviewUrl) {
                                modelThumbStatusCache.set(cacheKey, lmPreviewUrl);
                                thumbImg.src = lmPreviewUrl;
                                return;
                            }
                        } catch (_) {}
                    }

                    modelThumbStatusCache.set(cacheKey, "none");
                })();
            }

            col.appendChild(thumbContainer);

            // 2. Full LoRA Path and Name (2-line clamped with hover tooltip)
            const nameDiv = document.createElement("div");
            nameDiv.className = "acTriggerModelName";
            nameDiv.textContent = rawPath || cleanName;
            nameDiv.title = rawPath || cleanName;
            col.appendChild(nameDiv);

            gridDiv.appendChild(col);
        });

        this.triggerPreviewCard.appendChild(gridDiv);

        this.positionTriggerPreview();
        requestAnimationFrame(() => {
            this.positionTriggerPreview();
        });
    }

    hideThumbnailPreview() {
        this.currentPreviewUrl = null;
        this.currentPreviewTitle = null;
        if (this.loraPreviewCard) {
            this.loraPreviewCard.style.display = "none";
            this.loraPreviewCard.style.width = "";
        }
        if (this.triggerPreviewCard) {
            this.triggerPreviewCard.style.display = "none";
            this.triggerPreviewCard.style.width = "";
        }
        if (this.compoundContainer) {
            this.compoundContainer.style.display = "none";
            this.compoundContainer.classList.remove("two-col");
            this.compoundContainer.style.width = "";
        }
        if (this.previewImg) {
            this.previewImg.src = "";
        }
    }

    showInfoPopover(sources, anchorElement) {
        if (!Array.isArray(sources) || sources.length === 0 || !this.infoPopover) return;
        this.detectThemeLuminance();
        const validSources = sources.filter(Boolean);
        if (validSources.length === 0) return;

        this.activePopoverSources = validSources;
        this.infoPopover.innerHTML = "";
        this.infoPopover.style.display = "flex";

        const title = document.createElement("div");
        title.className = "acPopoverTitle";
        title.textContent = "SELECT LORA:";
        this.infoPopover.appendChild(title);

        validSources.forEach((src, idx) => {
            const rawUrl = src.civitaiUrl || src.hfUrl || "";
            const extMeta = getExternalLinkMeta(rawUrl);

            const btnGroup = document.createElement("div");
            btnGroup.className = `acModelBtnGroup ${extMeta ? "has-ext" : "no-ext"}`;

            // 1. Left Primary Button (Open Local LoRA Manager Info Modal)
            const mainBtn = document.createElement("button");
            mainBtn.type = "button";
            mainBtn.className = "acModelBtnMain";
            mainBtn.title = `Open Local Model Info`;

            const num = document.createElement("span");
            num.className = "acModelBtnNum";
            num.textContent = `${idx + 1}.`;

            const name = document.createElement("span");
            name.className = "acModelBtnName";
            name.textContent = src.cleanName || src.loraPath || `Model ${idx + 1}`;

            const lmIcon = document.createElement("span");
            lmIcon.className = "acModelBtnLmIcon";
            lmIcon.innerHTML = getLoraManagerIconImg();

            mainBtn.appendChild(num);
            mainBtn.appendChild(name);
            mainBtn.appendChild(lmIcon);

            mainBtn.addEventListener("mousedown", (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.hideInfoPopover();
                openLoraInfoModal(src);
            });

            btnGroup.appendChild(mainBtn);

            // 2. Right Secondary Button (Open External Civitai / HF Page) - only if external link exists
            if (extMeta) {
                const extBtn = document.createElement("button");
                extBtn.type = "button";
                extBtn.className = `acModelBtnExt acExt-${extMeta.type}`;
                extBtn.title = `${extMeta.tooltip}`;
                extBtn.innerHTML = extMeta.iconImg;

                extBtn.addEventListener("mousedown", (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    this.hideInfoPopover();
                    openCivitaiUrl(extMeta.url);
                });

                btnGroup.appendChild(extBtn);
            }

            this.infoPopover.appendChild(btnGroup);
        });

        // Position popover directly above anchorElement with exact arrow alignment
        const positionPopover = () => {
            if (!this.infoPopover || this.infoPopover.style.display !== "flex") return;
            const aRect = anchorElement && typeof anchorElement.getBoundingClientRect === "function" 
                ? anchorElement.getBoundingClientRect() 
                : (this.domContainer ? this.domContainer.getBoundingClientRect() : null);

            if (!aRect) return;

            // Use offsetWidth / offsetHeight (unaffected by CSS transforms/scale animations)
            const popWidth = this.infoPopover.offsetWidth || 295;
            const popHeight = this.infoPopover.offsetHeight || 100;

            const anchorCenterX = aRect.left + (aRect.width / 2);
            let left = anchorCenterX - (popWidth / 2);
            let top = aRect.top - popHeight - 8;

            if (left < 10) left = 10;
            if (left + popWidth > window.innerWidth - 10) left = window.innerWidth - popWidth - 10;
            if (top < 10) top = aRect.bottom + 8;

            const arrowOffset = Math.max(16, Math.min(popWidth - 16, anchorCenterX - left));

            this.infoPopover.style.left = `${left}px`;
            this.infoPopover.style.top = `${top}px`;
            this.infoPopover.style.setProperty("--arrow-left", `${arrowOffset}px`);
        };

        positionPopover();
        requestAnimationFrame(positionPopover);
    }

    hideInfoPopover() {
        if (this.infoPopover) {
            this.infoPopover.style.display = "none";
            this.infoPopover.innerHTML = "";
        }
        this.activePopoverSources = null;
    }

    updatePosition() {
        if (!this.target) return;
        const coords = getFixedCaretCoordinates(this.target, this.target.selectionStart);

        let left = coords.left;
        let top = coords.bottom + 6;

        this.domContainer.style.display = "block";
        const rect = this.domContainer.getBoundingClientRect();

        // Viewport boundary clamping
        if (top + rect.height > window.innerHeight - 10) {
            top = Math.max(10, window.innerHeight - rect.height - 10);
        }
        if (left + rect.width > window.innerWidth - 10) {
            left = Math.max(10, window.innerWidth - rect.width - 10);
        }

        this.domContainer.style.left = `${left}px`;
        this.domContainer.style.top = `${top}px`;

        if ((this.loraPreviewCard && this.loraPreviewCard.style.display === "flex") ||
            (this.triggerPreviewCard && this.triggerPreviewCard.style.display === "flex")) {
            this.positionPreviewCard();
        }
    }

    detectThemeLuminance() {
        this.setThemeAttribute(isComfyThemeLight() ? "light" : null);
    }

    setThemeAttribute(theme) {
        const containers = [
            this.domContainer,
            this.loraPreviewCard,
            this.triggerPreviewCard,
            this.compoundContainer,
            this.infoPopover
        ];
        containers.forEach(el => {
            if (!el) return;
            if (theme) {
                el.setAttribute("data-theme", theme);
            } else {
                el.removeAttribute("data-theme");
            }
        });
    }

    show() {
        this.isVisible = true;
        this.unlockMouseHover();
        this.detectThemeLuminance();
        this.domContainer.style.display = "block";
    }

    hide() {
        this.isVisible = false;
        this.isInsideLoraPrefixSession = false;
        this.unlockMouseHover();
        this.domContainer.style.display = "none";
        this.hideThumbnailPreview();
        this.hideInfoPopover();
        this.results = [];
        this.selectedIndex = 0;
    }

    insertRawText(rawText) {
        if (!this.target || !rawText) return;
        const fullVal = this.target.value;
        const start = this.tagwordStart >= 0 ? this.tagwordStart : this.target.selectionStart;
        const end = this.tagwordEnd >= 0 ? this.tagwordEnd : this.target.selectionEnd;

        const fmtSettings = { ...getEffectiveFormattingSettings() };
        if (isKeepUnderscoresTextarea(this.target)) {
            fmtSettings.replaceUnderscore = false;
        }

        let textToInsert = rawText.trim().replace(/,+$/, "").trim();
        if (fmtSettings.replaceUnderscore) {
            const exclusionSet = buildUnderscoreExclusionSet(fmtSettings.formatKeepUnderscoresList);
            textToInsert = formatTagUnderscores(textToInsert, exclusionSet);
        }

        const cleanFormatted = textToInsert + (fmtSettings.autoInsertComma ? ", " : " ");
        const before = fullVal.substring(0, start);
        const after = fullVal.substring(end);

        const nextVal = before + cleanFormatted + after;
        this.target.value = nextVal;

        const newPos = start + cleanFormatted.length;
        this.target.setSelectionRange(newPos, newPos);
        this.target.dispatchEvent(new Event("input", { bubbles: true }));

        this.hide();
        this.hideThumbnailPreview();
        this.target.focus();
    }

    async insertTag(item) {
        if (!this.target || !item) return;

        const fmtSettings = { ...getEffectiveFormattingSettings() };
        if (isKeepUnderscoresTextarea(this.target)) {
            fmtSettings.replaceUnderscore = false;
        }

        let insertText = item.text;
        let autoComma = fmtSettings.autoInsertComma;

        // 0.5. Trigger prefix selection ("<trigger:") -> place cursor right after colon
        if (item.type === "trigger_prefix") {
            insertText = "<trigger:";
            autoComma = false;
        }

        // 1. LoRA prefix selection ("<lora:") -> place cursor right after colon
        if (item.type === "lora_prefix") {
            insertText = "<lora:";
            autoComma = false;
        }

        // 2. Embedding prefix selection ("embedding:") -> place cursor right after colon
        if (item.type === "embedding_prefix") {
            insertText = "embedding:";
            autoComma = false;
        }

        // 3. Category & Dictionary prefix selection ("/artist " or "/danbooru ") -> place cursor right after space
        if (item.type === "category_prefix" || item.type === "dict_prefix") {
            insertText = item.text;
            autoComma = false;
        }

        // 4. Wildcard / LoRA Directory step ("__samples/" or "<lora:illustrious/") -> cursor after slash
        if (item.type === "wildcard_dir" || item.type === "wildcard_file_step" || item.type === "lora_dir") {
            insertText = item.text;
            autoComma = false;
        }

        // 5. Wildcard Syntax Complete ("__samples/jewel__") -> complete standard wildcard
        if (item.type === "wildcard_syntax_complete") {
            insertText = item.text;
        }

        // 6. Wildcard Item word selection -> replaces full __...__ with the chosen word
        if (item.type === "wildcard_item") {
            insertText = item.text;
        }

        if (fmtSettings.replaceUnderscore && (!item.type || item.type === "trigger_word" || item.type === "artist")) {
            const exclusionSet = buildUnderscoreExclusionSet(fmtSettings.formatKeepUnderscoresList);
            insertText = formatTagUnderscores(insertText, exclusionSet);
        }

        if (fmtSettings.escapeParentheses && (!item.type || item.type === "trigger_word" || item.type === "artist") && !insertText.startsWith("<") && !insertText.startsWith("__") && !insertText.startsWith("embedding:") && !insertText.startsWith("/")) {
            insertText = insertText
                .replace(/\\?\(/g, "\\(")
                .replace(/\\?\)/g, "\\)")
                .replace(/\\?\[/g, "\\[")
                .replace(/\\?\]/g, "\\]");
        }

        // Anima Model: Ensure '@' prefix is attached to all real artist tags (excluding command / category prefixes)
        if (this.isAnimaWorkflowActive()) {
            const isRealArtistTag = (item.type === "artist" || (!item.type && (item.category === 1 || item.catId === 1)))
                && item.type !== "category_prefix"
                && item.type !== "dict_prefix"
                && item.sourceLabel !== "Category"
                && item.sourceLabel !== "Dictionary";
            if (isRealArtistTag && item.type !== "artist") {
                insertText = `@${insertText}`;
            }
        }

        const fullVal = this.target.value;
        const before = fullVal.substring(0, this.tagwordStart);
        const originalAfter = fullVal.substring(this.tagwordEnd);
        let after = originalAfter;

        const isSpecialPrefix = (
            item.type === "lora_prefix" ||
            item.type === "trigger_prefix" ||
            item.type === "embedding_prefix" ||
            item.type === "dict_prefix" ||
            item.type === "category_prefix" ||
            item.type === "wildcard_dir" ||
            item.type === "wildcard_file_step" ||
            item.type === "lora_dir"
        );

        // Multi-word and attached tail overlap detection
        if (!item.type || item.type === "artist" || item.type === "wildcard_item" || item.type === "wildcard_syntax_complete") {
            const cleanChosen = insertText.toLowerCase().replace(/[\s_\\\-]+/g, "");
            const typedHead = (this.currentTagword || fullVal.substring(this.tagwordStart, this.tagwordEnd)).toLowerCase().replace(/[\s_\\\-]+/g, "");

            // Extract the segment in `after` before the next unescaped delimiter (, : ( [ { ) ] } \n \r < >)
            let segmentLength = after.length;
            for (let i = 0; i < after.length; i++) {
                const ch = after[i];
                const isEscaped = (i > 0 && after[i - 1] === '\\');
                if (!isEscaped && (
                    ch === ',' || ch === ':' ||
                    ch === '(' || ch === '[' || ch === '{' ||
                    ch === ')' || ch === ']' || ch === '}' ||
                    ch === '\n' || ch === '\r' || ch === '<' || ch === '>'
                )) {
                    segmentLength = i;
                    break;
                }
            }
            const currentSegment = after.substring(0, segmentLength);
            const cleanSegment = currentSegment.toLowerCase().replace(/[\s_\\\-]+/g, "");

            if (cleanSegment.length > 0) {
                const combined = typedHead + cleanSegment;
                const isExactRecombine = (combined === cleanChosen);
                const isSuffixMatch = cleanChosen.endsWith(cleanSegment);
                const isContainedMatch = cleanChosen.includes(cleanSegment);
                const isWithinLength = (typedHead.length + cleanSegment.length <= cleanChosen.length + 1);

                // 1. Check multi-word segment overlap
                if (isExactRecombine || ((isSuffixMatch || isContainedMatch) && isWithinLength)) {
                    after = after.substring(segmentLength);
                } else {
                    // 2. Fallback: check single attached word tail (e.g. `maste|piece` -> `tail` is `piece`)
                    const attachedTailMatch = after.match(/^[a-zA-Z0-9_-]+/);
                    if (attachedTailMatch) {
                        const tail = attachedTailMatch[0].toLowerCase().replace(/[\s_\\\-]+/g, "");
                        const isTailExactRecombine = (typedHead + tail === cleanChosen);
                        const isTailSuffixMatch = cleanChosen.endsWith(tail);
                        const isTailContainedMatch = cleanChosen.includes(tail);
                        const isTailWithinLength = (typedHead.length + tail.length <= cleanChosen.length + 1);

                        if (isTailExactRecombine || ((isTailSuffixMatch || isTailContainedMatch) && isTailWithinLength)) {
                            after = after.substring(attachedTailMatch[0].length);
                        }
                    }
                }
            }
        }

        // 7. Grammar-Aware Context Sniffing on `after` (text immediately following the tagword)
        if (!item.type || item.type === "wildcard_item" || item.type === "wildcard_syntax_complete" || item.type === "lora" || item.type === "embeddings") {
            const colonMatch = after.match(/^[ \t]*:/);
            const bracketMatch = after.match(/^[ \t]*[\)\]\}]/);
            const pipeMatch = after.match(/^[ \t]*\|/);
            const commaMatch = after.match(/^[ \t]*,+[ \t]*/);

            if (colonMatch) {
                // Case 1: Followed by weight colon (e.g. `(smile :1.2)`) -> Suppress comma, absorb isolating spaces
                autoComma = false;
                after = after.replace(/^[ \t]*/, "");
            } else if (bracketMatch) {
                // Case 2: Followed by closing bracket (e.g. `(smile )` or `{smile }`) -> Suppress comma, absorb isolating spaces
                autoComma = false;
                after = after.replace(/^[ \t]*/, "");
            } else if (pipeMatch) {
                // Case 2.5: Followed by dynamic prompt / alternation pipe (e.g. `{bl|green}`) -> Suppress comma, absorb isolating spaces
                autoComma = false;
                after = after.replace(/^[ \t]*/, "");
            } else if (commaMatch) {
                // Case 3: Followed by existing comma(s) -> Absorb old comma(s) and isolating spaces
                after = after.substring(commaMatch[0].length);
            } else if (autoComma) {
                // Case 4: Followed by normal text / spaces -> Absorb leading horizontal spaces to avoid double spacing
                after = after.replace(/^[ \t]*/, "");
            }
        }

        const tagWordOnly = insertText;

        if (autoComma && !insertText.endsWith(",")) {
            insertText += ", ";
        }

        this.target.value = before + insertText + after;

        // Check if there was any content after the cursor on the same line
        const isEndOfLineOrPrompt = /^[ \t]*(\r?\n|$)/.test(originalAfter);

        let newCursorPos;
        if (isSpecialPrefix || isEndOfLineOrPrompt) {
            // End of line/prompt or interactive prefix -> place cursor at the very end of inserted text (after comma/space)
            newCursorPos = before.length + insertText.length;
        } else {
            // Middle of prompt -> keep cursor right after the word's last character (before the inserted comma)
            newCursorPos = before.length + tagWordOnly.length;
        }

        this.target.selectionStart = newCursorPos;
        this.target.selectionEnd = newCursorPos;

        this.isInserting = true;
        this.target.dispatchEvent(new Event("input", { bubbles: true }));
        this.target.dispatchEvent(new Event("change", { bubbles: true }));
        this.isInserting = false;

        // Record usage frequency only for tags, artists, LoRAs, and embeddings
        if (!item.type || item.type === "artist" || item.type === "lora" || item.type === "embeddings") {
            const usageTag = item.cleanName || item.text || item.name;
            if (usageTag && !usageTag.startsWith("/") && !usageTag.startsWith("__") && !usageTag.startsWith("<lora:") && !usageTag.startsWith("embedding:")) {
                this.recordTagUsage(usageTag);
            }
        }

        // For interactive prefixes and folder/file steps: re-trigger completion list immediately
        if (
            item.type === "lora_prefix" ||
            item.type === "trigger_prefix" ||
            item.type === "embedding_prefix" ||
            item.type === "dict_prefix" ||
            item.type === "category_prefix" ||
            item.type === "wildcard_dir" ||
            item.type === "wildcard_file_step" ||
            item.type === "lora_dir"
        ) {
            this.target.focus();
            const newTagword = this.extractTagword(this.target);
            this.results = await this.searchCandidates(newTagword);
            this.selectedIndex = 0;
            this.renderResults();
            return;
        }

        this.hide();
        this.target.focus();
    }

    async triggerSearch(target) {
        if (!settingValues.enabled || this.isInserting) return;
        this.target = target || this.target;
        if (!this.target) return;

        const tagword = this.extractTagword(this.target);
        if (!tagword || tagword.length < 1) {
            this.hide();
            return;
        }

        const results = await this.searchCandidates(tagword);
        if (!this.target) return;
        this.results = results;
        this.selectedIndex = 0;
        this.renderResults();
    }

    async handleInput(event) {
        if (!settingValues.enabled || this.isInserting) return;
        if (this.suppressNextSearch) {
            this.suppressNextSearch = false;
            return;
        }
        this.target = event.target;

        // Suspend candidate searches during key repeat
        if (this.isKeyRepeating) {
            this.hasPendingInput = true;
            const tagword = this.extractTagword(this.target);
            if (!tagword || tagword.length < 1) {
                this.hide();
            }
            return;
        }

        // Regular single keystroke typing
        this.hasPendingInput = false;
        await this.triggerSearch(this.target);
    }

    handleKeyDown(event) {
        // Track key repeat state for text mutation keys
        if (event.repeat) {
            this.isKeyRepeating = true;
        }

        if (!this.isVisible || this.results.length === 0) return;

        // Handle active Info Popover number shortcuts (1, 2, 3...) and Escape
        if (this.infoPopover && this.infoPopover.style.display !== "none" && Array.isArray(this.activePopoverSources)) {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                this.hideInfoPopover();
                return;
            }
            if (event.key >= "1" && event.key <= "9") {
                const idx = parseInt(event.key, 10) - 1;
                if (idx >= 0 && idx < this.activePopoverSources.length) {
                    const src = this.activePopoverSources[idx];
                    const rawUrl = src.civitaiUrl || src.hfUrl || "";
                    const extMeta = getExternalLinkMeta(rawUrl);

                    if (event.ctrlKey || event.metaKey) {
                        // Ctrl + 1..9: Open External link (Civitai / HF)
                        if (extMeta) {
                            event.preventDefault();
                            event.stopPropagation();
                            this.hideInfoPopover();
                            openCivitaiUrl(extMeta.url);
                            return;
                        }
                    } else {
                        // Plain 1..9: Open Local LoRA Manager Info Modal
                        event.preventDefault();
                        event.stopPropagation();
                        this.hideInfoPopover();
                        openLoraInfoModal(src);
                        return;
                    }
                }
            }
        }

        if (event.key === "ArrowDown") {
            event.preventDefault();
            this.lockMouseHover();
            this.selectedIndex = (this.selectedIndex + 1) % this.results.length;
            this.updateSelection();
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            this.lockMouseHover();
            this.selectedIndex = (this.selectedIndex - 1 + this.results.length) % this.results.length;
            this.updateSelection();
        } else if (event.key === "PageDown") {
            event.preventDefault();
            this.lockMouseHover();
            const pageSize = 5;
            this.selectedIndex = Math.min(this.results.length - 1, this.selectedIndex + pageSize);
            this.updateSelection();
        } else if (event.key === "PageUp") {
            event.preventDefault();
            this.lockMouseHover();
            const pageSize = 5;
            this.selectedIndex = Math.max(0, this.selectedIndex - pageSize);
            this.updateSelection();
        } else if (
            (event.key === "Tab" && settingValues.keyAcceptTab) ||
            (event.key === "Enter" && settingValues.keyAcceptEnter)
        ) {
            event.preventDefault();
            event.stopPropagation();
            if (this.results[this.selectedIndex]) {
                this.insertTag(this.results[this.selectedIndex]);
            }
        } else if (event.key === "Escape") {
            event.preventDefault();
            this.hide();
        } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            this.hide();
        } else if (event.key === "F1") {
            const sel = this.results[this.selectedIndex];
            if (sel && !sel.type) {
                const sourceFileLower = (sel.sourceFile || "").toLowerCase();
                const isDanbooru = sourceFileLower.includes("danbooru");
                const isE621 = sourceFileLower.includes("e621");
                if (isDanbooru || isE621) {
                    event.preventDefault();
                    const wikiUrl = isE621
                        ? `https://e621.net/wiki_pages/${encodeURIComponent(sel.text)}`
                        : `https://danbooru.donmai.us/wiki_pages/${encodeURIComponent(sel.text)}`;
                    window.open(wikiUrl, "_blank");
                }
            } else if (sel && sel.type === "trigger_word") {
                const allSources = Array.isArray(sel.sources) ? sel.sources.filter(Boolean) : [];
                if (allSources.length > 1) {
                    event.preventDefault();
                    const items = this.domList.querySelectorAll("li");
                    const selectedLi = items[this.selectedIndex];
                    const infoBtn = selectedLi ? selectedLi.querySelector(".ac-info-btn") : null;
                    this.showInfoPopover(allSources, infoBtn || selectedLi || this.domContainer);
                } else if (allSources.length === 1) {
                    const single = allSources[0];
                    if (single.civitaiUrl || single.hfUrl) {
                        event.preventDefault();
                        const items = this.domList.querySelectorAll("li");
                        const selectedLi = items[this.selectedIndex];
                        const infoBtn = selectedLi ? selectedLi.querySelector(".ac-info-btn") : null;
                        this.showInfoPopover(allSources, infoBtn || selectedLi || this.domContainer);
                    } else {
                        event.preventDefault();
                        openLoraInfoModal(single);
                    }
                }
            }
        }
    }

    async handleKeyUp(event) {
        this.isKeyRepeating = false;
        // If an input was suspended during long-press repeating, resolve final state immediately
        if (this.hasPendingInput && this.target) {
            this.hasPendingInput = false;
            await this.triggerSearch(this.target);
        }
    }

    updateSelection() {
        this.hideInfoPopover();
        const items = this.domList.querySelectorAll("li");
        items.forEach((li, idx) => {
            if (idx === this.selectedIndex) {
                li.classList.add("selected");
                li.scrollIntoView({ block: "nearest" });
            } else {
                li.classList.remove("selected");
            }
        });

        // Trigger thumbnail preview for currently selected item
        if (this.results[this.selectedIndex]) {
            this.showThumbnailPreview(this.results[this.selectedIndex]);
        } else {
            this.hideThumbnailPreview();
        }
    }

    handleBlur() {
        setTimeout(() => {
            if (!this.domContainer.contains(document.activeElement)) {
                this.hide();
            }
        }, 150);
    }
}
