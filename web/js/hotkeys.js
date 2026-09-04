import { settingValues } from "./settings.js";

export function formatWeight(val, step = 0.05) {
    const stepStr = step.toString();
    const decimalPlaces = stepStr.includes(".") ? stepStr.split(".")[1].length : 2;
    const precision = Math.max(2, decimalPlaces);
    const rounded = Math.round(val * Math.pow(10, precision)) / Math.pow(10, precision);
    if (Object.is(rounded, -0) || rounded === 0) return "0.0";
    const cleanStr = parseFloat(rounded.toFixed(precision)).toString();
    return cleanStr.includes(".") ? cleanStr : cleanStr + ".0";
}

export function findEnclosingLora(text, selStart, selEnd = selStart) {
    if (!text || typeof text !== "string") return null;

    let loraStart = -1;
    for (let i = selStart; i >= 0; i--) {
        if (text[i] === '<') { loraStart = i; break; }
        if (text[i] === '>' && i < selStart) break;
        if (text[i] === '\n' || text[i] === ',') break;
    }
    if (loraStart === -1) return null;

    const forwardStart = Math.max(loraStart, selEnd > selStart ? selEnd - 1 : selStart);
    let loraEnd = -1;
    for (let j = forwardStart; j < text.length; j++) {
        if (text[j] === '>') { loraEnd = j + 1; break; }
        if (text[j] === '<' && j > loraStart) break;
        if (text[j] === '\n' || text[j] === ',') break;
    }
    if (loraEnd === -1) return null;

    if (selStart < loraStart || selEnd > loraEnd) return null;

    const candidate = text.substring(loraStart, loraEnd);
    if (/^<(lora|lyco):[^>]+>$/i.test(candidate) || /^<[^\s:>]+(?::[^\s:>]+)*:-?[0-9.]+>$/.test(candidate)) {
        return { start: loraStart, end: loraEnd, text: candidate };
    }
    return null;
}

export function adjustLoraWeight(loraText, direction, step = 0.05) {
    if (!loraText || !loraText.startsWith("<") || !loraText.endsWith(">")) return loraText;
    const inner = loraText.slice(1, -1);
    const parts = inner.split(":");
    const delta = direction === "up" ? step : -step;

    const p0Lower = parts[0].toLowerCase();
    const hasPrefix = p0Lower === "lora" || p0Lower === "lyco";

    if (hasPrefix) {
        if (parts.length === 2) {
            const newWeight = 1.0 + delta;
            return `<${parts[0]}:${parts[1]}:${formatWeight(newWeight, step)}>`;
        } else if (parts.length >= 3) {
            const cur = parseFloat(parts[2]);
            const base = isNaN(cur) ? 1.0 : cur;
            const newWeight = base + delta;
            return `<${parts[0]}:${parts[1]}:${formatWeight(newWeight, step)}>`;
        }
    } else if (parts.length >= 2) {
        const cur = parseFloat(parts[parts.length - 1]);
        const base = isNaN(cur) ? 1.0 : cur;
        const newWeight = base + delta;
        parts[parts.length - 1] = formatWeight(newWeight, step);
        return `<${parts.join(":")}>`;
    }
    return loraText;
}

export function findEnclosingParenthesisWeight(text, selStart, selEnd = selStart) {
    if (!text || typeof text !== "string") return null;

    let parenStart = -1;
    for (let i = selStart; i >= 0; i--) {
        if (text[i] === '(' && (i === 0 || text[i - 1] !== '\\')) { parenStart = i; break; }
        if (text[i] === ')' && i < selStart) break;
        if (text[i] === '\n' || text[i] === ',') break;
    }
    if (parenStart === -1) return null;

    const forwardStart = Math.max(parenStart, selEnd > selStart ? selEnd - 1 : selStart);
    let parenEnd = -1;
    for (let j = forwardStart; j < text.length; j++) {
        if (text[j] === ')' && (j === 0 || text[j - 1] !== '\\')) { parenEnd = j + 1; break; }
        if (text[j] === '(' && j > parenStart) break;
        if (text[j] === '\n' || text[j] === ',') break;
    }
    if (parenEnd === -1) return null;

    if (selStart < parenStart || selEnd > parenEnd) return null;

    const candidate = text.substring(parenStart, parenEnd);
    if (/^\([^()]+:-?[0-9.]+\)$/.test(candidate)) {
        return { start: parenStart, end: parenEnd, text: candidate };
    }
    return null;
}

export function adjustParenthesisWeight(tagText, direction, step = 0.05) {
    if (!tagText) return tagText;
    const delta = direction === "up" ? step : -step;

    if (tagText.startsWith("(") && tagText.endsWith(")")) {
        const inner = tagText.slice(1, -1);
        const lastColonIdx = inner.lastIndexOf(":");
        const tagContent = lastColonIdx !== -1 ? inner.substring(0, lastColonIdx) : inner;
        const cur = lastColonIdx !== -1 ? parseFloat(inner.substring(lastColonIdx + 1)) : 1.0;
        const base = isNaN(cur) ? 1.0 : cur;
        const newWeight = base + delta;

        const stepStr = step.toString();
        const decimalPlaces = stepStr.includes(".") ? stepStr.split(".")[1].length : 2;
        const precision = Math.max(2, decimalPlaces);
        const rounded = Math.round(newWeight * Math.pow(10, precision)) / Math.pow(10, precision);

        if (rounded === 1.0) {
            return tagContent;
        }
        return `(${tagContent}:${formatWeight(newWeight, step)})`;
    }

    const base = 1.0;
    const newWeight = base + delta;
    return `(${tagText}:${formatWeight(newWeight, step)})`;
}

export function findTagBoundariesForWeight(text, cursor) {
    if (!text || typeof text !== "string") return null;

    // 1. Check if cursor is inside a LoRA <lora:name:weight> or <name:weight>
    const loraMatch = findEnclosingLora(text, cursor, cursor);
    if (loraMatch) {
        return { isLora: true, start: loraMatch.start, end: loraMatch.end, text: loraMatch.text };
    }

    // 2. Check if cursor is inside a Wildcard __name__
    let wcStart = -1;
    for (let i = cursor; i >= 2; i--) {
        if (text.substring(i - 2, i) === '__') { wcStart = i - 2; break; }
        if (text[i - 1] === '\n' || text[i - 1] === ',') break;
    }
    if (wcStart !== -1) {
        let wcEnd = -1;
        for (let j = wcStart + 2; j <= text.length - 2; j++) {
            if (text.substring(j, j + 2) === '__') { wcEnd = j + 2; break; }
            if (text[j] === '\n' || text[j] === ',') break;
        }
        if (wcEnd !== -1 && cursor >= wcStart && cursor <= wcEnd) {
            return { isWildcard: true, start: wcStart, end: wcEnd, text: text.substring(wcStart, wcEnd) };
        }
    }

    // 3. Already weighted tag (tag:1.x)
    const weightedMatch = findEnclosingParenthesisWeight(text, cursor, cursor);
    if (weightedMatch) {
        return { isAlreadyWeighted: true, start: weightedMatch.start, end: weightedMatch.end, text: weightedMatch.text };
    }

    // 4. Standard Tag Boundary Scan (scanning left and right to delimiters , | { } [ ] \n \r)
    let start = cursor;
    while (start > 0) {
        const c = text[start - 1];
        const isEscaped = (start - 2 >= 0 && text[start - 2] === '\\');
        if (c === ',' || c === '\n' || c === '\r' || (!isEscaped && (c === '|' || c === '{' || c === '}' || c === '[' || c === ']'))) {
            break;
        }
        start--;
    }

    let end = cursor;
    while (end < text.length) {
        const c = text[end];
        const isEscaped = (end > 0 && text[end - 1] === '\\');
        if (c === ',' || c === '\n' || c === '\r' || (!isEscaped && (c === '|' || c === '{' || c === '}' || c === '[' || c === ']'))) {
            break;
        }
        end++;
    }

    const raw = text.substring(start, end);
    const leadingWs = raw.length - raw.trimStart().length;
    const trailingWs = raw.length - raw.trimEnd().length;

    const trimmedStart = start + leadingWs;
    const trimmedEnd = end - trailingWs;

    if (trimmedStart >= trimmedEnd) return null;

    return {
        isTag: true,
        start: trimmedStart,
        end: trimmedEnd,
        text: text.substring(trimmedStart, trimmedEnd)
    };
}

export function getTagLandingPositions(text) {
    const positions = [];
    if (!text) return positions;

    let i = 0;
    while (i < text.length) {
        while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === ',' || text[i] === '\n' || text[i] === '\r')) {
            i++;
        }
        if (i >= text.length) break;

        // 1. Dynamic Prompt container { ... }
        if (text[i] === '{') {
            let braceEnd = -1;
            let depth = 0;
            for (let j = i; j < text.length; j++) {
                if (text[j] === '{') depth++;
                else if (text[j] === '}') {
                    depth--;
                    if (depth === 0) { braceEnd = j; break; }
                }
            }

            if (braceEnd !== -1) {
                const inner = text.substring(i + 1, braceEnd);
                let optStart = i + 1;
                const options = inner.split(/\|/);
                for (let k = 0; k < options.length; k++) {
                    const opt = options[k];
                    let subStart = optStart;
                    const subTags = opt.split(/,/);
                    for (let s = 0; s < subTags.length; s++) {
                        const st = subTags[s];
                        const trimmedEnd = subStart + st.trimEnd().length;
                        const trimmedStart = subStart + (st.length - st.trimStart().length);
                        if (trimmedEnd > trimmedStart) {
                            positions.push(trimmedEnd);
                        }
                        subStart += st.length + 1;
                    }
                    optStart += opt.length + 1;
                }
                i = braceEnd + 1;
                continue;
            }
        }

        // 2. LoRA <lora:name:weight>
        if (text[i] === '<') {
            const closeIdx = text.indexOf('>', i);
            if (closeIdx !== -1) {
                positions.push(closeIdx + 1);
                i = closeIdx + 1;
                continue;
            }
        }

        // 3. Wildcard __name__
        if (text.substring(i, i + 2) === '__') {
            const closeWc = text.indexOf('__', i + 2);
            if (closeWc !== -1) {
                positions.push(closeWc + 2);
                i = closeWc + 2;
                continue;
            }
        }

        // 4. Standard Tag (scan to next delimiter)
        let tagStart = i;
        while (i < text.length && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r' && text[i] !== '{') {
            i++;
        }
        const tagContent = text.substring(tagStart, i);
        const trimmedEnd = tagStart + tagContent.trimEnd().length;
        if (trimmedEnd > tagStart) {
            positions.push(trimmedEnd);
        }
    }

    return [...new Set(positions)].sort((a, b) => a - b);
}

export function calculateTagJumpPosition(text, cursor, direction) {
    const positions = getTagLandingPositions(text);
    if (positions.length === 0) return cursor;

    if (direction === "right") {
        for (const pos of positions) {
            if (pos > cursor) return pos;
        }
        return text.length;
    } else {
        for (let i = positions.length - 1; i >= 0; i--) {
            if (positions[i] < cursor) return positions[i];
        }
        return 0;
    }
}

export function parseTopLevelTokens(line) {
    const tokens = [];
    let i = 0;
    while (i < line.length) {
        while (i < line.length && (line[i] === ' ' || line[i] === '\t' || line[i] === ',')) {
            i++;
        }
        if (i >= line.length) break;

        const tokenStart = i;

        // 1. Dynamic Prompt Block { ... }
        if (line[i] === '{') {
            let depth = 0;
            let closeIdx = -1;
            for (let j = i; j < line.length; j++) {
                if (line[j] === '{') depth++;
                else if (line[j] === '}') {
                    depth--;
                    if (depth === 0) { closeIdx = j; break; }
                }
            }
            if (closeIdx !== -1) {
                tokens.push({
                    type: "dp",
                    text: line.substring(tokenStart, closeIdx + 1),
                    start: tokenStart,
                    end: closeIdx + 1
                });
                i = closeIdx + 1;
                continue;
            }
        }

        // 2. LoRA < ... >
        if (line[i] === '<') {
            const closeIdx = line.indexOf('>', i);
            if (closeIdx !== -1) {
                tokens.push({
                    type: "lora",
                    text: line.substring(tokenStart, closeIdx + 1),
                    start: tokenStart,
                    end: closeIdx + 1
                });
                i = closeIdx + 1;
                continue;
            }
        }

        // 3. Normal / Weighted Tag up to next comma
        while (i < line.length && line[i] !== ',') {
            if (line[i] === '{') break;
            i++;
        }

        const raw = line.substring(tokenStart, i);
        const trimmed = raw.trim();
        if (trimmed) {
            tokens.push({
                type: "tag",
                text: trimmed,
                start: tokenStart,
                end: tokenStart + raw.trimEnd().length
            });
        }
    }
    return tokens;
}

export function shiftTagAtCursor(text, cursor, direction) {
    if (!text) return { text, cursor };

    // Check if cursor is inside a Dynamic Prompt { ... }
    let dpBlock = null;
    let depth = 0;
    for (let k = 0; k < text.length; k++) {
        if (text[k] === '{') {
            if (depth === 0) dpBlock = { start: k };
            depth++;
        } else if (text[k] === '}') {
            depth--;
            if (depth === 0 && dpBlock) {
                dpBlock.end = k + 1;
                if (cursor >= dpBlock.start && cursor <= dpBlock.end) {
                    break;
                } else {
                    dpBlock = null;
                }
            }
        }
    }

    // Dynamic prompt case
    if (dpBlock && cursor > dpBlock.start && cursor < dpBlock.end) {
        const inner = text.substring(dpBlock.start + 1, dpBlock.end - 1);
        const rawOptions = inner.split(/\|/);
        const options = [];
        let optOffset = dpBlock.start + 1;

        let activeOptionIndex = -1;
        for (let idx = 0; idx < rawOptions.length; idx++) {
            const rawOpt = rawOptions[idx];
            const optStart = optOffset;
            const optEnd = optOffset + rawOpt.length;
            options.push({ text: rawOpt.trim(), raw: rawOpt, start: optStart, end: optEnd });
            if (cursor >= optStart && cursor <= optEnd) {
                activeOptionIndex = idx;
            }
            optOffset = optEnd + 1;
        }

        if (activeOptionIndex === -1) return { text, cursor };

        const targetIndex = direction === "left" ? activeOptionIndex - 1 : activeOptionIndex + 1;
        if (targetIndex < 0 || targetIndex >= options.length) {
            return { text, cursor }; // Confined inside { ... }
        }

        const activeOpt = options[activeOptionIndex];
        const targetOpt = options[targetIndex];
        const relCursor = Math.max(0, Math.min(activeOpt.text.length, cursor - (activeOpt.start + (activeOpt.raw.length - activeOpt.raw.trimStart().length))));

        const newOptions = [...options];
        newOptions[activeOptionIndex] = targetOpt;
        newOptions[targetIndex] = activeOpt;

        const newInner = newOptions.map(o => o.text).join(" | ");
        const newText = text.substring(0, dpBlock.start + 1) + newInner + text.substring(dpBlock.end - 1);

        let newOptOffset = dpBlock.start + 1;
        for (let idx = 0; idx < targetIndex; idx++) {
            newOptOffset += newOptions[idx].text.length + 3;
        }
        const newCursor = newOptOffset + relCursor;

        return { text: newText, cursor: newCursor };
    }

    // Top-level prompt tag shifting
    const tokens = parseTopLevelTokens(text);
    let activeTokenIndex = -1;
    for (let idx = 0; idx < tokens.length; idx++) {
        const tok = tokens[idx];
        if (cursor >= tok.start && cursor <= tok.end + 1) {
            activeTokenIndex = idx;
            break;
        }
    }

    if (activeTokenIndex === -1) return { text, cursor };

    const targetTokenIndex = direction === "left" ? activeTokenIndex - 1 : activeTokenIndex + 1;
    if (targetTokenIndex < 0 || targetTokenIndex >= tokens.length) {
        return { text, cursor };
    }

    const activeTok = tokens[activeTokenIndex];
    const targetTok = tokens[targetTokenIndex];
    const relCursor = Math.max(0, Math.min(activeTok.text.length, cursor - activeTok.start));

    const newTokens = [...tokens];
    newTokens[activeTokenIndex] = targetTok;
    newTokens[targetTokenIndex] = activeTok;

    const newText = newTokens.map(t => t.text).join(", ");

    let newOffset = 0;
    for (let idx = 0; idx < targetTokenIndex; idx++) {
        newOffset += newTokens[idx].text.length + 2;
    }
    const newCursor = newOffset + relCursor;

    return { text: newText, cursor: newCursor };
}

export function handlePromptKeyDown(event) {
    const textarea = event.target;
    if (!textarea || textarea.tagName !== "TEXTAREA" || textarea.readOnly) return;

    // Master Switch check
    const masterEnabled = settingValues.enableHotkeyEnhance !== undefined ? settingValues.enableHotkeyEnhance : true;
    if (!masterEnabled) return;

    const isCtrl = event.ctrlKey || event.metaKey;
    const isAlt = event.altKey;
    const isShift = event.shiftKey;

    // 1. Ctrl + Up / Down: Full-tag selection and LoRA / Embedding weight adjustment
    if (isCtrl && !isAlt && !isShift && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        const enabled = settingValues.enableTagWeightHotkey !== undefined ? settingValues.enableTagWeightHotkey : true;
        if (!enabled) return;

        const text = textarea.value;
        const selStart = textarea.selectionStart;
        const selEnd = textarea.selectionEnd;
        const direction = event.key === "ArrowUp" ? "up" : "down";

        // LoRA tag adjustment
        const loraMatch = findEnclosingLora(text, selStart, selEnd);
        if (loraMatch) {
            event.preventDefault();
            event.stopPropagation();

            const step = settingValues.loraWeightStep !== undefined ? settingValues.loraWeightStep : 0.05;
            const newLora = adjustLoraWeight(loraMatch.text, direction, step);

            if (newLora && newLora !== loraMatch.text) {
                if (typeof window !== "undefined" && window.tagCompleteEngine) {
                    window.tagCompleteEngine.suppressNextSearch = true;
                }

                textarea.setSelectionRange(loraMatch.start, loraMatch.end);
                let replaced = false;
                try {
                    replaced = document.execCommand("insertText", false, newLora);
                } catch (_) {}

                if (!replaced) {
                    textarea.value = text.substring(0, loraMatch.start) + newLora + text.substring(loraMatch.end);
                    textarea.dispatchEvent(new Event("input", { bubbles: true }));
                    textarea.dispatchEvent(new Event("change", { bubbles: true }));
                }

                const newEnd = loraMatch.start + newLora.length;
                textarea.setSelectionRange(loraMatch.start, newEnd);

                if (typeof window !== "undefined" && window.tagCompleteEngine) {
                    window.tagCompleteEngine.triggerSearch(textarea);
                }
            }
            return;
        }

        // Parenthesis-weighted tag adjustment
        const weightedMatch = findEnclosingParenthesisWeight(text, selStart, selEnd);
        if (weightedMatch) {
            event.preventDefault();
            event.stopPropagation();

            const isEmbedding = /(?:^|\()(?:embedding|emb):/i.test(weightedMatch.text);
            if (typeof window !== "undefined" && window.tagCompleteEngine) {
                window.tagCompleteEngine.suppressNextSearch = true;
                if (!isEmbedding) {
                    window.tagCompleteEngine.hide();
                }
            }

            const step = settingValues.tagWeightStep !== undefined ? settingValues.tagWeightStep : 0.05;
            const newTag = adjustParenthesisWeight(weightedMatch.text, direction, step);

            if (newTag && newTag !== weightedMatch.text) {
                textarea.setSelectionRange(weightedMatch.start, weightedMatch.end);
                let replaced = false;
                try {
                    replaced = document.execCommand("insertText", false, newTag);
                } catch (_) {}

                if (!replaced) {
                    textarea.value = text.substring(0, weightedMatch.start) + newTag + text.substring(weightedMatch.end);
                    textarea.dispatchEvent(new Event("input", { bubbles: true }));
                    textarea.dispatchEvent(new Event("change", { bubbles: true }));
                }

                const newEnd = weightedMatch.start + newTag.length;
                textarea.setSelectionRange(weightedMatch.start, newEnd);

                if (isEmbedding && typeof window !== "undefined" && window.tagCompleteEngine) {
                    window.tagCompleteEngine.triggerSearch(textarea);
                }
            }
            return;
        }

        // Unweighted tag adjustment
        let targetStart = selStart;
        let targetEnd = selEnd;
        let targetText = "";

        if (selStart === selEnd) {
            const boundaries = findTagBoundariesForWeight(text, selStart);
            if (boundaries && boundaries.isTag) {
                targetStart = boundaries.start;
                targetEnd = boundaries.end;
                targetText = boundaries.text;
            }
        } else {
            const candidate = text.substring(selStart, selEnd).trim();
            if (candidate && !candidate.includes(",") && !candidate.includes("\n")) {
                targetStart = selStart;
                targetEnd = selEnd;
                targetText = candidate;
            }
        }

        if (targetText && targetStart < targetEnd) {
            event.preventDefault();
            event.stopPropagation();

            const isEmbedding = /^(?:embedding|emb):/i.test(targetText);
            if (typeof window !== "undefined" && window.tagCompleteEngine) {
                window.tagCompleteEngine.suppressNextSearch = true;
                if (!isEmbedding) {
                    window.tagCompleteEngine.hide();
                }
            }

            const step = settingValues.tagWeightStep !== undefined ? settingValues.tagWeightStep : 0.05;
            const newTag = adjustParenthesisWeight(targetText, direction, step);

            if (newTag && newTag !== targetText) {
                textarea.setSelectionRange(targetStart, targetEnd);
                let replaced = false;
                try {
                    replaced = document.execCommand("insertText", false, newTag);
                } catch (_) {}

                if (!replaced) {
                    textarea.value = text.substring(0, targetStart) + newTag + text.substring(targetEnd);
                    textarea.dispatchEvent(new Event("input", { bubbles: true }));
                    textarea.dispatchEvent(new Event("change", { bubbles: true }));
                }

                const newEnd = targetStart + newTag.length;
                textarea.setSelectionRange(targetStart, newEnd);

                if (isEmbedding && typeof window !== "undefined" && window.tagCompleteEngine) {
                    window.tagCompleteEngine.triggerSearch(textarea);
                }
            }
            return;
        }

        return;
    }

    // 2. Ctrl + Left / Right: Tag-by-tag navigation
    if (isCtrl && !isAlt && !isShift && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        const enabled = settingValues.enableTagJumpHotkey !== undefined ? settingValues.enableTagJumpHotkey : true;
        if (!enabled) return;

        if (typeof window !== "undefined" && window.tagCompleteEngine) {
            window.tagCompleteEngine.hide();
        }

        event.preventDefault();
        event.stopPropagation();

        const text = textarea.value;
        const cursor = textarea.selectionStart;
        const direction = event.key === "ArrowRight" ? "right" : "left";
        const newPos = calculateTagJumpPosition(text, cursor, direction);

        textarea.setSelectionRange(newPos, newPos);
        return;
    }

    // 3. Alt + Left / Right: Tag reordering / swapping
    if (isAlt && !isCtrl && !isShift && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        const enabled = settingValues.enableTagSwapHotkey !== undefined ? settingValues.enableTagSwapHotkey : true;
        if (!enabled) return;

        if (typeof window !== "undefined" && window.tagCompleteEngine) {
            window.tagCompleteEngine.suppressNextSearch = true;
            window.tagCompleteEngine.hide();
        }

        event.preventDefault();
        event.stopPropagation();

        const text = textarea.value;
        const cursor = textarea.selectionStart;
        const direction = event.key === "ArrowRight" ? "right" : "left";
        const result = shiftTagAtCursor(text, cursor, direction);

        if (result.text !== text) {
            textarea.value = result.text;
            textarea.setSelectionRange(result.cursor, result.cursor);
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
            textarea.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return;
    }
}

export function attachHotkeysToTextarea(textarea) {
    if (!textarea || textarea._hasTagHotkeysAttached) return;
    textarea.addEventListener("keydown", handlePromptKeyDown, true); // Capture phase
    textarea._hasTagHotkeysAttached = true;
}
