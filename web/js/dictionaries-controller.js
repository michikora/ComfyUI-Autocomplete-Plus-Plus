import { app } from "/scripts/app.js";
import { settingValues } from "./settings.js";
import { getFixedCaretCoordinates } from "./caret-position.js";
import { getActiveControllerNode, notifyControllerInteracted } from "./main.js";

// Cache for available CSV tag files list
let availableCsvsCache = null;

export async function fetchAvailableCsvDictionaries(force = false) {
    if (!force && availableCsvsCache) return availableCsvsCache;
    try {
        const res = await fetch("/autocomplete-plus-plus/tags/list");
        if (res.ok) {
            const data = await res.json();
            const allFiles = data.files || [];
            availableCsvsCache = allFiles.filter(f => !f.is_translation);
            if (availableCsvsCache.length === 0 && Array.isArray(data.tags)) {
                availableCsvsCache = data.tags.map(name => ({ filename: name, size: 0, is_translation: false }));
            }
            return availableCsvsCache;
        }
    } catch (e) {
        console.warn("[Autocomplete++] Failed to fetch CSV dictionaries:", e);
    }
    return [];
}

/**
 * Resolves the controller node for a given DOM textarea
 */
export function getNodeForDictionariesElement(element) {
    if (!element) return null;
    if (element.id) {
        const match = String(element.id).match(/^v-(\d+)-/);
        if (match) {
            const nodeId = Number(match[1]);
            const graph = app?.graph || app?.rootGraph || window.app?.graph;
            if (graph) {
                const node = graph.getNodeById ? graph.getNodeById(nodeId) : graph._nodes?.find(n => n.id === nodeId);
                if (node && (node.type === "AutocompletePlusDictionariesController" || node.comfyClass === "AutocompletePlusDictionariesController")) {
                    return node;
                }
            }
        }
    }

    try {
        const graph = app?.graph || app?.rootGraph || window.app?.graph;
        if (graph && graph._nodes) {
            for (const node of graph._nodes) {
                if (node.type === "AutocompletePlusDictionariesController" || node.comfyClass === "AutocompletePlusDictionariesController") {
                    if (node.widgets && Array.isArray(node.widgets)) {
                        for (const w of node.widgets) {
                            if (
                                w === element ||
                                w.element === element ||
                                w.inputEl === element ||
                                (w.element && typeof w.element.contains === "function" && w.element.contains(element)) ||
                                (w.inputEl && typeof w.inputEl.contains === "function" && w.inputEl.contains(element)) ||
                                (element.parentElement && (w.element === element.parentElement || w.inputEl === element.parentElement))
                            ) {
                                return node;
                            }
                        }
                    }
                }
            }
        }
    } catch (_) {}

    return null;
}

/**
 * Checks if a DOM element is the extra_tag_files textarea of AutocompletePlusDictionariesController
 */
export function isDictionariesControllerTextarea(element) {
    if (!element || element.tagName !== "TEXTAREA") return false;
    if (element.dataset?.acCsvPicker === "true" || element.getAttribute("data-ac-csv-picker") === "true") {
        return true;
    }

    // 1. Label check on ComfyUI Vue 3 Frontend
    const labelText = (element.previousElementSibling?.textContent || element.labels?.[0]?.textContent || "").trim();
    if (labelText === "extra_tag_files") {
        element.dataset.acCsvPicker = "true";
        return true;
    }

    // 2. Node resolution
    const node = getNodeForDictionariesElement(element);
    if (node) {
        element.dataset.acCsvPicker = "true";
        return true;
    }

    return false;
}

/**
 * Checks if the controller node for this textarea is in 'Override (Use Custom List)' mode
 */
export function isDictionariesControllerOverrideMode(element) {
    const node = getNodeForDictionariesElement(element);
    if (!node || !node.widgets) return true;
    const modeWidget = node.widgets.find(w => w.name === "extra_tag_files_mode");
    return modeWidget ? modeWidget.value === "Override (Use Custom List)" : true;
}

/**
 * Synchronizes the visual and interactive disabled state of extra_tag_files widget
 */
export function syncDictionariesControllerWidgetState(node) {
    if (!node || !node.widgets) return;
    const modeWidget = node.widgets.find(w => w.name === "extra_tag_files_mode");
    const extraWidget = node.widgets.find(w => w.name === "extra_tag_files");
    if (!modeWidget || !extraWidget) return;

    const isOverride = modeWidget.value === "Override (Use Custom List)";
    extraWidget.disabled = !isOverride;

    const textareas = new Set();
    if (extraWidget.inputEl) textareas.add(extraWidget.inputEl);
    if (extraWidget.element) textareas.add(extraWidget.element);
    if (node.id !== undefined) {
        document.querySelectorAll(`textarea[id^="v-${node.id}-"]`).forEach(t => textareas.add(t));
    }

    textareas.forEach(textarea => {
        textarea.disabled = !isOverride;
        textarea.readOnly = !isOverride;
        if (!isOverride) {
            textarea.classList.add("ac-widget-disabled");
            textarea.setAttribute("title", "Set extra_tag_files_mode to 'Override (Use Custom List)' to edit this list.");
            if (csvDictionaryPicker.target === textarea) {
                csvDictionaryPicker.hide();
            }
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
 * Setup lifecycle hooks on nodeType for AutocompletePlusDictionariesController
 */
export function setupDictionariesControllerNodeHooks(nodeType, nodeData) {
    if (nodeData?.name === "AutocompletePlusDictionariesController") {
        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function() {
            const r = origOnNodeCreated ? origOnNodeCreated.apply(this, arguments) : undefined;
            setupNodeCallbacks(this);
            return r;
        };

        const origOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function() {
            const r = origOnConfigure ? origOnConfigure.apply(this, arguments) : undefined;
            setupNodeCallbacks(this);
            return r;
        };
    }
}

function setupNodeCallbacks(node) {
    if (!node || !node.widgets) return;

    node.widgets.forEach(widget => {
        const origCb = widget.callback;
        widget.callback = function() {
            const r = origCb ? origCb.apply(this, arguments) : undefined;
            notifyControllerInteracted(node);
            syncDictionariesControllerWidgetState(node);
            return r;
        };
    });
    syncDictionariesControllerWidgetState(node);
    setTimeout(() => syncDictionariesControllerWidgetState(node), 80);
    setTimeout(() => syncDictionariesControllerWidgetState(node), 300);
}

/**
 * Dedicated, self-contained CSV dictionary picker popup for AutocompletePlusDictionariesController
 */
class CsvDictionaryPicker {
    constructor() {
        this.target = null;
        this.results = [];
        this.selectedIndex = 0;
        this.isVisible = false;
        this.tagwordStart = 0;
        this.tagwordEnd = 0;
        this.isSelecting = false;

        this.domContainer = document.createElement("div");
        this.domContainer.className = "autocompleteParent ac-csv-picker-popup";
        this.domContainer.id = "tagcomplete-csv-popup-container";
        this.domContainer.style.display = "none";
        this.domContainer.style.position = "fixed";
        this.domContainer.style.zIndex = "10001";
        this.domContainer.style.minWidth = "300px";

        this.domRoot = document.createElement("div");
        this.domRoot.className = "autocompleteResults";

        this.domList = document.createElement("ul");
        this.domList.className = "autocompleteResultsList";

        this.domRoot.appendChild(this.domList);
        this.domContainer.appendChild(this.domRoot);
        document.body.appendChild(this.domContainer);

        // Prevent clicking inside popup from blurring textarea
        this.domContainer.addEventListener("mousedown", (e) => {
            e.preventDefault();
        });
    }

    detectThemeLuminance() {
        try {
            const computedStyle = window.getComputedStyle(this.domContainer);
            let bg = computedStyle.backgroundColor || "";
            if (!bg || bg === "rgba(0, 0, 0, 0)" || bg === "transparent") {
                bg = window.getComputedStyle(document.body).backgroundColor || "";
            }
            if (bg.startsWith("rgb")) {
                const rgb = bg.match(/\d+/g);
                if (rgb && rgb.length >= 3) {
                    const r = parseInt(rgb[0], 10);
                    const g = parseInt(rgb[1], 10);
                    const b = parseInt(rgb[2], 10);
                    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                    if (lum > 0.5) {
                        this.domContainer.setAttribute("data-theme", "light");
                        return;
                    }
                }
            }
        } catch (_) {}
        this.domContainer.removeAttribute("data-theme");
    }

    /**
     * Auto-appends trailing comma and space if refocusing with existing content
     */
    prepareRefocusComma(element) {
        if (!element || element.disabled || element.readOnly) return;
        const val = (element.value || "").trimEnd();
        if (val.length > 0 && !val.endsWith(",")) {
            element.value = val + ", ";
            const newPos = element.value.length;
            element.setSelectionRange(newPos, newPos);
            element.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }

    async trigger(target) {
        this.target = target;
        if (!this.target || this.target.disabled || this.target.readOnly || !isDictionariesControllerOverrideMode(this.target)) {
            this.hide();
            return;
        }

        const fullVal = this.target.value || "";
        const cursorPos = this.target.selectionStart !== undefined ? this.target.selectionStart : fullVal.length;

        // Comma token boundaries
        const lastComma = fullVal.lastIndexOf(",", cursorPos - 1);
        const start = lastComma === -1 ? 0 : lastComma + 1;
        let nextComma = fullVal.indexOf(",", cursorPos);
        if (nextComma === -1) nextComma = fullVal.length;

        this.tagwordStart = start;
        this.tagwordEnd = nextComma;
        const currentToken = fullVal.substring(start, cursorPos).trim().toLowerCase();

        // Collect already selected CSVs
        const selectedSet = new Set(fullVal.split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
        if (currentToken) {
            selectedSet.delete(currentToken);
        }

        // Exclude active primary tag_file (from controller node, or global settings if "Default")
        let effectivePrimaryTagFile = settingValues.tagFile || "danbooru.csv";
        try {
            const node = getActiveControllerNode("AutocompletePlusDictionariesController");
            if (node) {
                const tagFileWidget = node.widgets?.find(w => w.name === "tag_file");
                if (tagFileWidget && tagFileWidget.value) {
                    if (tagFileWidget.value !== "Default (From Settings)") {
                        effectivePrimaryTagFile = tagFileWidget.value.trim();
                    }
                }
            }
        } catch (_) {}

        if (effectivePrimaryTagFile && effectivePrimaryTagFile !== "None") {
            selectedSet.add(effectivePrimaryTagFile.trim().toLowerCase());
        }

        const allFiles = await fetchAvailableCsvDictionaries();
        let available = allFiles.filter(f => !selectedSet.has(f.filename.toLowerCase()));
        if (currentToken) {
            available = available.filter(f => f.filename.toLowerCase().includes(currentToken));
        }

        if (available.length === 0) {
            this.hide();
            return;
        }

        this.results = available;
        this.selectedIndex = 0;
        this.render();
    }

    render() {
        this.domList.innerHTML = "";
        this.detectThemeLuminance();

        this.results.forEach((item, index) => {
            const li = document.createElement("li");
            li.className = index === this.selectedIndex ? "selected" : "";

            const flexContainer = document.createElement("div");
            flexContainer.className = "resultsFlexContainer";

            const leftDiv = document.createElement("div");
            leftDiv.className = "acItemLeft";

            const textDiv = document.createElement("div");
            textDiv.className = "acListItem";
            textDiv.style.color = "#4d73f1";
            textDiv.textContent = item.filename;
            leftDiv.appendChild(textDiv);
            flexContainer.appendChild(leftDiv);

            const rightDiv = document.createElement("div");
            rightDiv.className = "acItemRight";

            const sizeDiv = document.createElement("div");
            sizeDiv.className = "acMetaText";
            sizeDiv.textContent = item.size ? `${(item.size / 1024).toFixed(0)} KB` : "0 KB";
            rightDiv.appendChild(sizeDiv);

            const badgeSpan = document.createElement("span");
            badgeSpan.className = "ac-origin-badge ac-badge-dict";
            badgeSpan.textContent = "CSV";
            badgeSpan.title = "CSV Dictionary";
            rightDiv.appendChild(badgeSpan);

            flexContainer.appendChild(rightDiv);
            li.appendChild(flexContainer);

            li.addEventListener("mousedown", (e) => {
                e.preventDefault();
                this.selectItem(item);
            });

            this.domList.appendChild(li);
        });

        this.updatePosition();
        this.domContainer.style.display = "block";
        this.isVisible = true;

        // Temporarily pass-through pointer events during initial click
        // so mouseup registers on textarea to retain focus without blur
        this.domContainer.style.pointerEvents = "none";
        window.addEventListener("mouseup", () => {
            if (this.domContainer) {
                this.domContainer.style.pointerEvents = "auto";
            }
        }, { once: true });

        this.scrollActiveIntoView();
    }

    updatePosition() {
        if (!this.target) return;
        const coords = getFixedCaretCoordinates(this.target, this.target.selectionStart || 0);

        let left = coords.left;
        let top = coords.bottom + 6;

        this.domContainer.style.display = "block";
        const rect = this.domContainer.getBoundingClientRect();

        // Boundary clamping
        if (top + rect.height > window.innerHeight - 10) {
            top = Math.max(10, window.innerHeight - rect.height - 10);
        }
        if (left + rect.width > window.innerWidth - 10) {
            left = Math.max(10, window.innerWidth - rect.width - 10);
        }

        this.domContainer.style.left = `${left}px`;
        this.domContainer.style.top = `${top}px`;
    }

    selectItem(item) {
        if (!this.target || !item) return;
        this.isSelecting = true;
        this.justSelectedItem = true;

        const fullVal = this.target.value || "";
        const before = fullVal.substring(0, this.tagwordStart);
        const after = fullVal.substring(this.tagwordEnd);

        const cleanBefore = before.trimEnd();
        const prefix = (cleanBefore.length > 0 && !cleanBefore.endsWith(",")) ? ", " : (cleanBefore.length > 0 && cleanBefore.endsWith(",") && !before.endsWith(" ") ? " " : "");
        const insertChunk = prefix + item.filename + ", ";

        const nextVal = cleanBefore + insertChunk + after.replace(/^[\s,]*/, "");
        this.target.value = nextVal;

        const newPos = cleanBefore.length + insertChunk.length;
        this.target.setSelectionRange(newPos, newPos);

        this.target.dispatchEvent(new Event("input", { bubbles: true }));
        this.target.dispatchEvent(new Event("change", { bubbles: true }));
        this.target.classList.remove("ac-invalid-csv-border");

        // Keep focus and immediately refresh for continuous multi-selection
        this.target.focus();
        this.trigger(this.target);
        this.isSelecting = false;

        setTimeout(() => {
            this.justSelectedItem = false;
        }, 150);
    }

    scrollActiveIntoView() {
        const active = this.domList.querySelector("li.selected");
        if (active) {
            active.scrollIntoView({ block: "nearest" });
        }
    }

    handleKeyDown(e) {
        if (!this.isVisible) return false;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.selectedIndex = (this.selectedIndex + 1) % this.results.length;
            this.updateSelection();
            return true;
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.selectedIndex = (this.selectedIndex - 1 + this.results.length) % this.results.length;
            this.updateSelection();
            return true;
        } else if (e.key === "Enter" || e.key === "Tab") {
            if (this.results.length > 0) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.selectItem(this.results[this.selectedIndex]);
                return true;
            }
        } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.hide();
            return true;
        }
        return false;
    }

    updateSelection() {
        const items = this.domList.querySelectorAll("li");
        items.forEach((it, idx) => {
            if (idx === this.selectedIndex) {
                it.classList.add("selected");
            } else {
                it.classList.remove("selected");
            }
        });
        this.scrollActiveIntoView();
    }

    async handleBlur(element) {
        if (!element) return;
        const rawVal = element.value || "";
        const tokens = rawVal.split(",").map(s => s.trim()).filter(Boolean);
        const normalized = tokens.join(", ");
        if (element.value !== normalized) {
            element.value = normalized;
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
        }

        if (tokens.length > 0) {
            const available = await fetchAvailableCsvDictionaries();
            const validSet = new Set(available.map(f => f.filename.toLowerCase()));
            const hasInvalid = tokens.some(t => !validSet.has(t.toLowerCase()));
            if (hasInvalid) {
                element.classList.add("ac-invalid-csv-border");
            } else {
                element.classList.remove("ac-invalid-csv-border");
            }
        } else {
            element.classList.remove("ac-invalid-csv-border");
        }

        this.hide();
    }

    hide() {
        this.domContainer.style.display = "none";
        this.isVisible = false;
    }
}

export const csvDictionaryPicker = new CsvDictionaryPicker();

/**
 * Initializes listeners for AutocompletePlusDictionariesController
 */
export function setupDictionariesControllerComponent() {
    document.addEventListener("focusin", (e) => {
        if (isDictionariesControllerTextarea(e.target)) {
            const node = getNodeForDictionariesElement(e.target);
            if (node) syncDictionariesControllerWidgetState(node);

            if (isDictionariesControllerOverrideMode(e.target)) {
                csvDictionaryPicker.prepareRefocusComma(e.target);
                csvDictionaryPicker.trigger(e.target);
            }
        }
    });

    document.addEventListener("click", (e) => {
        if (csvDictionaryPicker.justSelectedItem) {
            return; // Don't close on trailing click event from list selection
        }

        if (isDictionariesControllerTextarea(e.target)) {
            const node = getNodeForDictionariesElement(e.target);
            if (node) syncDictionariesControllerWidgetState(node);

            if (isDictionariesControllerOverrideMode(e.target)) {
                if (csvDictionaryPicker.isVisible && csvDictionaryPicker.target === e.target) {
                    return; // Already open & active, keep stable
                }
                const val = (e.target.value || "").trimEnd();
                if (val.length > 0 && !val.endsWith(",") && (e.target.selectionStart || 0) >= val.length) {
                    csvDictionaryPicker.prepareRefocusComma(e.target);
                }
                csvDictionaryPicker.trigger(e.target);
            }
        } else if (!csvDictionaryPicker.domContainer.contains(e.target)) {
            csvDictionaryPicker.hide();
        }
    });

    document.addEventListener("input", (e) => {
        if (isDictionariesControllerTextarea(e.target)) {
            if (isDictionariesControllerOverrideMode(e.target)) {
                csvDictionaryPicker.trigger(e.target);
            }
        }
    });

    document.addEventListener("keydown", (e) => {
        if (isDictionariesControllerTextarea(e.target)) {
            if (isDictionariesControllerOverrideMode(e.target)) {
                const handled = csvDictionaryPicker.handleKeyDown(e);
                if (handled) return;
            }
        }
    }, true);

    document.addEventListener("focusout", (e) => {
        if (isDictionariesControllerTextarea(e.target)) {
            if (csvDictionaryPicker.justSelectedItem || csvDictionaryPicker.isSelecting) {
                return;
            }
            setTimeout(() => {
                if (csvDictionaryPicker.justSelectedItem || csvDictionaryPicker.isSelecting) return;
                if (document.activeElement !== e.target && !csvDictionaryPicker.domContainer.contains(document.activeElement)) {
                    csvDictionaryPicker.handleBlur(e.target);
                }
            }, 120);
        }
    });

    window.addEventListener("resize", () => {
        if (csvDictionaryPicker.isVisible) csvDictionaryPicker.updatePosition();
    });

    window.addEventListener("wheel", () => {
        if (csvDictionaryPicker.isVisible) csvDictionaryPicker.updatePosition();
    }, { passive: true });
}
