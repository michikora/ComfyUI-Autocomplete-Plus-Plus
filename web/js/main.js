import { app } from "/scripts/app.js";
import { ComfyWidgets } from "/scripts/widgets.js";
import { registerSettings, refreshAvailableFiles, settingValues, persistSetting, logDebug } from "./settings.js";
import { TagCompleteEngine } from "./autocomplete.js";
import { formatTextareaOnBlur, setupFormattingControllerNodeHooks } from "./auto-formatter.js";
import { setupPromptExpansionInterceptor } from "./prompt-expander.js";
import { attachHotkeysToTextarea } from "./hotkeys.js";
import { setupDictionariesControllerComponent, setupDictionariesControllerNodeHooks, isDictionariesControllerTextarea } from "./dictionaries-controller.js";
import { refreshCivitaiHost, fetchLMSyntaxFormat } from "./lora-manager-provider.js";

const extensionId = "ComfyUI.AutocompletePlusPlus";
const extensionName = "Autocomplete++";

const attachedElements = new WeakSet();
let engine = null;

export function getTagCompleteEngine() {
    return engine;
}

function loadCSS(url) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.type = "text/css";
    link.href = url;
    document.head.appendChild(link);
}

export function isNodeDefaultExcluded(node) {
    if (!node) return false;
    const nodeType = String(node.type || node.comfyClass || "").trim().toLowerCase();
    // Native ComfyUI Note node (exact match)
    if (nodeType === "note") return true;
    return false;
}

export function isNodeIgnored(node) {
    if (!node) return false;
    const rawList = settingValues.ignoredNodeTypes || "";
    const patterns = rawList
        .split(/[,\n]/)
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);

    if (patterns.length === 0) return false;

    const nodeType = String(node.type || node.comfyClass || "").toLowerCase();
    if (!nodeType) return false;

    return patterns.some(pattern => nodeType.includes(pattern));
}

export function toggleIgnoredNodeType(typeStr) {
    if (!typeStr) return;
    const cleanType = String(typeStr).trim();
    const cleanTypeLower = cleanType.toLowerCase();

    let currentList = (settingValues.ignoredNodeTypes || "")
        .split(/[,\n]/)
        .map(s => s.trim())
        .filter(Boolean);

    const index = currentList.findIndex(item => item.toLowerCase() === cleanTypeLower);
    if (index >= 0) {
        currentList.splice(index, 1);
    } else {
        currentList.push(cleanType);
    }

    const newString = currentList.join(", ");
    settingValues.ignoredNodeTypes = newString;
    persistSetting("IgnoredNodeTypes", newString);

    window.dispatchEvent(new CustomEvent("tagcomplete-ignored-nodes-updated", { detail: newString }));
}

export function isNodeOverridden(node) {
    if (!node) return false;
    const rawList = settingValues.overrideNodeTypes || "";
    const patterns = rawList
        .split(/[,\n]/)
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);

    if (patterns.length === 0) return false;

    const nodeType = String(node.type || node.comfyClass || "").toLowerCase();
    if (!nodeType) return false;

    return patterns.some(pattern => nodeType.includes(pattern));
}

export function toggleOverrideNodeType(typeStr) {
    if (!typeStr) return;
    const cleanType = String(typeStr).trim();
    const cleanTypeLower = cleanType.toLowerCase();

    let currentList = (settingValues.overrideNodeTypes || "")
        .split(/[,\n]/)
        .map(s => s.trim())
        .filter(Boolean);

    const index = currentList.findIndex(item => item.toLowerCase() === cleanTypeLower);
    if (index >= 0) {
        currentList.splice(index, 1);
    } else {
        currentList.push(cleanType);
    }

    const newString = currentList.join(", ");
    settingValues.overrideNodeTypes = newString;
    persistSetting("OverrideNodeTypes", newString);

    window.dispatchEvent(new CustomEvent("tagcomplete-override-nodes-updated", { detail: newString }));
}

export function isOverriddenTarget(element) {
    if (!element) return false;
    const node = getNodeForElement(element);
    if (node) {
        if (node.properties && node.properties.ac_enabled === false) return false;
        if (node.properties && node.properties.ac_enabled === true) return true;
        return isNodeOverridden(node);
    }
    return false;
}

export const CONTROLLER_TYPES = new Set([
    "AutocompletePlusController",
    "AutocompletePlusFormattingController",
    "AutocompletePlusIntegrationsController",
    "AutocompletePlusDictionariesController"
]);

export function isInternalControllerNodeType(name) {
    if (!name) return false;
    return CONTROLLER_TYPES.has(name);
}

export let activeApp = null;

export function getAppGraph() {
    if (activeApp?.graph) return activeApp.graph;
    if (activeApp?.rootGraph) return activeApp.rootGraph;
    if (activeApp?.canvas?.graph) return activeApp.canvas.graph;
    if (typeof app !== "undefined" && app?.graph) return app.graph;
    if (typeof app !== "undefined" && app?.rootGraph) return app.rootGraph;
    if (typeof app !== "undefined" && app?.canvas?.graph) return app.canvas.graph;
    if (typeof window !== "undefined" && window.app?.graph) return window.app.graph;
    if (typeof window !== "undefined" && window.app?.rootGraph) return window.app.rootGraph;
    if (typeof window !== "undefined" && window.app?.canvas?.graph) return window.app.canvas.graph;
    if (typeof window !== "undefined" && window.comfyAPI?.app?.app?.graph) return window.comfyAPI.app.app.graph;
    return null;
}

// Track last interacted controller node ID by controller type name
const lastActiveNodeIdByType = new Map();

export function notifyControllerInteracted(node) {
    if (!node) return;
    const typeName = node.type || node.comfyClass;
    if (typeName && CONTROLLER_TYPES.has(typeName)) {
        lastActiveNodeIdByType.set(typeName, node.id);
        setTimeout(syncControllerStatusBadges, 20);
    }
}

export function getActiveControllerNode(controllerTypeName) {
    const graph = getAppGraph();
    if (!graph || !graph._nodes) return null;

    // 1. Filter nodes of this controller type that are NOT muted (mode === 2) and NOT bypassed (mode === 4)
    const validNodes = graph._nodes.filter(
        n => n && (n.type === controllerTypeName || n.comfyClass === controllerTypeName) && n.mode !== 2 && n.mode !== 4
    );

    if (validNodes.length === 0) return null;
    if (validNodes.length === 1) return validNodes[0];

    // 2. If multiple nodes exist: check if user recently modified/touched one of them
    const lastId = lastActiveNodeIdByType.get(controllerTypeName);
    if (lastId !== undefined) {
        const matched = validNodes.find(n => n.id === lastId);
        if (matched) return matched;
    }

    // 3. Fallback: highest ID (latest created node) wins
    validNodes.sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
    return validNodes[0];
}

export function syncControllerStatusBadges() {
    const graph = getAppGraph();
    if (!graph || !graph._nodes) return;

    for (const typeName of CONTROLLER_TYPES) {
        const allNodes = graph._nodes.filter(
            n => n && (n.type === typeName || n.comfyClass === typeName)
        );

        const validNodes = allNodes.filter(n => n.mode !== 2 && n.mode !== 4);
        const activeNode = getActiveControllerNode(typeName);

        for (const node of allNodes) {
            // When there is only 1 controller on canvas, keep clean (no badge)
            if (allNodes.length <= 1) {
                removeControllerStatusBadge(node);
                continue;
            }

            const isMuted = node.mode === 2 || node.mode === 4;
            const isActive = !isMuted && activeNode && activeNode.id === node.id;

            if (isActive) {
                renderControllerStatusBadge(
                    node,
                    "Active",
                    `Active Controller (Node #${node.id}): Driving settings for this workflow`,
                    "active"
                );
            } else {
                const activeId = activeNode ? `#${activeNode.id}` : "another node";
                const tooltip = isMuted
                    ? `Muted/Bypassed: Overridden by active Node ${activeId}`
                    : `Inactive: Overridden by active Node ${activeId}. Click to activate.`;
                renderControllerStatusBadge(node, "Inactive", tooltip, "inactive");
            }
        }
    }
}

function renderControllerStatusBadge(node, text, tooltip, state) {
    if (!node || node.id === undefined) return;

    const nodeBody = document.querySelector(`[data-testid="node-body-${node.id}"]`) ||
                     document.querySelector(`[data-widgets-grid-node-id="${node.id}"]`)?.closest(`[data-testid^="node-body-"]`) ||
                     document.querySelector(`div[node-id="${node.id}"]`)?.closest(`[data-testid^="node-body-"]`);

    if (!nodeBody) return;

    const footer = nodeBody.querySelector(".flex.h-5.w-full, div.mt-auto") || nodeBody.lastElementChild;
    if (!footer) return;

    let badge = footer.querySelector(".ac-controller-status-badge");
    if (!badge) {
        badge = document.createElement("div");
        badge.className = "ac-controller-status-badge";
        badge.onclick = (e) => {
            e.stopPropagation();
            notifyControllerInteracted(node);
            syncControllerStatusBadges();
            const graph = getAppGraph();
            if (graph?.setDirtyCanvas) graph.setDirtyCanvas(true, true);
        };
        footer.appendChild(badge);
    }

    badge.className = `ac-controller-status-badge ac-status-${state}`;
    badge.textContent = text;
    badge.title = tooltip;
}

function removeControllerStatusBadge(node) {
    if (!node || node.id === undefined) return;
    const nodeBody = document.querySelector(`[data-testid="node-body-${node.id}"]`) ||
                     document.querySelector(`[data-widgets-grid-node-id="${node.id}"]`)?.closest(`[data-testid^="node-body-"]`) ||
                     document.querySelector(`div[node-id="${node.id}"]`)?.closest(`[data-testid^="node-body-"]`);
    if (!nodeBody) return;
    const badge = nodeBody.querySelector(".ac-controller-status-badge");
    if (badge) badge.remove();
}

export function isNodeEffectivelyExcluded(node) {
    if (!node) return false;

    // 1. Instance-level override:
    if (node.properties && node.properties.ac_enabled !== undefined) {
        return !node.properties.ac_enabled;
    }

    // 2. Global defaults:
    // (a) Native Note node: default disabled/excluded unless explicitly enabled
    if (isNodeDefaultExcluded(node)) {
        return true;
    }

    // (b) Standard nodes: check global ignored list
    return isNodeIgnored(node);
}

export function isNodeEffectivelyActive(node) {
    return !isNodeEffectivelyExcluded(node);
}

export function getNodeForElement(element) {
    if (!element) return null;

    const graph = getAppGraph();

    // 1. ComfyUI 2.0 DOM structure:
    // (a) Inner widget container with node-id attribute: <div node-id="236" node-type="Note">
    const widgetContainer = element.closest("[node-id]");
    if (widgetContainer) {
        const rawId = widgetContainer.getAttribute("node-id");
        if (rawId && graph) {
            const nodeId = Number(rawId);
            const node = graph.getNodeById ? graph.getNodeById(nodeId) : graph._nodes?.find(n => n.id === nodeId);
            if (node) return node;
        }
    }

    // (b) Outer node card container: <div data-node-id="236" class="lg-node ...">
    const nodeContainer = element.closest(".lg-node[data-node-id], [data-node-id], .graph-node, .litegraph.node, .comfy-node");
    if (nodeContainer) {
        const rawId = nodeContainer.getAttribute("data-node-id") || nodeContainer.dataset?.nodeId;
        if (rawId && graph) {
            const nodeId = Number(rawId);
            const node = graph.getNodeById ? graph.getNodeById(nodeId) : graph._nodes?.find(n => n.id === nodeId);
            if (node) return node;
        }
    }

    // 2. Classic LiteGraph widgets (Old UI canvas widgets)
    if (graph && graph._nodes) {
        for (const node of graph._nodes) {
            if (node.widgets) {
                for (const w of node.widgets) {
                    if (
                        w.element === element ||
                        w.inputEl === element ||
                        w === element ||
                        (w.element && typeof w.element.contains === "function" && w.element.contains(element)) ||
                        (w.inputEl && typeof w.inputEl.contains === "function" && w.inputEl.contains(element))
                    ) {
                        return node;
                    }
                }
            }
        }
    }

    // 3. Fallback: Canvas active / interacted node during typing
    const canvas = window.app?.canvas || app?.canvas;
    if (canvas?.current_node) {
        const curr = canvas.current_node;
        if (curr.widgets) {
            for (const w of curr.widgets) {
                if (w.element === element || w.inputEl === element || w === element) {
                    return curr;
                }
            }
        }
    }

    // 4. Legacy element ID fallback (v-nodeId-widgetName)
    if (element.id) {
        const match = String(element.id).match(/^v-(\d+)-/);
        if (match && graph) {
            const nodeId = Number(match[1]);
            const node = graph.getNodeById ? graph.getNodeById(nodeId) : graph._nodes?.find(n => n.id === nodeId);
            if (node) return node;
        }
    }

    return null;
}

function isExcludedTarget(element) {
    if (!element) return false;
    if (isDictionariesControllerTextarea(element)) return true;

    // Resolve target node (supports both ComfyUI 2.0 DOM and classic LiteGraph UI)
    const node = getNodeForElement(element);
    if (node) {
        // Instance-level toggle
        if (node.properties && node.properties.ac_enabled !== undefined) {
            return !node.properties.ac_enabled;
        }

        // Global type-level override
        if (isNodeOverridden(node)) {
            return false;
        }

        return isNodeEffectivelyExcluded(node);
    }

    // Check if element belongs to an explicitly overridden node (fallback)
    if (isOverriddenTarget(element)) return false;

    // Check if element is inside a ComfyUI modal / settings dialog
    const isModalOrDialog = !!element.closest(".p-dialog, .comfy-modal, .comfy-settings, .p-dialog-content, [role='dialog'], [data-testid='settings-dialog']");
    if (isModalOrDialog) {
        // In modal / settings dialogs, only allow textareas explicitly configured for autocomplete (such as Keep Underscores)
        if (element.dataset?.acKeepUnderscores !== "true") {
            return true;
        }
    }

    // Fallback: If DOM explicitly declares node-type="Note" but node instance was not found in graph
    const domNodeType = element.closest("[node-type]")?.getAttribute("node-type");
    if (domNodeType && domNodeType.toLowerCase() === "note") {
        return true;
    }

    return false;
}

function syncWidgetValue(element) {
    if (!element) return;
    const node = getNodeForElement(element);
    if (node && node.widgets) {
        for (const w of node.widgets) {
            if (
                w.element === element ||
                w.inputEl === element ||
                w === element ||
                (w.element && typeof w.element.contains === "function" && w.element.contains(element)) ||
                w.name === "text"
            ) {
                w.value = element.value;
                return;
            }
        }
    }
}

function attachListenersToTextarea(element) {
    if (!element || element.tagName !== "TEXTAREA") return;
    if (attachedElements.has(element)) return;

    attachedElements.add(element);
    attachHotkeysToTextarea(element);

    element.addEventListener("focus", () => {
        if (isOverriddenTarget(element)) {
            document.body.classList.add("ac-node-override-active");
            element.setAttribute("data-ac-override", "true");
        } else {
            document.body.classList.remove("ac-node-override-active");
            element.removeAttribute("data-ac-override");
        }
    });

    element.addEventListener("blur", () => {
        document.body.classList.remove("ac-node-override-active");
        element.removeAttribute("data-ac-override");
        if (engine) engine.handleBlur();
        if (!isExcludedTarget(element) && !element.readOnly && !element.disabled) {
            formatTextareaOnBlur(element, settingValues);
        }
    });

    // Capture-phase keydown interceptor (intercepts keys before other extensions)
    element.addEventListener("keydown", (e) => {
        if (isExcludedTarget(e.target)) return;

        const isOverridden = isOverriddenTarget(e.target);
        if (isOverridden && engine && engine.isVisible) {
            const key = e.key;
            if (key === "Tab" || key === "Enter" || key === "ArrowUp" || key === "ArrowDown" || key === "Escape" || key === "PageUp" || key === "PageDown") {
                e.stopImmediatePropagation();
            }
        }
        if (engine) engine.handleKeyDown(e);
    }, true);

    // Capture-phase input interceptor
    element.addEventListener("input", (e) => {
        if (isExcludedTarget(e.target)) {
            if (engine) engine.hide();
            return;
        }

        const isOverridden = isOverriddenTarget(e.target);
        if (isOverridden) {
            e.stopImmediatePropagation();
            syncWidgetValue(e.target);
        }

        if (engine) engine.handleInput(e);
    }, true);

    // Capture-phase keyup interceptor
    element.addEventListener("keyup", (e) => {
        if (isOverriddenTarget(e.target)) {
            e.stopImmediatePropagation();
        }
        if (engine) engine.handleKeyUp(e);
    }, true);

    element.addEventListener("click", () => {
        if (isExcludedTarget(element)) {
            if (engine) engine.hide();
            return;
        }
        if (engine && engine.isVisible) {
            engine.updatePosition();
        }
    });
}

function initializeDOMObserver() {
    const SELECTORS = [
        "textarea.comfy-multiline-input",
        "textarea.p-inputtextarea",
        "textarea.node-textarea",
        ".litegraph textarea",
        "textarea"
    ];

    function scanElement(root) {
        if (!root) return;
        SELECTORS.forEach(selector => {
            if (root.matches && root.matches(selector)) {
                attachListenersToTextarea(root);
            }
            const found = root.querySelectorAll(selector);
            found.forEach(attachListenersToTextarea);
        });
    }

    scanElement(document.body);

    const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    scanElement(node);
                }
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });

    if (ComfyWidgets && ComfyWidgets.STRING) {
        const originalStringWidget = ComfyWidgets.STRING;
        ComfyWidgets.STRING = function (node, inputName, inputData, appInstance) {
            const result = originalStringWidget.apply(this, arguments);
            if (result && result.widget) {
                const inputEl = result.widget.element ?? result.widget.inputEl;
                if (inputEl && inputEl.tagName === "TEXTAREA") {
                    attachListenersToTextarea(inputEl);
                }
            }
            return result;
        };
    }

    window.addEventListener("resize", () => {
        if (engine && engine.isVisible) engine.updatePosition();
    });
    window.addEventListener("wheel", () => {
        if (engine && engine.isVisible) engine.updatePosition();
    }, { passive: true });
}

export function isNodeTextCapable(node) {
    if (!node) return false;
    if (isNodeDefaultExcluded(node)) return true; // Note node is always text-capable

    const type = String(node.type || node.comfyClass || "").toLowerCase();
    if (type.includes("primitive") || type.includes("text") || type.includes("prompt") || type.includes("string") || type.includes("note")) {
        return true;
    }

    if (node.widgets && Array.isArray(node.widgets)) {
        return node.widgets.some(w => {
            if (!w) return false;
            const wType = String(w.type || "").toLowerCase();
            const wName = String(w.name || "").toLowerCase();
            return wType === "text" || wType === "customtext" || wType === "string" || 
                   w.element?.tagName === "TEXTAREA" || w.inputEl?.tagName === "TEXTAREA" ||
                   wName.includes("text") || wName.includes("prompt");
        });
    }

    return false;
}

export function appendNodeContextMenuOptions(node, nodeTypeName, options) {
    if (!node || !nodeTypeName || !Array.isArray(options)) return;
    if (isInternalControllerNodeType(nodeTypeName)) return;

    // Only show menu for nodes that possess text inputs
    if (!isNodeTextCapable(node)) return;

    const hasAcOption = options.some(opt => opt && typeof opt.content === "string" && opt.content.startsWith("Autocomplete++"));
    if (hasAcOption) return;

    const isNote = isNodeDefaultExcluded(node);
    const submenuOptions = [];

    if (isNote) {
        // Native Note node: simple clean toggle
        const isEnabled = isNodeEffectivelyActive(node);
        submenuOptions.push({
            content: isEnabled ? "Disable for this node" : "Enable for this node",
            callback: () => {
                node.properties = node.properties || {};
                node.properties.ac_enabled = !isEnabled;
                const graph = getAppGraph() || node.graph;
                if (graph?.setDirtyCanvas) graph.setDirtyCanvas(true, true);
            }
        });
    } else {
        const ignored = isNodeIgnored(node);
        submenuOptions.push({
            content: ignored ? "Unignore this node type" : "Ignore this node type",
            callback: () => {
                toggleIgnoredNodeType(nodeTypeName);
            }
        });

        const overridden = isNodeOverridden(node);
        submenuOptions.push({
            content: overridden ? "Remove override for this node type" : "Force override this node type",
            callback: () => {
                toggleOverrideNodeType(nodeTypeName);
            }
        });

        submenuOptions.push(null);

        const isCurrentlyActive = isNodeEffectivelyActive(node);
        submenuOptions.push({
            content: isCurrentlyActive ? "Disable for this node" : "Enable for this node",
            callback: () => {
                node.properties = node.properties || {};
                node.properties.ac_enabled = !isCurrentlyActive;
                const graph = getAppGraph() || node.graph;
                if (graph?.setDirtyCanvas) graph.setDirtyCanvas(true, true);
            }
        });

        if (node.properties && node.properties.ac_enabled !== undefined) {
            submenuOptions.push({
                content: "Reset to default for this node",
                callback: () => {
                    delete node.properties.ac_enabled;
                    const graph = getAppGraph() || node.graph;
                    if (graph?.setDirtyCanvas) graph.setDirtyCanvas(true, true);
                }
            });
        }
    }

    options.push({
        content: "Autocomplete++",
        has_submenu: true,
        submenu: {
            options: submenuOptions
        }
    });
}

function setupNodeContextMenuHooks() {
    const LGraphCanvas = window.LGraphCanvas || window.LiteGraph?.LGraphCanvas;
    if (LGraphCanvas && LGraphCanvas.prototype && !LGraphCanvas.prototype.__ac_canvas_menu_hooked) {
        LGraphCanvas.prototype.__ac_canvas_menu_hooked = true;
        const origGetNodeMenuOptions = LGraphCanvas.prototype.getNodeMenuOptions;
        LGraphCanvas.prototype.getNodeMenuOptions = function (node) {
            const options = origGetNodeMenuOptions ? origGetNodeMenuOptions.apply(this, arguments) : [];
            if (node && Array.isArray(options)) {
                const nodeTypeName = node.type || node.comfyClass || "";
                appendNodeContextMenuOptions(node, nodeTypeName, options);
            }
            return options;
        };
    }
}

app.registerExtension({
    name: extensionName,
    id: extensionId,

    async beforeRegisterNodeDef(nodeType, nodeData) {
        setupDictionariesControllerNodeHooks(nodeType, nodeData);
        setupFormattingControllerNodeHooks(nodeType, nodeData);

        // Hook all internal controller nodes to notify user interactions and manage badges
        const typeName = nodeData?.name;
        if (isInternalControllerNodeType(typeName)) {
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function() {
                const r = origOnNodeCreated ? origOnNodeCreated.apply(this, arguments) : undefined;
                if (this.widgets && Array.isArray(this.widgets)) {
                    for (const w of this.widgets) {
                        const origCb = w.callback;
                        const self = this;
                        w.callback = function() {
                            const cbR = origCb ? origCb.apply(this, arguments) : undefined;
                            notifyControllerInteracted(self);
                            return cbR;
                        };
                    }
                }
                setTimeout(syncControllerStatusBadges, 100);
                return r;
            };

            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function() {
                const r = origOnConfigure ? origOnConfigure.apply(this, arguments) : undefined;
                setTimeout(syncControllerStatusBadges, 150);
                return r;
            };

            const origOnRemoved = nodeType.prototype.onRemoved;
            nodeType.prototype.onRemoved = function() {
                const r = origOnRemoved ? origOnRemoved.apply(this, arguments) : undefined;
                setTimeout(syncControllerStatusBadges, 100);
                return r;
            };

            const origOnModeChange = nodeType.prototype.onModeChange;
            nodeType.prototype.onModeChange = function() {
                const r = origOnModeChange ? origOnModeChange.apply(this, arguments) : undefined;
                setTimeout(syncControllerStatusBadges, 50);
                return r;
            };
        }

        const origGetExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
            if (origGetExtraMenuOptions) {
                try {
                    origGetExtraMenuOptions.apply(this, arguments);
                } catch (e) {
                    console.error("[Autocomplete++] Error in origGetExtraMenuOptions:", e);
                }
            }

            try {
                const nodeTypeName = nodeData?.name || this.type || (this.comfyClass ? this.comfyClass : "");
                appendNodeContextMenuOptions(this, nodeTypeName, options);
            } catch (e) {
                console.error("[Autocomplete++] Error in nodeType getExtraMenuOptions:", e);
            }
        };
    },

    async setup(appInstance) {
        activeApp = appInstance || app;
        if (typeof window !== "undefined") window.activeComfyApp = activeApp;
        logDebug(`[Autocomplete++] Initializing ${extensionName}...`);

        let rootPath = import.meta.url.replace(/js\/main\.js(\?.*)?$/, "");
        loadCSS(rootPath + "css/autocomplete-plus.css");

        if (settingValues.loraManagerMode !== "Disabled") {
            refreshCivitaiHost().catch(() => {});
            fetchLMSyntaxFormat().catch(() => {});
        }

        await refreshAvailableFiles();
        registerSettings(app);

        engine = new TagCompleteEngine();
        if (typeof window !== "undefined") window.tagCompleteEngine = engine;
        await engine.loadAllData();

        initializeDOMObserver();
        setupPromptExpansionInterceptor();
        setupDictionariesControllerComponent();
        setInterval(syncControllerStatusBadges, 1000);
        setupNodeContextMenuHooks();

        logDebug(`[Autocomplete++] Setup completed successfully.`);
    }
});
