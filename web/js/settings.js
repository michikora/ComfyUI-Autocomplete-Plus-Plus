// Settings definitions and state management for ComfyUI-Autocomplete-Plus-Plus
 
export const id = "ComfyUI.AutocompletePlusPlus";
export const name = "Autocomplete++";

export const settingValues = {
    enabled: true,
    keyAcceptTab: true,
    keyAcceptEnter: true,
    ignoredNodeTypes: "",
    overrideNodeTypes: "",
    tagFile: "danbooru.csv",
    extraFiles: "",
    translationFile: "None",
    searchTranslation: true,
    showTranslations: true,
    oldFormat: false,
    showWikiLinks: true,
    previewPosition: "Left",
    loraManagerMode: "Auto",
    loraPathMode: "Auto",
    enableModels: true,
    animaArtistMode: "Auto",
    replaceUnderscore: true,
    escapeParentheses: true,
    frequencySort: true,
    favorMinCount: 5,
    favorMaxAge: 30,
    favorMaxTags: 10000,
    autoFormatOnBlur: true,
    formatSpaceAfterComma: true,
    formatTrimPromptEndComma: true,
    formatTrimLineEndComma: false,
    formatReplaceUnderscore: true,
    formatKeepUnderscoresList: "",
    autoInsertComma: true,
    maxSuggestions: 15,
    enablePromptExpansion: true,
    wildcardMode: "Random",
    dynamicPromptMode: "Random",
    enableHotkeyEnhance: true,
    enableTagWeightHotkey: true,
    enableTagJumpHotkey: true,
    enableTagSwapHotkey: true,
    tagWeightStep: 0.05,
    loraWeightStep: 0.05,
    enableConsoleDebugLogs: false,
};

// Persisted setting loader from localStorage
function loadSetting(key, fallback, isNumber = false) {
    try {
        const saved = localStorage.getItem("Comfy.Settings." + id + "." + key);
        if (saved !== null) {
            const parsed = JSON.parse(saved);
            return isNumber ? Number(parsed) : parsed;
        }
    } catch (_) {}
    return fallback;
}

// Dual-write helper: saves to localStorage and synchronizes to backend user_data.json
export function persistSetting(key, value) {
    try {
        localStorage.setItem("Comfy.Settings." + id + "." + key, JSON.stringify(value));
    } catch (_) {}
    try {
        fetch("/autocomplete-plus-plus/user-data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "save_settings",
                settings: { [key]: value },
                timestamp: Date.now()
            })
        }).catch(() => {});
    } catch (_) {}
}

// Centralized frontend debug logger (suppressed when enableConsoleDebugLogs is false)
export function logDebug(...args) {
    if (settingValues.enableConsoleDebugLogs) {
        console.log(...args);
    }
}

// Global ComfyUI theme luminance detector (determines if UI is running in light theme)
export function isComfyThemeLight() {
    try {
        if (typeof document === "undefined") return false;
        if (
            document.body.classList.contains("light-theme") ||
            document.body.dataset.theme === "light" ||
            document.documentElement.classList.contains("light") ||
            document.documentElement.dataset.theme === "light" ||
            document.querySelector(".comfy-theme-light") !== null
        ) {
            return true;
        }

        const bodyStyle = window.getComputedStyle(document.body);
        const menuBg = bodyStyle.getPropertyValue("--comfy-menu-bg") ||
                       bodyStyle.getPropertyValue("--bg-color") ||
                       bodyStyle.backgroundColor || "";

        if (menuBg) {
            const tempEl = document.createElement("div");
            tempEl.style.color = menuBg.trim();
            document.body.appendChild(tempEl);
            const rgbColor = window.getComputedStyle(tempEl).color;
            document.body.removeChild(tempEl);

            const rgb = rgbColor.match(/\d+/g);
            if (rgb && rgb.length >= 3) {
                const r = parseInt(rgb[0], 10);
                const g = parseInt(rgb[1], 10);
                const b = parseInt(rgb[2], 10);
                const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                if (lum > 0.55) return true;
            }
        }
    } catch (_) {}
    return false;
}

// Restore persisted settings from localStorage
try {
    settingValues.enabled = loadSetting("Enabled", true);
    settingValues.keyAcceptTab = loadSetting("KeyAcceptTab", true);
    settingValues.keyAcceptEnter = loadSetting("KeyAcceptEnter", true);
    settingValues.ignoredNodeTypes = loadSetting("IgnoredNodeTypes", "");
    settingValues.overrideNodeTypes = loadSetting("OverrideNodeTypes", "");
    settingValues.tagFile = loadSetting("TagFile", "danbooru.csv");
    settingValues.extraFiles = loadSetting("ExtraFiles", "");
    settingValues.translationFile = loadSetting("TranslationFile", "None");
    settingValues.searchTranslation = loadSetting("SearchTranslation", true);
    settingValues.showTranslations = loadSetting("ShowTranslations", true);
    settingValues.oldFormat = loadSetting("TranslationOldFormat", false);
    settingValues.showWikiLinks = loadSetting("ShowWikiLinks", true);
    settingValues.previewPosition = loadSetting("PreviewPosition", "Left");
    settingValues.loraManagerMode = loadSetting("LoraManagerMode", "Auto");
    settingValues.loraPathMode = loadSetting("LoraPathMode", "Auto");
    settingValues.enableModels = loadSetting("EnableModels", true);
    settingValues.animaArtistMode = loadSetting("AnimaArtistMode", "Auto");
    settingValues.replaceUnderscore = loadSetting("ReplaceUnderscore", true);
    settingValues.escapeParentheses = loadSetting("EscapeParentheses", true);
    settingValues.frequencySort = loadSetting("FrequencySort", true);
    settingValues.favorMinCount = loadSetting("FavorMinCount", 5, true);
    settingValues.favorMaxAge = loadSetting("FavorMaxAge", 30, true);
    settingValues.favorMaxTags = loadSetting("FavorMaxTags", 10000, true);
    settingValues.autoFormatOnBlur = loadSetting("AutoFormatOnBlur", true);
    settingValues.formatSpaceAfterComma = loadSetting("FormatSpaceAfterComma", true);
    settingValues.formatTrimPromptEndComma = loadSetting("FormatTrimPromptEndComma", true);
    settingValues.formatTrimLineEndComma = loadSetting("FormatTrimLineEndComma", false);
    settingValues.formatReplaceUnderscore = loadSetting("FormatReplaceUnderscore", true);
    settingValues.formatKeepUnderscoresList = loadSetting("FormatKeepUnderscoresList", "");
    settingValues.autoInsertComma = loadSetting("AutoInsertComma", true);
    settingValues.maxSuggestions = loadSetting("MaxSuggestions", 15, true);
    settingValues.enablePromptExpansion = loadSetting("EnablePromptExpansion", true);

    // Load WildcardMode with backward compatibility
    let savedWcMode = loadSetting("WildcardMode", null);
    if (!savedWcMode) {
        const legacyWcSeed = loadSetting("WildcardFollowSeed", false);
        const legacyWcSeq = loadSetting("WildcardSequential", false);
        if (legacyWcSeq) savedWcMode = "Sequential";
        else if (legacyWcSeed) savedWcMode = "Follow Seed";
        else savedWcMode = "Random";
    }
    settingValues.wildcardMode = savedWcMode;

    // Load DynamicPromptMode with backward compatibility
    let savedDpMode = loadSetting("DynamicPromptMode", null);
    if (!savedDpMode) {
        const legacyDpSeed = loadSetting("DynamicPromptFollowSeed", false);
        if (legacyDpSeed) savedDpMode = "Follow Seed";
        else savedDpMode = "Random";
    }
    settingValues.dynamicPromptMode = savedDpMode;

    settingValues.enableHotkeyEnhance = loadSetting("EnableHotkeyEnhance", true);
    settingValues.enableTagWeightHotkey = loadSetting("EnableTagWeightHotkey", true);
    settingValues.enableTagJumpHotkey = loadSetting("EnableTagJumpHotkey", true);
    settingValues.enableTagSwapHotkey = loadSetting("EnableTagSwapHotkey", true);
    settingValues.tagWeightStep = loadSetting("TagWeightStep", 0.05, true);
    settingValues.loraWeightStep = loadSetting("LoraWeightStep", 0.05, true);
    settingValues.enableConsoleDebugLogs = loadSetting("EnableConsoleDebugLogs", false);
} catch (_) {}

export let availableTagFiles = [];
export let availableTranslationFiles = ["None"];

export async function refreshAvailableFiles() {
    try {
        const resp = await fetch("/autocomplete-plus-plus/tags/list");
        if (resp.ok) {
            const data = await resp.json();
            
            availableTagFiles.length = 0;
            if (Array.isArray(data.tags) && data.tags.length > 0) {
                availableTagFiles.push(...data.tags);
            } else if (Array.isArray(data.all_csvs) && data.all_csvs.length > 0) {
                availableTagFiles.push(...data.all_csvs);
            } else if (Array.isArray(data.files) && data.files.length > 0) {
                availableTagFiles.push(...data.files.map(f => typeof f === "string" ? f : f.filename));
            }

            availableTranslationFiles.length = 0;
            if (Array.isArray(data.translations) && data.translations.length > 0) {
                availableTranslationFiles.push(...data.translations);
            } else if (Array.isArray(data.all_csvs) && data.all_csvs.length > 0) {
                availableTranslationFiles.push("None", ...data.all_csvs.filter(f => f !== "None"));
            } else if (Array.isArray(data.files) && data.files.length > 0) {
                availableTranslationFiles.push("None", ...data.files.map(f => typeof f === "string" ? f : f.filename));
            } else {
                availableTranslationFiles.push("None");
            }
        }
    } catch (e) {
        console.warn("[Autocomplete++] Failed to fetch tag file list:", e);
    }
}

function createConfirmButton(defaultText, confirmPrefix, doneText, onConfirm) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "p-button p-component text-sm font-medium transition-all rounded-md px-3 py-1.5 border";
    btn.style.cursor = "pointer";
    btn.style.fontSize = "12px";
    btn.style.lineHeight = "1.4";
    btn.style.backgroundColor = "rgba(255, 82, 82, 0.12)";
    btn.style.color = "#ff5252";
    btn.style.borderColor = "rgba(255, 82, 82, 0.4)";
    btn.textContent = defaultText;

    let confirmState = false;
    let countdownInterval = null;
    let secondsLeft = 3;

    const resetToDefault = () => {
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
        confirmState = false;
        secondsLeft = 3;
        btn.textContent = defaultText;
        btn.style.backgroundColor = "rgba(255, 82, 82, 0.12)";
        btn.style.color = "#ff5252";
        btn.style.borderColor = "rgba(255, 82, 82, 0.4)";
    };

    btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (!confirmState) {
            confirmState = true;
            secondsLeft = 3;
            btn.textContent = `${confirmPrefix} (${secondsLeft}s)`;
            btn.style.backgroundColor = "#ff5252";
            btn.style.color = "#ffffff";
            btn.style.borderColor = "#ff5252";

            countdownInterval = setInterval(() => {
                secondsLeft--;
                if (secondsLeft > 0) {
                    btn.textContent = `${confirmPrefix} (${secondsLeft}s)`;
                } else {
                    resetToDefault();
                }
            }, 1000);
        } else {
            if (countdownInterval) {
                clearInterval(countdownInterval);
                countdownInterval = null;
            }
            confirmState = false;
            onConfirm();
            btn.textContent = doneText;
            btn.style.backgroundColor = "rgba(52, 211, 153, 0.2)";
            btn.style.color = "#34d399";
            btn.style.borderColor = "rgba(52, 211, 153, 0.5)";

            setTimeout(() => {
                resetToDefault();
            }, 1500);
        }
    });

    return btn;
}

function createToggleSwitch(initialChecked, onChange) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.role = "switch";
    btn.className = "group inline-flex h-6 w-10 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full border-0 bg-transparent p-0 transition-shadow outline-none focus-visible:ring-1 focus-visible:ring-border-default";
    btn.setAttribute("aria-checked", String(initialChecked));
    btn.setAttribute("data-state", initialChecked ? "checked" : "unchecked");
    btn.value = initialChecked ? "on" : "off";

    const track = document.createElement("span");
    track.className = "pointer-events-none inline-flex h-5 w-9 items-center rounded-full border border-transparent bg-interface-stroke px-0.5 transition-colors group-data-[state=checked]:bg-primary-background";

    const thumb = document.createElement("span");
    thumb.className = "pointer-events-none block size-4 rounded-full bg-base-background shadow-sm transition-transform data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0";
    thumb.setAttribute("data-state", initialChecked ? "checked" : "unchecked");

    track.appendChild(thumb);
    btn.appendChild(track);

    btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const nextState = btn.getAttribute("data-state") !== "checked";
        btn.setAttribute("data-state", nextState ? "checked" : "unchecked");
        btn.setAttribute("aria-checked", String(nextState));
        btn.value = nextState ? "on" : "off";
        thumb.setAttribute("data-state", nextState ? "checked" : "unchecked");
        onChange(nextState);
    });

    return btn;
}

function createMultiSelectDropdown(initialValue, getAvailableOptions, onChange) {
    const rootContainer = document.createElement("div");
    rootContainer.className = "form-input flex justify-end relative";

    let selectedSet = new Set(
        (initialValue || "")
            .split(",")
            .map(s => s.trim())
            .filter(Boolean)
    );

    const selectRoot = document.createElement("div");
    selectRoot.className = "p-select p-component p-inputwrapper p-inputwrapper-filled cursor-pointer select-none";
    selectRoot.setAttribute("data-pc-name", "select");
    selectRoot.setAttribute("data-pc-section", "root");

    const selectLabel = document.createElement("span");
    selectLabel.className = "p-select-label";
    selectLabel.setAttribute("tabindex", "0");
    selectLabel.setAttribute("role", "combobox");
    selectLabel.setAttribute("aria-haspopup", "listbox");
    selectLabel.setAttribute("data-pc-section", "label");

    const dropdownIconContainer = document.createElement("div");
    dropdownIconContainer.className = "p-select-dropdown";
    dropdownIconContainer.setAttribute("data-pc-section", "dropdown");

    const svgIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgIcon.setAttribute("width", "14");
    svgIcon.setAttribute("height", "14");
    svgIcon.setAttribute("viewBox", "0 0 14 14");
    svgIcon.setAttribute("fill", "none");
    svgIcon.setAttribute("class", "p-icon p-select-dropdown-icon");
    svgIcon.setAttribute("aria-hidden", "true");
    svgIcon.setAttribute("data-pc-section", "dropdownicon");

    const svgPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svgPath.setAttribute("d", "M7.01744 10.398C6.91269 10.3985 6.8089 10.378 6.71215 10.3379C6.61541 10.2977 6.52766 10.2386 6.45405 10.1641L1.13907 4.84913C1.03306 4.69404 0.985221 4.5065 1.00399 4.31958C1.02276 4.13266 1.10693 3.95838 1.24166 3.82747C1.37639 3.69655 1.55301 3.61742 1.74039 3.60402C1.92777 3.59062 2.11386 3.64382 2.26584 3.75424L7.01744 8.47394L11.769 3.75424C11.9189 3.65709 12.097 3.61306 12.2748 3.62921C12.4527 3.64535 12.6199 3.72073 12.7498 3.84328C12.8797 3.96582 12.9647 4.12842 12.9912 4.30502C13.0177 4.48162 12.9841 4.662 12.8958 4.81724L7.58083 10.1322C7.50996 10.2125 7.42344 10.2775 7.32656 10.3232C7.22968 10.3689 7.12449 10.3944 7.01744 10.398Z");
    svgPath.setAttribute("fill", "currentColor");
    svgIcon.appendChild(svgPath);
    dropdownIconContainer.appendChild(svgIcon);

    selectRoot.appendChild(selectLabel);
    selectRoot.appendChild(dropdownIconContainer);
    rootContainer.appendChild(selectRoot);

    const overlayPanel = document.createElement("div");
    overlayPanel.className = "p-select-overlay p-component";
    overlayPanel.setAttribute("data-pc-section", "overlay");
    overlayPanel.style.position = "absolute";
    overlayPanel.style.top = "calc(100% + 4px)";
    overlayPanel.style.right = "0";
    overlayPanel.style.minWidth = "100%";
    overlayPanel.style.zIndex = "3503";
    overlayPanel.style.display = "none";

    const listContainer = document.createElement("div");
    listContainer.className = "p-select-list-container";
    listContainer.setAttribute("data-pc-section", "listcontainer");
    listContainer.style.maxHeight = "14rem";
    listContainer.style.overflowY = "auto";

    const listUl = document.createElement("ul");
    listUl.className = "p-select-list";
    listUl.setAttribute("role", "listbox");
    listUl.setAttribute("data-pc-section", "list");

    listContainer.appendChild(listUl);
    overlayPanel.appendChild(listContainer);
    rootContainer.appendChild(overlayPanel);

    const updateTriggerText = () => {
        const arr = Array.from(selectedSet);
        if (arr.length === 0) {
            selectLabel.textContent = "None (Select extra files...)";
            selectLabel.classList.add("p-placeholder");
        } else {
            selectLabel.textContent = arr.join(", ");
            selectLabel.classList.remove("p-placeholder");
        }
    };

    const renderOptions = () => {
        listUl.innerHTML = "";
        const allOptions = getAvailableOptions();

        if (allOptions.length === 0) {
            const emptyLi = document.createElement("li");
            emptyLi.className = "p-select-option p-disabled p-select-empty-message";
            emptyLi.style.padding = "0.5rem 0.75rem";
            emptyLi.style.opacity = "0.6";
            emptyLi.style.fontStyle = "italic";
            emptyLi.textContent = "No extra CSV files available in tags/";
            listUl.appendChild(emptyLi);
            return;
        }

        allOptions.forEach((opt) => {
            const isChecked = selectedSet.has(opt);
            const li = document.createElement("li");
            li.className = isChecked
                ? "p-select-option p-select-option-selected p-focus flex items-center gap-2 cursor-pointer select-none"
                : "p-select-option flex items-center gap-2 cursor-pointer select-none";
            li.setAttribute("role", "option");
            li.setAttribute("aria-label", opt);
            li.setAttribute("aria-selected", isChecked ? "true" : "false");
            li.setAttribute("data-p-selected", isChecked ? "true" : "false");
            li.setAttribute("data-pc-section", "option");

            const checkboxBox = document.createElement("div");
            checkboxBox.className = "p-checkbox p-component shrink-0 pointer-events-none";
            checkboxBox.setAttribute("data-pc-section", "checkbox");

            const checkboxInner = document.createElement("div");
            checkboxInner.className = isChecked
                ? "p-checkbox-box p-highlight"
                : "p-checkbox-box border border-interface-stroke";
            checkboxInner.style.width = "14px";
            checkboxInner.style.height = "14px";
            checkboxInner.style.borderRadius = "3px";
            checkboxInner.style.display = "flex";
            checkboxInner.style.alignItems = "center";
            checkboxInner.style.justifyContent = "center";

            if (isChecked) {
                const checkSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                checkSvg.setAttribute("width", "10");
                checkSvg.setAttribute("height", "8");
                checkSvg.setAttribute("viewBox", "0 0 14 10");
                checkSvg.setAttribute("fill", "none");
                checkSvg.setAttribute("class", "p-icon p-checkbox-icon");
                checkSvg.setAttribute("aria-hidden", "true");
                const checkPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
                checkPath.setAttribute("d", "M4.75 8.125L1.375 4.75L0.25 5.875L4.75 10.375L13.75 1.375L12.625 0.25L4.75 8.125Z");
                checkPath.setAttribute("fill", "currentColor");
                checkSvg.appendChild(checkPath);
                checkboxInner.appendChild(checkSvg);
            }

            checkboxBox.appendChild(checkboxInner);

            const optLabel = document.createElement("span");
            optLabel.className = "p-select-option-label truncate flex-1";
            optLabel.setAttribute("data-pc-section", "optionlabel");
            optLabel.textContent = opt;

            li.appendChild(checkboxBox);
            li.appendChild(optLabel);

            li.addEventListener("click", (e) => {
                e.stopPropagation();
                if (selectedSet.has(opt)) {
                    selectedSet.delete(opt);
                } else {
                    selectedSet.add(opt);
                }
                const newJoined = Array.from(selectedSet).join(", ");
                updateTriggerText();
                renderOptions();
                onChange(newJoined);
            });

            listUl.appendChild(li);
        });
    };

    let isOpen = false;
    const openDropdown = () => {
        isOpen = true;
        renderOptions();
        overlayPanel.style.display = "block";
        selectRoot.classList.add("p-inputwrapper-focus", "p-select-open");
    };

    const closeDropdown = () => {
        isOpen = false;
        overlayPanel.style.display = "none";
        selectRoot.classList.remove("p-inputwrapper-focus", "p-select-open");
    };

    selectRoot.addEventListener("click", (e) => {
        e.stopPropagation();
        if (isOpen) closeDropdown();
        else openDropdown();
    });

    document.addEventListener("click", (e) => {
        if (isOpen && !rootContainer.contains(e.target)) {
            closeDropdown();
        }
    });

    updateTriggerText();
    return rootContainer;
}

export function registerSettings(app) {
    app.ui.settings.addSetting({
        id: id + ".EnableConsoleDebugLogs",
        name: "Enable Console Debug Logs",
        tooltip: "Print detailed internal diagnostic, wildcard/dynamic prompt expansion, and lifecycle logs to the browser DevTools (F12) console.",
        type: "boolean",
        defaultValue: settingValues.enableConsoleDebugLogs,
        category: [name, "Autocomplete", "Enable Console Debug Logs"],
        onChange: (newVal) => {
            settingValues.enableConsoleDebugLogs = !!newVal;
            persistSetting("EnableConsoleDebugLogs", settingValues.enableConsoleDebugLogs);
        }
    });

    app.ui.settings.addSetting({
        id: id + ".OverrideNodeTypes",
        name: "Override Nodes",
        tooltip: "Comma-separated list of node type full names or keywords to prioritize Autocomplete++ on (suppressing conflicting built-in popups on those specific nodes).",
        type: () => {
            const container = document.createElement("div");
            container.className = "flex w-full flex-col gap-1.5";
            container.style.width = "100%";
            container.style.minWidth = "220px";

            const textarea = document.createElement("textarea");
            textarea.className = "w-full rounded-md border border-interface-stroke bg-base-background p-2 text-sm text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-default resize-y";
            textarea.rows = 3;
            textarea.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
            textarea.style.fontSize = "12px";
            textarea.placeholder = "e.g. CustomPromptNode, PresetTextNode...";
            textarea.value = settingValues.overrideNodeTypes || "";

            textarea.addEventListener("input", (e) => {
                settingValues.overrideNodeTypes = e.target.value;
                persistSetting("OverrideNodeTypes", e.target.value);
            });

            window.addEventListener("tagcomplete-override-nodes-updated", (e) => {
                if (e.detail !== undefined) {
                    textarea.value = e.detail;
                }
            });

            container.appendChild(textarea);
            return container;
        },
        defaultValue: "",
        category: [name, "Autocomplete", "Override Nodes"]
    });
    app.ui.settings.addSetting({
        id: id + ".IgnoredNodeTypes",
        name: "Ignore Nodes",
        tooltip: "Comma-separated list of node type full names or keywords where autocomplete is disabled.",
        type: () => {
            const container = document.createElement("div");
            container.className = "flex w-full flex-col gap-1.5";
            container.style.width = "100%";
            container.style.minWidth = "220px";

            const textarea = document.createElement("textarea");
            textarea.className = "w-full rounded-md border border-interface-stroke bg-base-background p-2 text-sm text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-default resize-y";
            textarea.rows = 3;
            textarea.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
            textarea.style.fontSize = "12px";
            textarea.placeholder = "e.g. Note, PrimitiveNode...";
            textarea.value = settingValues.ignoredNodeTypes ?? "";

            textarea.addEventListener("input", (e) => {
                settingValues.ignoredNodeTypes = e.target.value;
                persistSetting("IgnoredNodeTypes", e.target.value);
            });

            window.addEventListener("tagcomplete-ignored-nodes-updated", (e) => {
                if (e.detail !== undefined) {
                    textarea.value = e.detail;
                }
            });

            container.appendChild(textarea);
            return container;
        },
        defaultValue: "",
        category: [name, "Autocomplete", "Ignore Nodes"]
    });

    app.ui.settings.addSetting({
        id: id + ".LoraWeightStep",
        name: "LoRA Weight Step",
        tooltip: "Adjustment step when pressing Ctrl+Up/Down on LoRA tags (<lora:name:1.0>).",
        type: "slider",
        attrs: { min: 0.05, max: 0.50, step: 0.05 },
        defaultValue: settingValues.loraWeightStep,
        category: [name, "Autocomplete", "LoRA Weight Step"],
        onChange: (newVal) => {
            settingValues.loraWeightStep = Number(newVal) || 0.05;
            persistSetting("LoraWeightStep", settingValues.loraWeightStep);
        }
    });

    app.ui.settings.addSetting({
        id: id + ".TagWeightStep",
        name: "Tag / Embedding Weight Step",
        tooltip: "Adjustment step when pressing Ctrl+Up/Down on standard tags and embeddings ((tag:1.1)).",
        type: "slider",
        attrs: { min: 0.05, max: 0.50, step: 0.05 },
        defaultValue: settingValues.tagWeightStep,
        category: [name, "Autocomplete", "Tag / Embedding Weight Step"],
        onChange: (newVal) => {
            settingValues.tagWeightStep = Number(newVal) || 0.05;
            persistSetting("TagWeightStep", settingValues.tagWeightStep);
        }
    });

    app.ui.settings.addSetting({
        id: id + ".KeyAccept",
        name: "Insert Suggestion with",
        tooltip: "Choose which keys can be used to insert the currently selected candidate (Tab, Enter, or both).",
        type: () => {
            const container = document.createElement("div");
            container.style.display = "flex";
            container.style.flexDirection = "column";
            container.style.gap = "6px";
            container.style.alignItems = "flex-end";
            container.style.justifyContent = "center";
            container.style.padding = "2px 0";
            const tabRow = document.createElement("div");
            tabRow.style.display = "flex";
            tabRow.style.alignItems = "center";
            tabRow.style.gap = "8px";
            tabRow.style.cursor = "pointer";

            const tabText = document.createElement("span");
            tabText.textContent = "Tab";
            tabText.className = "text-sm text-muted select-none";

            const tabSwitch = createToggleSwitch(settingValues.keyAcceptTab, (checked) => {
                settingValues.keyAcceptTab = checked;
                persistSetting("KeyAcceptTab", checked);
            });

            tabText.addEventListener("click", () => tabSwitch.click());

            tabRow.appendChild(tabText);
            tabRow.appendChild(tabSwitch);
            const enterRow = document.createElement("div");
            enterRow.style.display = "flex";
            enterRow.style.alignItems = "center";
            enterRow.style.gap = "8px";
            enterRow.style.cursor = "pointer";

            const enterText = document.createElement("span");
            enterText.textContent = "Enter";
            enterText.className = "text-sm text-muted select-none";

            const enterSwitch = createToggleSwitch(settingValues.keyAcceptEnter, (checked) => {
                settingValues.keyAcceptEnter = checked;
                persistSetting("KeyAcceptEnter", checked);
            });

            enterText.addEventListener("click", () => enterSwitch.click());

            enterRow.appendChild(enterText);
            enterRow.appendChild(enterSwitch);

            container.appendChild(tabRow);
            container.appendChild(enterRow);

            return container;
        },
        defaultValue: true,
        category: [name, "Autocomplete", "Insert Suggestion with"]
    });

    app.ui.settings.addSetting({
        id: id + ".Enabled",
        name: "Enable Autocomplete",
        tooltip: "Master switch to enable or disable the Autocomplete++ engine.",
        type: "boolean",
        defaultValue: settingValues.enabled,
        category: [name, "Autocomplete", "Enable Autocomplete"],
        onChange: (newVal) => {
            settingValues.enabled = !!newVal;
            persistSetting("Enabled", settingValues.enabled);
        }
    });

    app.ui.settings.addSetting({
        id: id + ".ClearFavorHistory",
        name: "Clear Favor History",
        tooltip: "Reset all recorded personal tag usage counts. (Click twice within 3 seconds to confirm)",
        type: () => {
            return createConfirmButton(
                "Clear Favor History",
                "Confirm Clear?",
                "Cleared!",
                () => {
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
                    window.dispatchEvent(new CustomEvent("tagcomplete-clear-favor-history"));
                }
            );
        },
        defaultValue: "",
        category: [name, "Display", "Clear Favor History"]
    });
    app.ui.settings.addSetting({
        id: id + ".FavorMaxTags",
        name: "Favor Storage Capacity (Max Tags)",
        tooltip: "Maximum number of unique tags to store in history before LRU auto-pruning triggers (1,000 - 50,000).",
        type: "slider",
        attrs: { min: 1000, max: 50000, step: 1000 },
        defaultValue: settingValues.favorMaxTags,
        category: [name, "Display", "Favor Storage Capacity (Max Tags)"],
        onChange: (newVal) => {
            settingValues.favorMaxTags = Number(newVal) || 10000;
            persistSetting("FavorMaxTags", settingValues.favorMaxTags);
        }
    });
    app.ui.settings.addSetting({
        id: id + ".FavorMaxAge",
        name: "Favor Validity (Days)",
        tooltip: "Number of days before an unused tag's Favor qualification expires (0 = Never expire).",
        type: "slider",
        attrs: { min: 0, max: 180, step: 5 },
        defaultValue: settingValues.favorMaxAge,
        category: [name, "Display", "Favor Validity (Days)"],
        onChange: (newVal) => {
            settingValues.favorMaxAge = Number(newVal);
            persistSetting("FavorMaxAge", settingValues.favorMaxAge);
        }
    });
    app.ui.settings.addSetting({
        id: id + ".FavorMinCount",
        name: "Favor Threshold (Min Usage Count)",
        tooltip: "Minimum number of times a tag must be used before it is eligible for the Favor badge and priority boost.",
        type: "slider",
        attrs: { min: 1, max: 50, step: 1 },
        defaultValue: settingValues.favorMinCount,
        category: [name, "Display", "Favor Threshold (Min Usage Count)"],
        onChange: (newVal) => {
            settingValues.favorMinCount = Number(newVal) || 5;
            persistSetting("FavorMinCount", settingValues.favorMinCount);
        }
    });

    app.ui.settings.addSetting({
        id: id + ".FrequencySort",
        name: "Prioritize Frequently Used Tags (Favor)",
        tooltip: "Track personal tag usage and promote frequently used tags to the top with a Favor badge.",
        type: "boolean",
        defaultValue: settingValues.frequencySort,
        category: [name, "Display", "Prioritize Frequently Used Tags (Favor)"],
        onChange: (newVal) => {
            settingValues.frequencySort = !!newVal;
            persistSetting("FrequencySort", settingValues.frequencySort);
        }
    });

    app.ui.settings.addSetting({
        id: id + ".ShowWikiLinks",
        name: "Show 'wiki' Badge",
        tooltip: "Display a 'wiki' badge in front of tags. Clicking opens the corresponding Danbooru or e621 encyclopedia page (requires the active tag CSV filename to contain 'danbooru' or 'e621').",
        type: "boolean",
        defaultValue: settingValues.showWikiLinks,
        category: [name, "Display", "Show Wiki Badge"],
        onChange: (newVal) => {
            settingValues.showWikiLinks = !!newVal;
            persistSetting("ShowWikiLinks", settingValues.showWikiLinks);
        }
    });

    app.ui.settings.addSetting({
        id: id + ".MaxSuggestions",
        name: "Max Suggestions Count",
        tooltip: "Maximum number of autocomplete candidate items to display at once.",
        type: "slider",
        attrs: { min: 5, max: 50, step: 5 },
        defaultValue: settingValues.maxSuggestions,
        category: [name, "Display", "Max Suggestions Count"],
        onChange: (newVal) => {
            settingValues.maxSuggestions = Number(newVal) || 15;
            persistSetting("MaxSuggestions", settingValues.maxSuggestions);
        }
    });
    app.ui.settings.addSetting({
        id: id + ".PreviewPosition",
        name: "Floating Preview Card Position",
        tooltip: "Position preference for floating preview cards (thumbnails and presets).",
        type: "combo",
        options: ["Left", "Right", "Disabled"],
        defaultValue: settingValues.previewPosition,
        category: [name, "Display", "Floating Preview Card Position"],
        onChange: (newVal) => {
            settingValues.previewPosition = newVal || "Left";
            persistSetting("PreviewPosition", settingValues.previewPosition);
        }
    });

    app.ui.settings.addSetting({
        id: id + ".FormatKeepUnderscoresList",
        name: "Keep Underscores for Tags",
        tooltip: "Comma-separated list of tags to exempt from underscore replacement. Preserves literal underscores during both autocomplete insertion and prompt auto-formatting (e.g. custom_style, special_tag).",
        type: () => {
            const container = document.createElement("div");
            container.className = "flex w-full flex-col gap-1.5";
            container.style.width = "100%";
            container.style.minWidth = "220px";

            const textarea = document.createElement("textarea");
            textarea.className = "w-full rounded-md border border-interface-stroke bg-base-background p-2 text-sm text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-default resize-y";
            textarea.rows = 3;
            textarea.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
            textarea.style.fontSize = "12px";
            textarea.placeholder = "e.g. custom_style_v1, special_tag...";
            textarea.value = settingValues.formatKeepUnderscoresList || "";
            textarea.dataset.acKeepUnderscores = "true";

            textarea.addEventListener("input", (e) => {
                settingValues.formatKeepUnderscoresList = e.target.value;
                persistSetting("FormatKeepUnderscoresList", e.target.value);
            });

            container.appendChild(textarea);
            return container;
        },
        defaultValue: "",
        category: [name, "Formatting", "Keep Underscores for Tags"]
    });

    app.ui.settings.addSetting({
        id: id + ".AutoFormatRules",
        name: " ",
        type: () => {
            const container = document.createElement("div");
            container.style.display = "flex";
            container.style.flexDirection = "column";
            container.style.gap = "8px";
            container.style.width = "100%";
            container.style.alignItems = "flex-end";
            container.style.justifyContent = "center";
            container.style.padding = "2px 0";

            const createSubRow = (label, initialVal, onToggle) => {
                const row = document.createElement("div");
                row.style.display = "flex";
                row.style.alignItems = "center";
                row.style.gap = "8px";
                row.style.cursor = "pointer";

                const textSpan = document.createElement("span");
                textSpan.textContent = label;
                textSpan.className = "text-sm text-muted select-none";

                const sw = createToggleSwitch(initialVal, onToggle);
                textSpan.addEventListener("click", () => sw.click());

                row.appendChild(textSpan);
                row.appendChild(sw);
                return row;
            };

            container.appendChild(createSubRow(
                "Insert space after comma",
                settingValues.formatSpaceAfterComma,
                (checked) => {
                    settingValues.formatSpaceAfterComma = checked;
                    persistSetting("FormatSpaceAfterComma", checked);
                }
            ));

            container.appendChild(createSubRow(
                "Trim trailing comma at prompt end",
                settingValues.formatTrimPromptEndComma,
                (checked) => {
                    settingValues.formatTrimPromptEndComma = checked;
                    persistSetting("FormatTrimPromptEndComma", checked);
                }
            ));

            container.appendChild(createSubRow(
                "Trim trailing commas at line ends",
                settingValues.formatTrimLineEndComma,
                (checked) => {
                    settingValues.formatTrimLineEndComma = checked;
                    persistSetting("FormatTrimLineEndComma", checked);
                }
            ));

            container.appendChild(createSubRow(
                "Replace underscores with spaces",
                settingValues.formatReplaceUnderscore,
                (checked) => {
                    settingValues.formatReplaceUnderscore = checked;
                    persistSetting("FormatReplaceUnderscore", checked);
                }
            ));

            const updateVisibility = (active) => {
                container.style.opacity = active ? "1" : "0.4";
                container.style.pointerEvents = active ? "auto" : "none";
            };
            updateVisibility(settingValues.autoFormatOnBlur);

            window.addEventListener("autocomplete-format-blur-toggled", (e) => {
                updateVisibility(e.detail);
            });

            return container;
        },
        defaultValue: true,
        category: [name, "Formatting", "Auto Format Rules"]
    });

    app.ui.settings.addSetting({
        id: id + ".AutoFormatOnBlur",
        name: "Auto Format on Blur",
        tooltip: "Automatically format prompt syntax when the input area loses focus, individual rules can be toggled below.",
        type: "boolean",
        defaultValue: settingValues.autoFormatOnBlur,
        category: [name, "Formatting", "Auto Format on Blur"],
        onChange: (newVal) => {
            const checked = !!newVal;
            settingValues.autoFormatOnBlur = checked;
            persistSetting("AutoFormatOnBlur", checked);
            window.dispatchEvent(new CustomEvent("autocomplete-format-blur-toggled", { detail: checked }));
        }
    });

    app.ui.settings.addSetting({
        id: id + ".EscapeParentheses",
        name: "Escape Parentheses",
        tooltip: "Escape parentheses in tags (e.g. tag (qualifier) -> tag \\(qualifier\\)) to avoid unwanted attention weighting.",
        type: "boolean",
        defaultValue: settingValues.escapeParentheses,
        category: [name, "Formatting", "Escape Parentheses"],
        onChange: (newVal) => {
            settingValues.escapeParentheses = !!newVal;
            persistSetting("EscapeParentheses", settingValues.escapeParentheses);
        }
    });

    app.ui.settings.addSetting({
        id: id + ".ReplaceUnderscore",
        name: "Replace '_' with Space",
        tooltip: "Replace underscores with spaces when inserting regular tags.",
        type: "boolean",
        defaultValue: settingValues.replaceUnderscore,
        category: [name, "Formatting", "Replace Underscore with Space"],
        onChange: (newVal) => {
            settingValues.replaceUnderscore = !!newVal;
            persistSetting("ReplaceUnderscore", settingValues.replaceUnderscore);
        }
    });

    app.ui.settings.addSetting({
        id: id + ".AutoInsertComma",
        name: "Auto-Insert Comma",
        tooltip: "Automatically append comma and space after inserting a tag.",
        type: "boolean",
        defaultValue: settingValues.autoInsertComma,
        category: [name, "Formatting", "Auto-Insert Comma"],
        onChange: (newVal) => {
            settingValues.autoInsertComma = !!newVal;
            persistSetting("AutoInsertComma", settingValues.autoInsertComma);
        }
    });

    app.ui.settings.addSetting({
        id: id + ".AnimaArtistMode",
        name: "Anima Artist '{'@'}' Prefix Mode",
        tooltip: "Controls whether Artist tags receive the {'@'} prefix upon insertion and in {'@'} queries (recommended for Anima models). 'Auto' detects Anima modular workflows on canvas.",
        type: "combo",
        options: ["Auto", "Enabled", "Disabled"],
        defaultValue: settingValues.animaArtistMode,
        category: [name, "Formatting", "Anima Artist '{'@'}' Prefix Mode"],
        onChange: (newVal) => {
            settingValues.animaArtistMode = newVal || "Auto";
            persistSetting("AnimaArtistMode", settingValues.animaArtistMode);
        }
    });

    app.ui.settings.addSetting({
        id: id + ".DynamicPromptMode",
        name: "Dynamic Prompts Mode",
        tooltip: "Controls dynamic prompt sampling behavior across generations.",
        type: "combo",
        options: ["Random", "Follow Seed", "Keep Last Choice"],
        defaultValue: settingValues.dynamicPromptMode,
        category: [name, "Wildcards & Dynamic Prompts", "Dynamic Prompts Mode"],
        onChange: (newVal) => {
            settingValues.dynamicPromptMode = newVal || "Random";
            persistSetting("DynamicPromptMode", settingValues.dynamicPromptMode);
        }
    });

    app.ui.settings.addSetting({
        id: id + ".WildcardMode",
        name: "Wildcards Mode",
        tooltip: "Controls wildcard line sampling behavior across generations.",
        type: "combo",
        options: ["Random", "Follow Seed", "Keep Last Choice", "Sequential"],
        defaultValue: settingValues.wildcardMode,
        category: [name, "Wildcards & Dynamic Prompts", "Wildcards Mode"],
        onChange: (newVal) => {
            settingValues.wildcardMode = newVal || "Random";
            persistSetting("WildcardMode", settingValues.wildcardMode);
        }
    });

    app.ui.settings.addSetting({
        id: id + ".EnablePromptExpansion",
        name: "Enable Prompt Expansion Engine",
        tooltip: "Client-side execution engine that resolves __wildcards__ and {dynamic|prompts} before execution while preserving original templates on canvas.",
        type: "boolean",
        defaultValue: settingValues.enablePromptExpansion,
        category: [name, "Wildcards & Dynamic Prompts", "Enable Prompt Expansion Engine"],
        onChange: (newVal) => {
            settingValues.enablePromptExpansion = !!newVal;
            persistSetting("EnablePromptExpansion", settingValues.enablePromptExpansion);
        }
    });

    app.ui.settings.addSetting({
        id: id + ".LoraManagerMode",
        name: "LoRA Manager Integration",
        tooltip: "Controls integration with LoRA Manager to prioritize active workflow trigger words and preview image fallbacks.",
        type: "combo",
        options: ["Auto", "Enabled", "Disabled"],
        defaultValue: settingValues.loraManagerMode,
        category: [name, "Models & Integrations", "LoRA Manager Integration"],
        onChange: (newVal) => {
            settingValues.loraManagerMode = newVal || "Auto";
            persistSetting("LoraManagerMode", settingValues.loraManagerMode);
        }
    });

    app.ui.settings.addSetting({
        id: id + ".LoraPathMode",
        name: "LoRA Path Completion Mode",
        tooltip: "Controls whether LoRA suggestions insert filenames or full paths. When set to Auto, syncs with LoRA Manager's 'full' syntax if enabled, otherwise inserts filenames by default and falls back to full path only for duplicate names.",
        type: "combo",
        options: ["Auto", "Filename Only", "Full Path"],
        defaultValue: settingValues.loraPathMode || "Auto",
        category: [name, "Models & Integrations", "LoRA Path Completion Mode"],
        onChange: (newVal) => {
            settingValues.loraPathMode = newVal || "Auto";
            persistSetting("LoraPathMode", settingValues.loraPathMode);
        }
    });

    app.ui.settings.addSetting({
        id: id + ".EnableModels",
        name: "Enable LoRA and Embedding Suggestions",
        tooltip: "Suggest <lora:...> and embedding:... when typing prefix.",
        type: "boolean",
        defaultValue: settingValues.enableModels,
        category: [name, "Models & Integrations", "Enable LoRAs and Embeddings"],
        onChange: (newVal) => {
            settingValues.enableModels = !!newVal;
            persistSetting("EnableModels", settingValues.enableModels);
        }
    });

    app.ui.settings.addSetting({
        id: id + ".TranslationFile",
        name: "Translation File",
        tooltip: "Select translation CSV file (choose 'None' to disable translation). Scans and lists all CSV files located in tags/translations/.",
        type: "combo",
        options: availableTranslationFiles,
        defaultValue: settingValues.translationFile || "None",
        category: [name, "Tags & Dictionaries", "Translation File"],
        onChange: (newVal) => {
            settingValues.translationFile = newVal;
            persistSetting("TranslationFile", settingValues.translationFile);
            window.dispatchEvent(new CustomEvent("tagcomplete-reload-tags"));
        }
    });

    app.ui.settings.addSetting({
        id: id + ".ExtraFiles",
        name: "Extra Tag Files",
        tooltip: "Load additional tag CSV files from the tags directory.",
        type: () => {
            const getExtraCandidates = () => {
                const mainFile = (settingValues.tagFile || "").toLowerCase();
                const transFiles = new Set(
                    (availableTranslationFiles || [])
                        .map(f => (typeof f === "string" ? f : f.filename || "").toLowerCase())
                        .filter(f => f && f !== "none")
                );

                return (availableTagFiles || []).filter(filename => {
                    const lower = (filename || "").toLowerCase();
                    if (lower === mainFile) return false;
                    if (transFiles.has(lower)) return false;
                    return true;
                });
            };

            return createMultiSelectDropdown(
                settingValues.extraFiles,
                getExtraCandidates,
                (newVal) => {
                    settingValues.extraFiles = newVal || "";
                    persistSetting("ExtraFiles", settingValues.extraFiles);
                    window.dispatchEvent(new CustomEvent("tagcomplete-reload-tags"));
                }
            );
        },
        defaultValue: settingValues.extraFiles || "",
        category: [name, "Tags & Dictionaries", "Extra Tag Files"]
    });

    app.ui.settings.addSetting({
        id: id + ".TagFile",
        name: "Main Tag File",
        tooltip: "Primary tag database CSV loaded from the tags directory.",
        type: "combo",
        options: availableTagFiles,
        defaultValue: settingValues.tagFile,
        category: [name, "Tags & Dictionaries", "Main Tag File"],
        onChange: (newVal) => {
            if (newVal) {
                settingValues.tagFile = newVal;
                persistSetting("TagFile", settingValues.tagFile);
                window.dispatchEvent(new CustomEvent("tagcomplete-reload-tags"));
            }
        }
    });

    app.ui.settings.addSetting({
        id: id + ".TranslationOldFormat",
        name: "Translation uses old 3-column format",
        tooltip: "Enable if your translation CSV file uses the old 3-column format (<tag>, <type/count>, <translation>) instead of the standard 2-column format.",
        type: "boolean",
        defaultValue: settingValues.oldFormat,
        category: [name, "Translation", "Old 3-column format"],
        onChange: (newVal) => {
            settingValues.oldFormat = !!newVal;
            persistSetting("TranslationOldFormat", settingValues.oldFormat);
            window.dispatchEvent(new CustomEvent("tagcomplete-reload-tags"));
        }
    });

    app.ui.settings.addSetting({
        id: id + ".ShowTranslations",
        name: "Show Translations in Suggestions",
        tooltip: "Display '[Translation]' next to tags and aliases in the autocomplete popup.",
        type: "boolean",
        defaultValue: settingValues.showTranslations,
        category: [name, "Translation", "Show Translations in Suggestions"],
        onChange: (newVal) => {
            settingValues.showTranslations = !!newVal;
            persistSetting("ShowTranslations", settingValues.showTranslations);
        }
    });

    app.ui.settings.addSetting({
        id: id + ".SearchTranslation",
        name: "Search by Translation / Local Name",
        tooltip: "Enable searching tags using translated names.",
        type: "boolean",
        defaultValue: settingValues.searchTranslation,
        category: [name, "Translation", "Search by Translation"],
        onChange: (newVal) => {
            settingValues.searchTranslation = !!newVal;
            persistSetting("SearchTranslation", settingValues.searchTranslation);
        }
    });

    app.ui.settings.addSetting({
        id: id + ".HotkeyRules",
        name: " ",
        type: () => {
            const container = document.createElement("div");
            container.style.display = "flex";
            container.style.flexDirection = "column";
            container.style.gap = "8px";
            container.style.width = "100%";
            container.style.alignItems = "flex-end";
            container.style.justifyContent = "center";
            container.style.padding = "2px 0";

            const createSubRow = (label, initialVal, onToggle) => {
                const row = document.createElement("div");
                row.style.display = "flex";
                row.style.alignItems = "center";
                row.style.gap = "8px";
                row.style.cursor = "pointer";

                const textSpan = document.createElement("span");
                textSpan.textContent = label;
                textSpan.className = "text-sm text-muted select-none";

                const sw = createToggleSwitch(initialVal, onToggle);
                textSpan.addEventListener("click", () => sw.click());

                row.appendChild(textSpan);
                row.appendChild(sw);
                return row;
            };

            container.appendChild(createSubRow(
                "Smart Tag Selection on Ctrl+Up/Down (Weight Adjust)",
                settingValues.enableTagWeightHotkey,
                (checked) => {
                    settingValues.enableTagWeightHotkey = checked;
                    persistSetting("EnableTagWeightHotkey", checked);
                }
            ));

            container.appendChild(createSubRow(
                "Tag-by-Tag Navigation on Ctrl+Left/Right",
                settingValues.enableTagJumpHotkey,
                (checked) => {
                    settingValues.enableTagJumpHotkey = checked;
                    persistSetting("EnableTagJumpHotkey", checked);
                }
            ));

            container.appendChild(createSubRow(
                "Tag Swap / Reordering on Alt+Left/Right",
                settingValues.enableTagSwapHotkey,
                (checked) => {
                    settingValues.enableTagSwapHotkey = checked;
                    persistSetting("EnableTagSwapHotkey", checked);
                }
            ));

            const updateVisibility = (active) => {
                container.style.opacity = active ? "1" : "0.4";
                container.style.pointerEvents = active ? "auto" : "none";
                container.style.transition = "opacity 0.2s ease";
            };
            updateVisibility(settingValues.enableHotkeyEnhance);

            window.addEventListener("autocomplete-hotkeys-toggled", (e) => {
                updateVisibility(e.detail);
            });

            return container;
        },
        defaultValue: true,
        category: [name, "Shortcuts & Interaction", "Hotkey Rules"]
    });

    app.ui.settings.addSetting({
        id: id + ".EnableHotkeyEnhance",
        name: "Enable Hotkey Enhance",
        tooltip: "Enable enhanced keyboard shortcuts for prompt editing, individual rules can be toggled below.",
        type: "boolean",
        defaultValue: settingValues.enableHotkeyEnhance,
        category: [name, "Shortcuts & Interaction", "Enable Hotkey Enhance"],
        onChange: (newVal) => {
            const checked = !!newVal;
            settingValues.enableHotkeyEnhance = checked;
            persistSetting("EnableHotkeyEnhance", checked);
            window.dispatchEvent(new CustomEvent("autocomplete-hotkeys-toggled", { detail: checked }));
        }
    });
}
