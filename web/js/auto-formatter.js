import { app } from "/scripts/app.js";
import { settingValues } from "./settings.js";
import { getActiveControllerNode, notifyControllerInteracted } from "./main.js";

/**
 * Resolves the controller node for a given DOM textarea (Formatting Controller)
 */
export function getNodeForFormattingElement(element) {
    if (!element) return null;
    if (element.id) {
        const match = String(element.id).match(/^v-(\d+)-/);
        if (match) {
            const nodeId = Number(match[1]);
            const graph = app?.graph || app?.rootGraph || window.app?.graph;
            if (graph) {
                const node = graph.getNodeById ? graph.getNodeById(nodeId) : graph._nodes?.find(n => n.id === nodeId);
                if (node && (node.type === "AutocompletePlusFormattingController" || node.comfyClass === "AutocompletePlusFormattingController")) {
                    return node;
                }
            }
        }
    }
    return null;
}

/**
 * Checks if a DOM element is a keep_underscores_list textarea (node or settings)
 */
export function isKeepUnderscoresTextarea(element) {
    if (!element || element.tagName !== "TEXTAREA") return false;
    if (element.dataset?.acKeepUnderscores === "true" || element.getAttribute("data-ac-keep-underscores") === "true") {
        return true;
    }
    if (element.name === "keep_underscores_list") return true;
    if (element.id && String(element.id).includes("keep_underscores_list")) return true;

    const labelText = (element.previousElementSibling?.textContent || element.labels?.[0]?.textContent || "").trim();
    if (labelText === "keep_underscores_list" || labelText === "Keep Underscores for Tags") {
        return true;
    }

    return false;
}

/**
 * Synchronizes the visual and interactive disabled state of keep_underscores_list widget
 */
export function syncFormattingControllerWidgetState(node) {
    if (!node || !node.widgets) return;
    const modeWidget = node.widgets.find(w => w.name === "keep_underscores_mode");
    const listWidget = node.widgets.find(w => w.name === "keep_underscores_list");
    if (!modeWidget || !listWidget) return;

    const isEnabled = modeWidget.value === "Append to Global List" || modeWidget.value === "Override Global List";
    listWidget.disabled = !isEnabled;

    const textareas = new Set();
    if (listWidget.inputEl) textareas.add(listWidget.inputEl);
    if (listWidget.element) textareas.add(listWidget.element);
    if (node.id !== undefined) {
        document.querySelectorAll(`textarea[id^="v-${node.id}-"]`).forEach(t => {
            if (String(t.id).includes("keep_underscores_list") || t.name === "keep_underscores_list" || isKeepUnderscoresTextarea(t)) {
                textareas.add(t);
            }
        });
    }

    textareas.forEach(textarea => {
        textarea.disabled = !isEnabled;
        textarea.readOnly = !isEnabled;
        textarea.dataset.acKeepUnderscores = "true";
        if (!isEnabled) {
            textarea.classList.add("ac-widget-disabled");
            textarea.setAttribute("title", "Set keep_underscores_mode to 'Append to Global List' or 'Override Global List' to edit this list.");
        } else {
            textarea.classList.remove("ac-widget-disabled");
            textarea.removeAttribute("title");
        }
    });

    if (node.setDirtyCanvas) {
        node.setDirtyCanvas(true, true);
    }
}

/**
 * Setup lifecycle hooks on nodeType for AutocompletePlusFormattingController
 */
export function setupFormattingControllerNodeHooks(nodeType, nodeData) {
    if (nodeData?.name === "AutocompletePlusFormattingController") {
        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function() {
            const r = origOnNodeCreated ? origOnNodeCreated.apply(this, arguments) : undefined;
            setupFormattingNodeCallbacks(this);
            return r;
        };

        const origOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function() {
            const r = origOnConfigure ? origOnConfigure.apply(this, arguments) : undefined;
            setupFormattingNodeCallbacks(this);
            return r;
        };
    }
}

function setupFormattingNodeCallbacks(node) {
    if (!node || !node.widgets) return;

    node.widgets.forEach(widget => {
        const origCb = widget.callback;
        widget.callback = function() {
            const r = origCb ? origCb.apply(this, arguments) : undefined;
            notifyControllerInteracted(node);
            syncFormattingControllerWidgetState(node);
            return r;
        };
    });
    syncFormattingControllerWidgetState(node);
    setTimeout(() => syncFormattingControllerWidgetState(node), 80);
    setTimeout(() => syncFormattingControllerWidgetState(node), 300);
}

export function getCanvasFormattingOverrides() {
    const overrides = {
        hasController: false,
        animaArtistMode: "Default (From Settings)",
        autoFormatOnBlur: "Default (From Settings)",
        formatSpaceAfterComma: "Default (From Settings)",
        formatTrimPromptEndComma: "Default (From Settings)",
        formatTrimLineEndComma: "Default (From Settings)",
        formatReplaceUnderscore: "Default (From Settings)",
        escapeParentheses: "Default (From Settings)",
        autoInsertComma: "Default (From Settings)",
        replaceUnderscore: "Default (From Settings)",
        keepUnderscoresMode: "Default (From Settings)",
        keepUnderscoresList: ""
    };

    const node = getActiveControllerNode("AutocompletePlusFormattingController");
    if (node) {
        overrides.hasController = true;

        if (node.widgets && Array.isArray(node.widgets)) {
            for (const w of node.widgets) {
                if (w.name === "anima_artist_mode") overrides.animaArtistMode = w.value || "Default (From Settings)";
                else if (w.name === "auto_format_on_blur") overrides.autoFormatOnBlur = w.value || "Default (From Settings)";
                else if (w.name === "format_space_after_comma") overrides.formatSpaceAfterComma = w.value || "Default (From Settings)";
                else if (w.name === "format_trim_prompt_end_comma") overrides.formatTrimPromptEndComma = w.value || "Default (From Settings)";
                else if (w.name === "format_trim_line_end_comma") overrides.formatTrimLineEndComma = w.value || "Default (From Settings)";
                else if (w.name === "format_replace_underscore") overrides.formatReplaceUnderscore = w.value || "Default (From Settings)";
                else if (w.name === "escape_parentheses") overrides.escapeParentheses = w.value || "Default (From Settings)";
                else if (w.name === "auto_insert_comma") overrides.autoInsertComma = w.value || "Default (From Settings)";
                else if (w.name === "replace_underscore") overrides.replaceUnderscore = w.value || "Default (From Settings)";
                else if (w.name === "keep_underscores_mode") overrides.keepUnderscoresMode = w.value || "Default (From Settings)";
                else if (w.name === "keep_underscores_list") overrides.keepUnderscoresList = typeof w.value === "string" ? w.value : "";
            }
        }
    }

    return overrides;
}

export function getEffectiveFormattingSettings(baseSettings = settingValues) {
    const overrides = getCanvasFormattingOverrides();
    if (!overrides.hasController) {
        return baseSettings;
    }

    const effective = { ...baseSettings };

    const resolveBool = (overrideVal, baseVal) => {
        if (overrideVal === "Enabled") return true;
        if (overrideVal === "Disabled") return false;
        return baseVal;
    };

    if (overrides.animaArtistMode === "Enabled" || overrides.animaArtistMode === "Disabled") {
        effective.animaArtistMode = overrides.animaArtistMode;
    }
    effective.autoFormatOnBlur = resolveBool(overrides.autoFormatOnBlur, baseSettings.autoFormatOnBlur);
    effective.formatSpaceAfterComma = resolveBool(overrides.formatSpaceAfterComma, baseSettings.formatSpaceAfterComma);
    effective.formatTrimPromptEndComma = resolveBool(overrides.formatTrimPromptEndComma, baseSettings.formatTrimPromptEndComma);
    effective.formatTrimLineEndComma = resolveBool(overrides.formatTrimLineEndComma, baseSettings.formatTrimLineEndComma);
    effective.formatReplaceUnderscore = resolveBool(overrides.formatReplaceUnderscore, baseSettings.formatReplaceUnderscore);
    effective.escapeParentheses = resolveBool(overrides.escapeParentheses, baseSettings.escapeParentheses);
    effective.autoInsertComma = resolveBool(overrides.autoInsertComma, baseSettings.autoInsertComma);
    effective.replaceUnderscore = resolveBool(overrides.replaceUnderscore, baseSettings.replaceUnderscore);

    const globalList = baseSettings.formatKeepUnderscoresList || "";
    const nodeCustomList = overrides.keepUnderscoresList || "";

    if (overrides.keepUnderscoresMode === "Override Global List") {
        effective.formatKeepUnderscoresList = nodeCustomList;
    } else if (overrides.keepUnderscoresMode === "Append to Global List") {
        effective.formatKeepUnderscoresList = [globalList, nodeCustomList].filter(Boolean).join(", ");
    } else {
        // "Default (From Settings)"
        effective.formatKeepUnderscoresList = globalList;
    }

    return effective;
}

function isEmoticonOrKaomoji(token) {
    const raw = token.trim();
    if (!raw) return false;
    
    // Strip escape backslashes first for clean pattern matching (e.g. \(o_o\) -> (o_o), \^_\\^ -> ^_^)
    const clean = raw.replace(/\\/g, "");
    if (!clean) return false;

    // 1. Symbol-only patterns (no letters or numbers, e.g. ^_^, >_<, ;_;, ._., =_=, -_-, |_|, :|, ;|)
    if (!/[a-zA-Z0-9]/.test(clean)) {
        return true;
    }

    // 2. Bracketed Kaomoji with outer symbols (e.g. (^_^), (>_<), (o_o), [T_T], {o_o}, (=^.^=)) without English words
    if (/^[\(\[\{].*[\)\]\}]$/.test(clean) && !/[a-zA-Z]{3,}/.test(clean)) {
        return true;
    }

    // 3. Known ASCII / Digit eye emoticons with underscore (e.g. o_o, O_o, o_O, T_T, t_t, x_x, X_X, u_u, q_q, v_v, n_n, p_p, 0_0, 3_3)
    if (/^[0369oOTtXxUuQqVvNnPp]_[0369oOTtXxUuQqVvNnPp][;!]?$/.test(clean)) {
        return true;
    }

    // 4. Short mixed kaomojis / emoticons (<= 8 chars) containing distinctive face symbols (e.g. ^, >, <, ;, ~, @, =, *, |, ô, ò, ಠ, ಥ)
    // Examples: >_o, o_>, ô_o, o_ô, ಠ_ಠ, ಥ_ಥ, o_o;, ^_^b, <o>_<o>, <|>_<|>
    if (clean.length <= 8 && !/[a-zA-Z]{3,}/.test(clean)) {
        if (/[\^=@*~;:<>\.\|+#'!?òóôಠಥ]/.test(clean)) {
            return true;
        }
    }

    return false;
}

export function buildUnderscoreExclusionSet(rawList) {
    const exclusionSet = new Set();
    if (rawList && typeof rawList === "string") {
        rawList
            .split(/[,;\n]/)
            .map(s => s.trim().toLowerCase().replace(/\\/g, ""))
            .filter(Boolean)
            .forEach(item => exclusionSet.add(item));
    }
    return exclusionSet;
}

export function formatTagUnderscores(tag, exclusionSet = null) {
    const trimmed = tag.trim();
    if (!trimmed) return tag;

    // 1. Wildcard calls (e.g. __wildcard__ or __path/to/file__)
    if (trimmed.startsWith("__") || trimmed.endsWith("__")) {
        return tag;
    }

    // 2. LoRA / Embedding syntax (<lora:name:1.0>, embedding:name)
    if (trimmed.startsWith("<") || trimmed.toLowerCase().startsWith("embedding:") || trimmed.toLowerCase().startsWith("emb:")) {
        return tag;
    }

    // 3. Slash filter commands (/danbooru, /artist)
    if (trimmed.startsWith("/")) {
        return tag;
    }

    // 4. Emoticons and Kaomojis
    if (isEmoticonOrKaomoji(trimmed)) {
        return tag;
    }

    // 5. User custom excluded tags (case-insensitive check)
    if (exclusionSet && (exclusionSet.has(trimmed.toLowerCase().replace(/\\/g, "")) || exclusionSet.has(trimmed.toLowerCase()))) {
        return tag;
    }

    // 6. If the segment contains space-separated tokens (e.g. "1girl blue_hair |_|"), format each token individually
    if (trimmed.includes(" ")) {
        const tokens = tag.split(/(\s+)/);
        const formatted = tokens.map(tok => {
            if (/^\s+$/.test(tok) || !tok) return tok;
            return formatTagUnderscores(tok, exclusionSet);
        });
        return formatted.join("");
    }

    // 7. Replace underscores with spaces for standard atomic tag
    return tag.replace(/_/g, " ");
}

export function formatPromptText(text, settings) {
    if (!text || typeof text !== "string") return text;
    if (!settings || !settings.autoFormatOnBlur) return text;

    // Build exclusion Set for underscore protection
    const exclusionSet = buildUnderscoreExclusionSet(settings.formatKeepUnderscoresList);

    // Process line by line to preserve user line breaks and structure
    const lines = text.split(/\r?\n/);
    const formattedLines = [];

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // Skip completely empty lines
        if (line.trim().length === 0) {
            formattedLines.push(line);
            continue;
        }

        // Collapse duplicate commas into a single comma
        line = line.replace(/(?:,\s*)+,/g, ",");

        // 1. Space after comma (1girl,solo,smile -> 1girl, solo, smile)
        if (settings.formatSpaceAfterComma) {
            line = line.replace(/,(?!\s*$)\s*/g, ", ");
        }

        // 2. Replace underscores with spaces (respecting exclusions)
        if (settings.formatReplaceUnderscore) {
            // Format options and sub-tags inside Dynamic Prompts { ... } containers first
            if (line.includes("{") && line.includes("}")) {
                line = line.replace(/\{([^{}]+)\}/g, (fullMatch, inner) => {
                    const options = inner.split(/\|/);
                    const formattedOptions = options.map(opt => {
                        const tags = opt.split(/,/);
                        const formattedTags = tags.map(tag => {
                            const match = tag.match(/^(\s*)(.*?)(\s*)$/);
                            if (!match) return tag;
                            const [, leading, content, trailing] = match;
                            return leading + formatTagUnderscores(content, exclusionSet) + trailing;
                        });
                        return formattedTags.join(",");
                    });
                    return "{" + formattedOptions.join("|") + "}";
                });
            }

            // Protect Dynamic Prompts blocks from outer comma splitting
            const dpPlaceholders = [];
            let safeLine = line.replace(/\{[^{}]+\}/g, match => {
                dpPlaceholders.push(match);
                return `___DP_FMT_BLOCK_${dpPlaceholders.length - 1}___`;
            });

            // Split outer line by commas, format each segment, and rejoin
            const segments = safeLine.split(/,/);
            const formattedSegments = segments.map(seg => {
                const match = seg.match(/^(\s*)(.*?)(\s*)$/);
                if (!match) return seg;
                const [, leading, content, trailing] = match;
                return leading + formatTagUnderscores(content, exclusionSet) + trailing;
            });
            safeLine = formattedSegments.join(",");

            // Restore Dynamic Prompts blocks
            line = safeLine.replace(/___DP_FMT_BLOCK_(\d+)___/g, (_, idx) => dpPlaceholders[parseInt(idx, 10)]);
        }

        // 3. Trim trailing commas at line ends
        if (settings.formatTrimLineEndComma) {
            line = line.replace(/,[\s]*$/, "");
        }

        formattedLines.push(line);
    }

    let result = formattedLines.join("\n");

    // 4. Trim trailing comma at the very end of the entire prompt
    if (settings.formatTrimPromptEndComma) {
        result = result.replace(/,[\s\r\n]*$/, "");
    }

    return result;
}

export function formatTextareaOnBlur(textarea, settings = null) {
    if (!textarea || textarea.tagName !== "TEXTAREA" || textarea.readOnly) return;
    const baseEffective = getEffectiveFormattingSettings(settings || settingValues);
    if (!baseEffective || !baseEffective.autoFormatOnBlur) return;

    // Clone effective settings so we can safely override per-textarea
    const effective = { ...baseEffective };

    // Keep Underscores settings textarea is exempt from underscore replacement
    if (isKeepUnderscoresTextarea(textarea)) {
        effective.formatReplaceUnderscore = false;
    }

    const originalText = textarea.value;
    const formattedText = formatPromptText(originalText, effective);

    if (formattedText !== originalText) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;

        textarea.value = formattedText;

        // Restore selection safely
        if (typeof start === "number" && typeof end === "number") {
            const newStart = Math.min(start, formattedText.length);
            const newEnd = Math.min(end, formattedText.length);
            textarea.setSelectionRange(newStart, newEnd);
        }

        // Dispatch input and change events so ComfyUI / LiteGraph saves the new state
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
    }
}
