import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { settingValues, logDebug } from "./settings.js";
import { getActiveControllerNode } from "./main.js";

// In-memory cache for all wildcard files: Map<string, string[]>
export const wildcardContentMap = new Map();

// Sequential index tracker for wildcards in Sequential Mode: Map<string, number>
const sequentialIndexMap = new Map();

// Structured snapshot of the last execution for "Keep Last Choice" mode
let lastExecutionSnapshot = {
    masterSeed: null,
    dpMap: new Map(), // "dp:innerContent" -> resolvedText
    wcMap: new Map(),  // "wc:cleanName" -> resolvedText
    nodeExactMatches: new Map() // "nodeId:inputKey" -> { template, executed }
};

let importedPngSnapshot = null;
let pendingImportedPrompt = null;
let pendingImportedPromptPromise = null;

function createSeededRng(seed) {
    let s = (Math.abs(Number(seed)) || 1) >>> 0;
    return function () {
        let t = (s += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export async function loadAllWildcardData() {
    try {
        const res = await fetch("/autocomplete-plus-plus/wildcards/all-data");
        if (res.ok) {
            const data = await res.json();
            if (data && data.success && data.wildcards) {
                wildcardContentMap.clear();
                for (const [name, lines] of Object.entries(data.wildcards)) {
                    wildcardContentMap.set(name.toLowerCase(), lines);
                    wildcardContentMap.set(name.toLowerCase().replace(/\\/g, "/"), lines);
                }
                logDebug(`[Autocomplete++] Loaded content for ${wildcardContentMap.size} wildcard files.`);
            }
        }
    } catch (e) {
        console.warn("[Autocomplete++] Failed to pre-load all wildcard data:", e);
    }
}

// Follow link pointers e.g. ["12", 0] in promptGraph to find the underlying numeric seed
function resolveLinkedNumber(promptGraph, value, visited = new Set()) {
    if (value === undefined || value === null) return null;

    if (typeof value === "number" && !isNaN(value)) {
        return value;
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        if (/^-?\d+$/.test(trimmed)) {
            return parseInt(trimmed, 10);
        }
    }

    // Follow connection links: ["nodeId", outputIndex]
    if (Array.isArray(value) && value.length >= 1) {
        const targetNodeId = String(value[0]);
        if (visited.has(targetNodeId)) return null;
        visited.add(targetNodeId);

        const targetNode = promptGraph[targetNodeId];
        if (targetNode && targetNode.inputs) {
            // Check common output value fields in source nodes (e.g. rgthree Seed, PrimitiveNode, ImpactInt, Seed Generator)
            const candidateKeys = [
                "seed", "noise_seed", "seed_num", "seed_value", "value", "val", "seed_int", "int", "integer"
            ];
            for (const k of candidateKeys) {
                if (targetNode.inputs[k] !== undefined) {
                    const res = resolveLinkedNumber(promptGraph, targetNode.inputs[k], visited);
                    if (res !== null) return res;
                }
            }
            // Check any remaining values in targetNode.inputs
            for (const [_, v] of Object.entries(targetNode.inputs)) {
                const res = resolveLinkedNumber(promptGraph, v, visited);
                if (res !== null) return res;
            }
        }
    }

    return null;
}

// Master Seed extraction across graph nodes
function extractMasterSeed(promptGraph) {
    if (!promptGraph || typeof promptGraph !== "object") return Math.floor(Math.random() * 2147483647);

    const nodeIds = Object.keys(promptGraph);

    // Strategy 1: Find EmptyLatentImage node and find which Sampler consumes it directly (Pass 1)
    let pass1SamplerNode = null;
    let emptyLatentNodeIds = new Set();

    for (const id of nodeIds) {
        const node = promptGraph[id];
        const ctype = String(node?.class_type || "").toLowerCase();
        if (ctype.includes("emptylatent") || ctype.includes("emptysd3latent") || ctype.includes("emptyfluxlatent")) {
            emptyLatentNodeIds.add(id);
        }
    }

    if (emptyLatentNodeIds.size > 0) {
        for (const id of nodeIds) {
            const node = promptGraph[id];
            if (!node || !node.inputs) continue;
            const latentInput = node.inputs.latent_image || node.inputs.samples;
            if (Array.isArray(latentInput) && emptyLatentNodeIds.has(String(latentInput[0]))) {
                pass1SamplerNode = node;
                break;
            }
        }
    }

    // Try extracting seed from Pass 1 Sampler if found
    if (pass1SamplerNode && pass1SamplerNode.inputs) {
        const candidateKeys = ["seed", "noise_seed", "seed_num", "seed_value", "value"];
        for (const k of candidateKeys) {
            if (pass1SamplerNode.inputs[k] !== undefined) {
                const s = resolveLinkedNumber(promptGraph, pass1SamplerNode.inputs[k]);
                if (s !== null) return s;
            }
        }
    }

    // Strategy 2: Scan any Sampler nodes in topological/ID order
    const samplerKeywords = ["ksampler", "sampler", "denoise", "loader", "pipe"];
    for (const id of nodeIds) {
        const node = promptGraph[id];
        if (!node || !node.inputs) continue;
        const ctype = String(node.class_type || "").toLowerCase();

        if (samplerKeywords.some(kw => ctype.includes(kw))) {
            const candidateKeys = ["seed", "noise_seed", "seed_num", "seed_value", "value"];
            for (const k of candidateKeys) {
                if (node.inputs[k] !== undefined) {
                    const s = resolveLinkedNumber(promptGraph, node.inputs[k]);
                    if (s !== null) return s;
                }
            }
        }
    }

    // Strategy 3: Scan dedicated Seed nodes (rgthree, Primitive, Impact, etc.)
    for (const id of nodeIds) {
        const node = promptGraph[id];
        if (!node || !node.inputs) continue;
        const ctype = String(node.class_type || "").toLowerCase();

        if (ctype.includes("seed") || ctype.includes("primitive") || ctype.includes("integer") || ctype.includes("rgthree")) {
            const candidateKeys = ["seed", "noise_seed", "seed_num", "value", "val"];
            for (const k of candidateKeys) {
                if (node.inputs[k] !== undefined) {
                    const s = resolveLinkedNumber(promptGraph, node.inputs[k]);
                    if (s !== null) return s;
                }
            }
        }
    }

    // Strategy 4: Fallback scan across ANY node with a field named seed/noise_seed
    for (const id of nodeIds) {
        const node = promptGraph[id];
        if (!node || !node.inputs) continue;
        if (node.inputs.seed !== undefined) {
            const s = resolveLinkedNumber(promptGraph, node.inputs.seed);
            if (s !== null) return s;
        }
        if (node.inputs.noise_seed !== undefined) {
            const s = resolveLinkedNumber(promptGraph, node.inputs.noise_seed);
            if (s !== null) return s;
        }
    }

    return Math.floor(Math.random() * 2147483647);
}

function getCanvasControllerOverrides() {
    const overrides = {
        hasController: false,
        expansionEngine: "Default",
        wildcardMode: "Default",
        dynamicPromptMode: "Default"
    };

    const node = getActiveControllerNode("AutocompletePlusController");
    if (node) {
        overrides.hasController = true;

        if (node.widgets && Array.isArray(node.widgets)) {
            for (const w of node.widgets) {
                if (w.name === "expansion_engine") {
                    overrides.expansionEngine = w.value || "Default (From Settings)";
                } else if (w.name === "wildcard_mode") {
                    overrides.wildcardMode = w.value || "Default (From Settings)";
                } else if (w.name === "dynamic_prompt_mode") {
                    overrides.dynamicPromptMode = w.value || "Default (From Settings)";
                }
            }
        }
    }

    return overrides;
}

function findTopLevelBraces(str) {
    const results = [];
    let depth = 0;
    let start = -1;
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (char === "{") {
            if (depth === 0) start = i;
            depth++;
        } else if (char === "}") {
            if (depth > 0) {
                depth--;
                if (depth === 0 && start !== -1) {
                    results.push({ start, end: i + 1, content: str.slice(start + 1, i) });
                    start = -1;
                }
            }
        }
    }
    return results;
}

function splitTopLevelChoices(content) {
    const choices = [];
    let depth = 0;
    let last = 0;
    for (let i = 0; i < content.length; i++) {
        const char = content[i];
        if (char === "{") {
            depth++;
        } else if (char === "}") {
            if (depth > 0) depth--;
        } else if (char === "|" && depth === 0) {
            choices.push(content.slice(last, i));
            last = i + 1;
        }
    }
    choices.push(content.slice(last));
    return choices;
}

function stripAllBraces(str) {
    if (!str || typeof str !== "string") return "";
    let s = str;
    let prev;
    do {
        prev = s;
        s = s.replace(/\{[^{}]*\}/g, "");
    } while (s !== prev);
    return s;
}

function stripComments(text) {
    if (!text || typeof text !== "string") return text;
    // 1. Strip block comments: /* ... */ and /** ... **/
    let s = text.replace(/\/\*[\s\S]*?\*\//g, "");
    // 2. Strip single-line comments: // ...
    return s.replace(/\/\/.*$/gm, "");
}

function parseChoices(rawChoicesStr) {
    const choices = [];
    const parts = splitTopLevelChoices(rawChoicesStr);

    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) {
            choices.push({ text: "", weight: 1.0 });
            continue;
        }

        const weightMatch = trimmed.match(/^(\d+(?:\.\d+)?)::(.*)$/s);
        if (weightMatch) {
            const weight = Math.max(0.001, parseFloat(weightMatch[1]));
            const text = weightMatch[2].trim();
            choices.push({ text, weight });
        } else {
            choices.push({ text: trimmed, weight: 1.0 });
        }
    }

    return choices;
}

async function parsePngMetadata(file) {
    if (!file || !(file instanceof Blob)) return null;
    try {
        const buffer = await file.arrayBuffer();
        const view = new DataView(buffer);
        if (view.getUint32(0) !== 0x89504E47 || view.getUint32(4) !== 0x0D0A1A0A) {
            return null;
        }
        let offset = 8;
        const utf8 = new TextDecoder("utf-8");
        const latin1 = new TextDecoder("latin1");

        while (offset < buffer.byteLength - 8) {
            const length = view.getUint32(offset);
            const type = String.fromCharCode(
                view.getUint8(offset + 4), view.getUint8(offset + 5),
                view.getUint8(offset + 6), view.getUint8(offset + 7)
            );
            offset += 8;

            if (type === "tEXt") {
                const chunkData = new Uint8Array(buffer, offset, length);
                const nullIdx = chunkData.indexOf(0);
                if (nullIdx !== -1) {
                    const keyword = latin1.decode(chunkData.subarray(0, nullIdx));
                    if (keyword === "prompt") {
                        const text = utf8.decode(chunkData.subarray(nullIdx + 1));
                        return JSON.parse(text);
                    }
                }
            } else if (type === "iTXt") {
                const chunkData = new Uint8Array(buffer, offset, length);
                const nullIdx = chunkData.indexOf(0);
                if (nullIdx !== -1) {
                    const keyword = latin1.decode(chunkData.subarray(0, nullIdx));
                    let textStart = nullIdx + 3;
                    while (textStart < chunkData.length && chunkData[textStart] !== 0) textStart++;
                    textStart++;
                    while (textStart < chunkData.length && chunkData[textStart] !== 0) textStart++;
                    textStart++;
                    if (textStart < chunkData.length && keyword === "prompt") {
                        const text = utf8.decode(chunkData.subarray(textStart));
                        return JSON.parse(text);
                    }
                }
            } else if (type === "IEND") {
                break;
            }
            offset += length + 4;
        }
        return null;
    } catch (e) {
        return null;
    }
}

function extractChoicesFromTemplate(template, executedText, dpMap, wcMap) {
    if (!template || !executedText || typeof template !== "string" || typeof executedText !== "string") {
        return;
    }

    const cleanTemplate = stripComments(template);
    const normExec = executedText.replace(/\s+/g, " ").trim();

    function extractRecursive(text) {
        const topBraces = findTopLevelBraces(text);
        for (const brace of topBraces) {
            const rawInner = brace.content;
            if (!rawInner.includes("|") && !rawInner.includes("$$")) continue;

            const quantMatch = rawInner.match(/^(\d+(?:-\d+)?)\$\$(?:(.*?)\$\$)?(.*)$/s);
            const choicesStr = quantMatch ? quantMatch[3] : rawInner;
            const choices = splitTopLevelChoices(choicesStr);
            const hasEmptyChoice = choices.some(c => c.trim() === "");

            let matchedChoice = null;
            let bestScore = 0;

            for (const c of choices) {
                const cand = c.trim();
                if (!cand) continue;

                const wm = cand.match(/^(\d+(?:\.\d+)?)::(.*)$/s);
                const candContent = wm ? wm[2].trim() : cand;

                const plain = stripAllBraces(candContent).replace(/\s+/g, " ").trim();
                const tags = plain.split(",").map(t => t.replace(/\s+/g, " ").trim()).filter(t => t.length > 2);

                if (tags.length > 0) {
                    const matchingTags = tags.filter(t => normExec.includes(t));
                    if (matchingTags.length === tags.length && tags.length > bestScore) {
                        bestScore = tags.length;
                        matchedChoice = c;
                    }
                } else if (plain && normExec.includes(plain) && plain.length > bestScore) {
                    bestScore = plain.length;
                    matchedChoice = c;
                } else if (candContent.includes("{")) {
                    // Fallback for candidates whose text is entirely inside nested braces
                    const innerBraces = findTopLevelBraces(candContent);
                    let innerScore = 0;
                    for (const ib of innerBraces) {
                        const subChoices = splitTopLevelChoices(ib.content);
                        for (const sc of subChoices) {
                            const scPlain = stripAllBraces(sc).replace(/\s+/g, " ").trim();
                            if (scPlain && normExec.includes(scPlain)) {
                                innerScore += scPlain.length;
                            }
                        }
                    }
                    if (innerScore > bestScore) {
                        bestScore = innerScore;
                        matchedChoice = c;
                    }
                }
            }

            if (matchedChoice !== null) {
                dpMap.set("dp:" + rawInner, matchedChoice);
                extractRecursive(matchedChoice);
            } else if (hasEmptyChoice) {
                const key = "dp:" + rawInner;
                if (!dpMap.has(key) || dpMap.get(key) === "") {
                    dpMap.set(key, "");
                }
            }
        }
    }

    extractRecursive(cleanTemplate);

    const wcRegex = /__([a-zA-Z0-9_\-\/\s]+)__/g;
    let m;
    while ((m = wcRegex.exec(cleanTemplate)) !== null) {
        const rawWc = m[1];
        const cleanWc = rawWc.replace(/^__/, "").replace(/__$/, "").replace(/\\/g, "/").toLowerCase().trim();
        if (wcMap.has("wc:" + cleanWc)) continue;

        const lines = wildcardContentMap.get(cleanWc);
        if (Array.isArray(lines)) {
            const sortedLines = [...lines].sort((a, b) => b.length - a.length);
            for (const line of sortedLines) {
                if (line && executedText.includes(line)) {
                    wcMap.set("wc:" + cleanWc, line);
                    break;
                }
            }
        }
    }
}

function extractChoicesFromWorkflowAndPrompt(graphData, prompt) {
    if (!graphData || !prompt || typeof graphData !== "object" || typeof prompt !== "object") {
        return null;
    }

    const masterSeed = extractMasterSeed(prompt);
    const dpMap = new Map();
    const wcMap = new Map();
    const nodeExactMatches = new Map();

    const nodes = Array.isArray(graphData.nodes) ? graphData.nodes : [];
    for (const node of nodes) {
        if (!node || node.id === undefined) continue;
        const promptNode = prompt[String(node.id)] || prompt[Number(node.id)];
        if (!promptNode || !promptNode.inputs || typeof promptNode.inputs !== "object") continue;

        let widgetValues = Array.isArray(node.widgets_values)
            ? node.widgets_values
            : (node.widgets_values ? [node.widgets_values] : []);

        if (widgetValues.length === 0 && typeof app !== "undefined" && app.graph?._nodes) {
            const canvasNode = app.graph._nodes.find(n => n && String(n.id) === String(node.id));
            if (canvasNode && Array.isArray(canvasNode.widgets)) {
                widgetValues = canvasNode.widgets.map(w => w?.value).filter(v => typeof v === "string");
            }
        }

        for (const widgetVal of widgetValues) {
            if (typeof widgetVal !== "string" || (!widgetVal.includes("{") && !widgetVal.includes("__"))) continue;

            // Extract static anchor tags (tokens outside dynamic braces and wildcards)
            const cleanTmpl = stripComments(widgetVal);
            const staticSkeleton = stripAllBraces(cleanTmpl).replace(/__[\w\s/\\.-]+?__/g, " ");
            const staticTags = staticSkeleton
                .split(",")
                .map(t => t.replace(/\s+/g, " ").trim())
                .filter(t => t.length > 2);

            for (const inputKey of Object.keys(promptNode.inputs)) {
                const executedVal = promptNode.inputs[inputKey];
                if (typeof executedVal !== "string") continue;

                if (staticTags.length > 0) {
                    const normExec = executedVal.replace(/\s+/g, " ").trim();
                    const matchedStatic = staticTags.filter(t => normExec.includes(t));
                    const ratio = matchedStatic.length / staticTags.length;
                    if (matchedStatic.length === 0 || (staticTags.length >= 3 && ratio < 0.1)) {
                        continue;
                    }
                }

                nodeExactMatches.set(`${node.id}:${inputKey}`, {
                    template: widgetVal,
                    executed: executedVal
                });

                extractChoicesFromTemplate(widgetVal, executedVal, dpMap, wcMap);
            }
        }
    }

    if (dpMap.size > 0 || wcMap.size > 0 || nodeExactMatches.size > 0) {
        return { masterSeed, dpMap, wcMap, nodeExactMatches };
    }

    return null;
}

function pickWeighted(choices, rng) {
    if (!choices || choices.length === 0) return "";
    if (choices.length === 1) return choices[0].text;

    let totalWeight = 0;
    for (const c of choices) {
        totalWeight += c.weight;
    }

    let r = rng() * totalWeight;
    for (const c of choices) {
        r -= c.weight;
        if (r <= 0) {
            return c.text;
        }
    }

    return choices[choices.length - 1].text;
}

function resolveDynamicPrompt(innerContent, optionsOrRng, maybeSessionCache) {
    if (!innerContent) return "";

    const options = typeof optionsOrRng === "object" && optionsOrRng !== null ? optionsOrRng : {
        rng: typeof optionsOrRng === "function" ? optionsOrRng : () => Math.random(),
        sessionCache: maybeSessionCache
    };

    const rng = options.dpRng || options.rng || (() => Math.random());
    const sessionCache = options.sessionCache;

    const cacheKey = "dp:" + innerContent;
    if (sessionCache && sessionCache.has(cacheKey)) {
        return sessionCache.get(cacheKey);
    }

    // Keep Last Choice: reuse last execution choice if master seed is identical
    if (options.keepLastDP && options.lastSnapshot?.dpMap && options.lastSnapshot.dpMap.has(cacheKey)) {
        const remembered = options.lastSnapshot.dpMap.get(cacheKey);
        if (sessionCache) sessionCache.set(cacheKey, remembered);
        if (options.currentSnapshot?.dpMap) options.currentSnapshot.dpMap.set(cacheKey, remembered);
        return remembered;
    }

    let countSpec = "1";
    let separator = ", ";
    let choicesStr = innerContent;

    // Check for quantity prefix: {2$$...} or {1-3$$...} or {2$$ and $$...}
    const quantMatch = innerContent.match(/^(\d+(?:-\d+)?)\$\$(?:(.*?)\$\$)?(.*)$/s);
    if (quantMatch) {
        countSpec = quantMatch[1];
        if (quantMatch[2] !== undefined && quantMatch[2] !== null) {
            separator = quantMatch[2];
        }
        choicesStr = quantMatch[3];
    } else if (!innerContent.includes("|")) {
        return "{" + innerContent + "}";
    }

    const rawChoices = parseChoices(choicesStr);
    if (rawChoices.length === 0) return "";

    const validChoices = rawChoices.filter(c => {
        const text = c.text.trim();
        if (!text) return true;
        const wcMatch = text.match(/^__([a-zA-Z0-9_\-\/\s]+)__$/);
        if (wcMatch) {
            return isWildcardAvailable(wcMatch[1], options);
        }
        return true;
    });
    const choices = validChoices.length > 0 ? validChoices : [{ text: "", weight: 1.0 }];

    // Determine quantity to pick
    let pickCount = 1;
    if (countSpec.includes("-")) {
        const [minStr, maxStr] = countSpec.split("-");
        const min = parseInt(minStr, 10) || 1;
        const max = parseInt(maxStr, 10) || min;
        pickCount = Math.floor(rng() * (max - min + 1)) + min;
    } else {
        pickCount = parseInt(countSpec, 10) || 1;
    }

    pickCount = Math.max(1, pickCount);

    let result = "";
    if (pickCount === 1) {
        result = pickWeighted(choices, rng);
    } else {
        // Multiple combination selection (sampling without replacement if count <= available)
        const selected = [];
        const pool = [...choices];

        for (let i = 0; i < pickCount; i++) {
            if (pool.length === 0) break;
            const chosenText = pickWeighted(pool, rng);
            selected.push(chosenText);

            // Remove chosen item from pool to avoid duplicates
            const idx = pool.findIndex(c => c.text === chosenText);
            if (idx !== -1) {
                pool.splice(idx, 1);
            }
        }
        result = selected.join(separator);
    }

    if (sessionCache) {
        sessionCache.set(cacheKey, result);
    }
    if (options.currentSnapshot?.dpMap) {
        options.currentSnapshot.dpMap.set(cacheKey, result);
    }

    return result;
}

function isWildcardAvailable(rawName, options) {
    const clean = rawName.replace(/^__/, "").replace(/__$/, "").replace(/\\/g, "/").toLowerCase().trim();
    if (!clean) return false;
    if (options?.keepLastWC && options?.lastSnapshot?.wcMap && options.lastSnapshot.wcMap.has("wc:" + clean)) {
        return true;
    }
    if (wildcardContentMap.has(clean) || wildcardContentMap.has(clean + ".txt")) {
        return true;
    }
    for (const k of wildcardContentMap.keys()) {
        const base = k.split("/").pop().replace(/\.txt$/i, "");
        if (base === clean) return true;
    }
    return false;
}

function resolveWildcard(rawName, options, visitedSet) {
    const clean = rawName.replace(/^__/, "").replace(/__$/, "").replace(/\\/g, "/").toLowerCase().trim();
    if (!clean) return "";

    const cacheKey = "wc:" + clean;
    if (options.sessionCache && options.sessionCache.has(cacheKey)) {
        return options.sessionCache.get(cacheKey);
    }

    // Keep Last Choice: reuse last execution choice if master seed is identical
    if (options.keepLastWC && options.lastSnapshot?.wcMap && options.lastSnapshot.wcMap.has(cacheKey)) {
        const remembered = options.lastSnapshot.wcMap.get(cacheKey);
        if (options.sessionCache) options.sessionCache.set(cacheKey, remembered);
        if (options.currentSnapshot?.wcMap) options.currentSnapshot.wcMap.set(cacheKey, remembered);
        return remembered;
    }

    // Prevent circular recursion (e.g. file A calls file B which calls file A)
    if (visitedSet.has(clean)) {
        return "";
    }

    // Try finding lines in memory cache
    let lines = wildcardContentMap.get(clean) || wildcardContentMap.get(clean + ".txt");
    if (!lines || lines.length === 0) {
        // Fallback: match basename if subfolder path was omitted
        for (const [k, v] of wildcardContentMap.entries()) {
            const base = k.split("/").pop().replace(/\.txt$/i, "");
            if (base === clean) {
                lines = v;
                break;
            }
        }
    }

    if (!lines || lines.length === 0) {
        console.warn(`[Autocomplete++] Wildcard not found: "__${rawName}__". Stripping from prompt.`);
        return "";
    }

    // Clean comments (#) and empty lines
    const validLines = lines.map(l => l.trim()).filter(l => l && !l.startsWith("#"));
    if (validLines.length === 0) return "";

    let chosenLine = "";
    if (options.isSequential) {
        const curIdx = sequentialIndexMap.get(clean) || 0;
        chosenLine = validLines[curIdx % validLines.length];
        sequentialIndexMap.set(clean, curIdx + 1);
    } else {
        const rng = options.wildcardRng || options.rng;
        const idx = Math.floor(rng() * validLines.length);
        chosenLine = validLines[idx];
    }

    // Recursively resolve chosen line (with depth tracking)
    const nextVisited = new Set(visitedSet);
    nextVisited.add(clean);

    const resolved = expandPromptString(chosenLine, options, nextVisited, options.depth + 1);

    if (options.sessionCache) {
        options.sessionCache.set(cacheKey, resolved);
    }
    if (options.currentSnapshot?.wcMap) {
        options.currentSnapshot.wcMap.set(cacheKey, resolved);
    }

    return resolved;
}

export function expandPromptString(text, options, visitedSet = new Set(), depth = 0) {
    if (!text || typeof text !== "string") return text;
    if (depth > 20) return text; // Max recursion depth safety limit

    const updatedOptions = { ...options, depth };

    let processed = depth === 0 ? stripComments(text) : text;

    // 1. Protect escape sequences: \{, \}, \__
    processed = processed
        .replace(/\\\{/g, "__ESC_LBRACE__")
        .replace(/\\\}/g, "__ESC_RBRACE__")
        .replace(/\\__/g, "__ESC_DBLUND__");

    // 2. Expand Dynamic Prompts {...} outside-in
    let dpLimit = 30;
    while (dpLimit > 0 && processed.includes("{")) {
        const topBraces = findTopLevelBraces(processed);
        if (topBraces.length === 0) break;
        dpLimit--;
        let changed = false;
        for (let i = topBraces.length - 1; i >= 0; i--) {
            const brace = topBraces[i];
            const rawInner = brace.content;
            if (!rawInner.includes("|") && !rawInner.includes("$$")) continue;
            const resolved = resolveDynamicPrompt(rawInner, updatedOptions);
            processed = processed.slice(0, brace.start) + resolved + processed.slice(brace.end);
            changed = true;
        }
        if (!changed) break;
    }

    // 3. Expand Wildcards __name__
    let wcLimit = 30;
    while (wcLimit > 0 && /__([a-zA-Z0-9_\-\/\s]+)__/.test(processed)) {
        wcLimit--;
        processed = processed.replace(/__([a-zA-Z0-9_\-\/\s]+)__/g, (_, name) => {
            return resolveWildcard(name.trim(), updatedOptions, visitedSet);
        });
    }

    // 4. Restore escape sequences
    processed = processed
        .replace(/__ESC_LBRACE__/g, "{")
        .replace(/__ESC_RBRACE__/g, "}")
        .replace(/__ESC_DBLUND__/g, "__");

    if (depth === 0) {
        processed = stripComments(processed);
    }

    return processed;
}

export function processPromptPayload(payload, canvasGroundTruth = null) {
    if (!payload || typeof payload !== "object") {
        return payload;
    }

    const promptGraph = payload.prompt || payload.output;
    if (!promptGraph || typeof promptGraph !== "object") {
        return payload;
    }

    // Check Controller Node overrides vs Settings Panel
    const controller = getCanvasControllerOverrides();

    let isEnabled = settingValues.enablePromptExpansion !== false;
    if (controller.hasController) {
        if (controller.expansionEngine === "Enabled" || controller.expansionEngine.includes("Enabled")) isEnabled = true;
        else if (controller.expansionEngine === "Disabled" || controller.expansionEngine.includes("Disabled")) isEnabled = false;
    }

    if (!isEnabled) {
        return payload; // Expansion is disabled: pass through unmodified
    }

    // Extract Master Seed (from Pass 1 Sampler or linked rgthree/Primitive nodes)
    const masterSeed = extractMasterSeed(promptGraph);

    // Determine Wildcard Mode: "Random" | "Follow Seed" | "Keep Last Choice" | "Sequential"
    let wcMode = settingValues.wildcardMode || "Random";
    if (controller.hasController && controller.wildcardMode && !controller.wildcardMode.startsWith("Default")) {
        if (controller.wildcardMode.includes("Sequential")) wcMode = "Sequential";
        else if (controller.wildcardMode.includes("Keep Last Choice")) wcMode = "Keep Last Choice";
        else if (controller.wildcardMode.includes("Follow Seed")) wcMode = "Follow Seed";
        else if (controller.wildcardMode.includes("Random")) wcMode = "Random";
    }

    // Determine Dynamic Prompt Mode: "Random" | "Follow Seed" | "Keep Last Choice"
    let dpMode = settingValues.dynamicPromptMode || "Random";
    if (controller.hasController && controller.dynamicPromptMode && !controller.dynamicPromptMode.startsWith("Default")) {
        if (controller.dynamicPromptMode.includes("Keep Last Choice")) dpMode = "Keep Last Choice";
        else if (controller.dynamicPromptMode.includes("Follow Seed")) dpMode = "Follow Seed";
        else if (controller.dynamicPromptMode.includes("Random")) dpMode = "Random";
    }

    if (importedPngSnapshot) {
        try {
            const isSeedSameAsImport = (
                importedPngSnapshot.masterSeed !== null &&
                masterSeed !== null &&
                String(importedPngSnapshot.masterSeed) === String(masterSeed)
            );
            const isKeepLastActive = (dpMode === "Keep Last Choice" || wcMode === "Keep Last Choice");

            if (isSeedSameAsImport && isKeepLastActive) {
                lastExecutionSnapshot = {
                    masterSeed: importedPngSnapshot.masterSeed,
                    dpMap: new Map(importedPngSnapshot.dpMap),
                    wcMap: new Map(importedPngSnapshot.wcMap),
                    nodeExactMatches: importedPngSnapshot.nodeExactMatches ? new Map(importedPngSnapshot.nodeExactMatches) : new Map()
                };
                logDebug("[Autocomplete++] Restored choices from imported PNG workflow into active execution snapshot.");
            }
        } catch (e) {
            console.warn("[Autocomplete++] Error applying imported PNG snapshot:", e);
        } finally {
            importedPngSnapshot = null;
        }
    }

    const isSeedSame = (
        lastExecutionSnapshot.masterSeed !== null &&
        masterSeed !== null &&
        masterSeed !== undefined &&
        String(lastExecutionSnapshot.masterSeed) === String(masterSeed)
    );
    const keepLastDP = (dpMode === "Keep Last Choice" && isSeedSame);
    const keepLastWC = (wcMode === "Keep Last Choice" && isSeedSame);

    const isSequential = wcMode === "Sequential";
    const wildcardFollowSeed = wcMode === "Follow Seed";
    const dpFollowSeed = dpMode === "Follow Seed";

    const wildcardRng = wildcardFollowSeed ? createSeededRng(masterSeed) : () => Math.random();
    const dpRng = dpFollowSeed ? createSeededRng(masterSeed) : () => Math.random();

    // Session cache ensures Pass 1, Hires.fix, ADetailer, and all CLIP nodes share identical choices
    const sessionCache = new Map();
    const currentExecutionSnapshot = {
        masterSeed,
        dpMap: new Map(),
        wcMap: new Map(),
        nodeExactMatches: lastExecutionSnapshot.nodeExactMatches ? new Map(lastExecutionSnapshot.nodeExactMatches) : new Map()
    };

    const expandOptions = {
        seed: masterSeed,
        isSequential,
        wcMode,
        dpMode,
        keepLastDP,
        keepLastWC,
        lastSnapshot: lastExecutionSnapshot,
        currentSnapshot: currentExecutionSnapshot,
        rng: dpRng,
        dpRng: dpRng,
        wildcardRng: wildcardRng,
        sessionCache
    };

    const wcModeLabel = isSequential ? "Sequential" : (wcMode === "Keep Last Choice" ? (keepLastWC ? "Keep Last (Reused)" : "Keep Last (New Roll)") : (wildcardFollowSeed ? "Follow Seed" : "Random"));
    const dpModeLabel = dpMode === "Keep Last Choice" ? (keepLastDP ? "Keep Last (Reused)" : "Keep Last (New Roll)") : (dpFollowSeed ? "Follow Seed" : "Random");
    logDebug(`[Autocomplete++] Prompt Expander active: Master Seed = ${masterSeed}, Wildcards = ${wcModeLabel}, DynamicPrompts = ${dpModeLabel}`);

    for (const nodeId of Object.keys(promptGraph)) {
        const node = promptGraph[nodeId];
        if (!node || !node.inputs || typeof node.inputs !== "object") continue;

        for (const inputKey of Object.keys(node.inputs)) {
            let val = node.inputs[inputKey];

            // If saved widget value is available, use the canvas template
            if (canvasGroundTruth) {
                const truthKey = nodeId + ":" + inputKey;
                if (canvasGroundTruth.has(truthKey)) {
                    val = canvasGroundTruth.get(truthKey);
                }
            }

            if (typeof val === "string") {
                const matchKey = `${nodeId}:${inputKey}`;
                const fastPathInfo = lastExecutionSnapshot.nodeExactMatches?.get(matchKey);
                const hasWildcards = val.includes("__");
                const canFastPath = fastPathInfo &&
                    keepLastDP &&
                    (!hasWildcards || keepLastWC) &&
                    (val.replace(/\r\n/g, "\n").trim() === fastPathInfo.template.replace(/\r\n/g, "\n").trim());

                if (canFastPath) {
                    logDebug(`[Autocomplete++] Node #${nodeId} (${node.class_type || "Node"}) [${inputKey}] Fast-Path Passthrough: original PNG executed prompt restored.`);
                    node.inputs[inputKey] = fastPathInfo.executed;
                    continue;
                }

                if (val.includes("{") || val.includes("__") || val.includes("//") || val.includes("/*")) {
                    const expanded = expandPromptString(val, expandOptions);
                    logDebug(`[Autocomplete++] Node #${nodeId} (${node.class_type || "Node"}) [${inputKey}] expanded: "${val}" -> "${expanded}"`);
                    node.inputs[inputKey] = expanded;
                }
            }
        }
    }

    const hasNewExpansions = (currentExecutionSnapshot.dpMap.size > 0 || currentExecutionSnapshot.wcMap.size > 0);
    if (hasNewExpansions || !isSeedSame) {
        lastExecutionSnapshot = currentExecutionSnapshot;
    }

    return payload;
}

export function setupPromptExpansionInterceptor() {
    loadAllWildcardData();

    if (typeof window !== "undefined") {
        const handleFileDrop = async (file) => {
            if (file && (file.type === "image/png" || file.name?.toLowerCase().endsWith(".png"))) {
                const parsed = await parsePngMetadata(file);
                if (parsed) pendingImportedPrompt = parsed;
            }
        };

        window.addEventListener("drop", (e) => {
            const file = e.dataTransfer?.files?.[0];
            if (file) handleFileDrop(file);
        }, true);

        window.addEventListener("paste", (e) => {
            const file = e.clipboardData?.files?.[0];
            if (file) handleFileDrop(file);
        }, true);

        if (typeof app !== "undefined" && app.handleFile) {
            const origHandleFile = app.handleFile.bind(app);
            app.handleFile = async function (file) {
                if (file) await handleFileDrop(file);
                return origHandleFile.apply(this, arguments);
            };
        }

        const origFetch = window.fetch;
        window.fetch = async function (...args) {
            const res = await origFetch.apply(this, args);
            try {
                const clone = res.clone();
                pendingImportedPromptPromise = clone.json().then(data => {
                    if (data && data.workflow && data.prompt) {
                        const parsed = typeof data.prompt === "string" ? JSON.parse(data.prompt) : data.prompt;
                        pendingImportedPrompt = parsed;
                        return parsed;
                    }
                    return null;
                }).catch(() => null);
            } catch (e) {}
            return res;
        };
    }

    // 1. Hook app.loadGraphData (Workflow import interception)
    if (typeof app !== "undefined" && app.loadGraphData) {
        const origLoadGraphData = app.loadGraphData.bind(app);
        app.loadGraphData = async function (graphData, clean, change_id, prompt) {
            try {
                let activePrompt = (prompt && typeof prompt === "object" && Object.keys(prompt).length > 0)
                    ? prompt
                    : pendingImportedPrompt;

                if (!activePrompt && pendingImportedPromptPromise) {
                    const sniffed = await pendingImportedPromptPromise;
                    if (sniffed) activePrompt = sniffed;
                }
                pendingImportedPrompt = null;
                pendingImportedPromptPromise = null;

                if (activePrompt && typeof activePrompt === "object" && Object.keys(activePrompt).length > 0 && graphData) {
                    importedPngSnapshot = extractChoicesFromWorkflowAndPrompt(graphData, activePrompt);
                    if (importedPngSnapshot) {
                        logDebug(`[Autocomplete++] Captured choices from imported workflow (Seed: ${importedPngSnapshot.masterSeed}, DP: ${importedPngSnapshot.dpMap.size}, WC: ${importedPngSnapshot.wcMap.size}).`);
                    }
                } else {
                    importedPngSnapshot = null;
                }
            } catch (err) {
                importedPngSnapshot = null;
            }
            return origLoadGraphData.apply(this, arguments);
        };
        logDebug("[Autocomplete++] Workflow load interceptor installed.");
    }

    // 2. Hook app.graphToPrompt (Source-level serialization interception)
    if (typeof app !== "undefined" && app.graphToPrompt) {
        const originalGraphToPrompt = app.graphToPrompt.bind(app);

        app.graphToPrompt = async function () {
            // Capture widget values directly from canvas before serialization
            const canvasGroundTruth = new Map();
            if (app.graph && Array.isArray(app.graph._nodes)) {
                for (const node of app.graph._nodes) {
                    if (node && Array.isArray(node.widgets)) {
                        for (const w of node.widgets) {
                            if (w && typeof w.value === "string" && w.name) {
                                canvasGroundTruth.set(node.id + ":" + w.name, w.value);
                            }
                        }
                    }
                }
            }

            const p = await originalGraphToPrompt.apply(this, arguments);

            try {
                if (p && (p.output || p.prompt)) {
                    processPromptPayload(p, canvasGroundTruth);
                    p._acPlusExpanded = true;
                }
            } catch (e) {
                console.error("[Autocomplete++] Error in graphToPrompt expansion hook:", e);
            }

            return p;
        };

        logDebug("[Autocomplete++] Source-level graphToPrompt expansion hook installed.");
    }

    // 2. Hook api.fetchApi (Network dispatch fallback interception)
    if (typeof api !== "undefined" && api.fetchApi) {
        const originalFetchApi = api.fetchApi.bind(api);

        api.fetchApi = function (route, options) {
            try {
                if (
                    route === "/prompt" ||
                    route === "prompt" ||
                    (typeof route === "string" && route.endsWith("/prompt"))
                ) {
                    if (options && options.method === "POST" && typeof options.body === "string") {
                        const parsed = JSON.parse(options.body);
                        if (!parsed._acPlusExpanded) {
                            const processed = processPromptPayload(parsed);
                            options.body = JSON.stringify(processed);
                        }
                    }
                }
            } catch (err) {
                console.error("[Autocomplete++] Error in fetchApi prompt expansion interceptor:", err);
            }

            return originalFetchApi(route, options);
        };

        logDebug("[Autocomplete++] Network-level fetchApi expansion interceptor installed.");
    }

    logDebug("[Autocomplete++] Wildcard & Dynamic Prompts execution interceptors installed.");
}
