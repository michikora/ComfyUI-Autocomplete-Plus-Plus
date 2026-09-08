import { settingValues } from "./settings.js";
import { getEffectiveFormattingSettings } from "./auto-formatter.js";

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

export function splitDynamicPromptOptions(inner) {
    const rawOptions = [];
    let depth = 0;
    let optStart = 0;
    for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        let backslashCount = 0;
        let b = i - 1;
        while (b >= 0 && inner[b] === '\\') {
            backslashCount++;
            b--;
        }
        const isEscaped = (backslashCount % 2) === 1;

        if (ch === '{' && !isEscaped) depth++;
        else if (ch === '}' && !isEscaped) {
            if (depth > 0) depth--;
        } else if (ch === '|' && depth === 0 && !isEscaped) {
            rawOptions.push(inner.substring(optStart, i));
            optStart = i + 1;
        }
    }
    rawOptions.push(inner.substring(optStart));
    return rawOptions;
}

export function findInnermostEnclosingBrace(text, selStart, selEnd) {
    if (!text) return null;
    if (typeof selEnd === "undefined") selEnd = selStart;
    const stack = [];
    const pairs = [];
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        let backslashCount = 0;
        let b = i - 1;
        while (b >= 0 && text[b] === '\\') {
            backslashCount++;
            b--;
        }
        const isEscaped = (backslashCount % 2) === 1;
        if (isEscaped) continue;

        if (ch === '{') {
            stack.push(i);
        } else if (ch === '}') {
            if (stack.length > 0) {
                const start = stack.pop();
                pairs.push({ start, end: i + 1 });
            }
        }
    }

    // Sort innermost enclosing braces first
    const enclosing = pairs
        .filter(p => selStart > p.start && selEnd < p.end)
        .sort((a, b) => (a.end - a.start) - (b.end - b.start));

    for (const pair of enclosing) {
        const inner = text.substring(pair.start + 1, pair.end - 1);
        const options = splitDynamicPromptOptions(inner);
        if (options.length > 1) {
            return {
                start: pair.start,
                end: pair.end,
                hasPipe: true,
                rawOptions: options
            };
        }

        const tokens = parseTopLevelTokens(inner);
        if (tokens.length > 1) {
            return {
                start: pair.start,
                end: pair.end,
                hasPipe: false,
                rawOptions: options,
                tokens: tokens
            };
        }
        // Single tag (e.g. {tag}) bubbles up to outer scope
    }

    return null;
}

export function findInnermostEnclosingDp(text, cursor) {
    const brace = findInnermostEnclosingBrace(text, cursor, cursor);
    if (brace && brace.hasPipe) {
        return brace;
    }
    return null;
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

        const tokenStart = i;

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
                const options = splitDynamicPromptOptions(inner);
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
            } else {
                i++;
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
        while (i < text.length && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r' && (i === tagStart || text[i] !== '{')) {
            i++;
        }
        const tagContent = text.substring(tagStart, i);
        const trimmedEnd = tagStart + tagContent.trimEnd().length;
        if (trimmedEnd > tagStart) {
            positions.push(trimmedEnd);
        }

        // Ensure index advances
        if (i <= tokenStart) {
            i = tokenStart + 1;
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
        while (i < line.length && (line[i] === ' ' || line[i] === '\t' || line[i] === ',' || line[i] === '\n' || line[i] === '\r')) {
            i++;
        }
        if (i >= line.length) break;

        const tokenStart = i;

        // 1. Dynamic Prompt Block { ... }
        if (line[i] === '{') {
            let depth = 0;
            let closeIdx = -1;
            for (let j = i; j < line.length; j++) {
                let backslashCount = 0;
                let b = j - 1;
                while (b >= 0 && line[b] === '\\') {
                    backslashCount++;
                    b--;
                }
                const isEscaped = (backslashCount % 2) === 1;

                if (!isEscaped) {
                    if (line[j] === '{') depth++;
                    else if (line[j] === '}') {
                        depth--;
                        if (depth === 0) { closeIdx = j; break; }
                    }
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
            } else {
                // Consume unclosed opening brace
                i++;
                continue;
            }
        }

        if (line[i] === '}') {
            i++;
            continue;
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
        while (i < line.length && line[i] !== ',' && line[i] !== '\n' && line[i] !== '\r') {
            if (i > tokenStart && (line[i] === '{' || line[i] === '}')) break;
            i++;
        }

        const raw = line.substring(tokenStart, i);
        const trimmed = raw.trim();
        if (trimmed && !/^[{}|,;\s]+$/.test(trimmed)) {
            const leadingWs = raw.length - raw.trimStart().length;
            const actualStart = tokenStart + leadingWs;
            tokens.push({
                type: "tag",
                text: trimmed,
                start: actualStart,
                end: actualStart + trimmed.length
            });
        }

        // Ensure index advances
        if (i <= tokenStart) {
            i = tokenStart + 1;
        }
    }
    return tokens;
}

function joinTokenParts(left, right) {
    if (!left) return right.trim();
    if (!right) return left.trim();
    if (/\s$/.test(left) || /^\s/.test(right)) {
        return (left.trim() + " " + right.trim()).trim();
    }
    return left + right;
}

export function shiftTokensInScope(scopeText, selStart, selEnd, direction) {
    const tokens = parseTopLevelTokens(scopeText);
    if (tokens.length === 0) return { text: scopeText, cursor: selStart, selectionStart: selStart, selectionEnd: selEnd };

    // Selection movement
    if (selStart < selEnd) {
        const chunk = scopeText.substring(selStart, selEnd);
        const trimmedChunk = chunk.trim();
        if (!trimmedChunk) {
            return { text: scopeText, cursor: selStart, selectionStart: selStart, selectionEnd: selEnd };
        }

        const selectedTokens = tokens.filter(t => t.start < selEnd && t.end > selStart);
        if (selectedTokens.length === 0) {
            return { text: scopeText, cursor: selStart, selectionStart: selStart, selectionEnd: selEnd };
        }

        // Sub-token extraction
        if (selectedTokens.length === 1) {
            const tok = selectedTokens[0];
            const clampedStart = Math.max(tok.start, selStart);
            const clampedEnd = Math.min(tok.end, selEnd);
            const subChunk = scopeText.substring(clampedStart, clampedEnd).trim();

            if (subChunk && subChunk !== tok.text) {
                const leftPart = scopeText.substring(tok.start, clampedStart);
                const rightPart = scopeText.substring(clampedEnd, tok.end);
                const remainder = joinTokenParts(leftPart, rightPart);

                const before = scopeText.substring(0, tok.start);
                const after = scopeText.substring(tok.end);

                let replacement;
                let newSelStart;

                if (direction === "right") {
                    replacement = remainder ? (remainder + ", " + subChunk) : subChunk;
                    newSelStart = tok.start + (remainder ? remainder.length + 2 : 0);
                } else {
                    replacement = remainder ? (subChunk + ", " + remainder) : subChunk;
                    newSelStart = tok.start;
                }

                const newText = before + replacement + after;
                const newSelEnd = newSelStart + subChunk.length;

                return {
                    text: newText,
                    cursor: newSelStart,
                    selectionStart: newSelStart,
                    selectionEnd: newSelEnd
                };
            }
        }

        // Token block movement
        const firstSelTok = selectedTokens[0];
        const lastSelTok = selectedTokens[selectedTokens.length - 1];
        const firstIdx = tokens.indexOf(firstSelTok);
        const lastIdx = tokens.indexOf(lastSelTok);

        const blockStart = firstSelTok.start;
        const blockEnd = lastSelTok.end;
        const blockText = scopeText.substring(blockStart, blockEnd);

        if (direction === "right") {
            if (lastIdx + 1 >= tokens.length) {
                return { text: scopeText, cursor: selStart, selectionStart: blockStart, selectionEnd: blockEnd };
            }
            const targetTok = tokens[lastIdx + 1];
            const before = scopeText.substring(0, blockStart);
            const sep = scopeText.substring(blockEnd, targetTok.start);
            const targetText = scopeText.substring(targetTok.start, targetTok.end);
            const after = scopeText.substring(targetTok.end);

            const newText = before + targetText + sep + blockText + after;
            const newSelStart = blockStart + targetText.length + sep.length;
            const newSelEnd = newSelStart + blockText.length;

            return {
                text: newText,
                cursor: newSelStart,
                selectionStart: newSelStart,
                selectionEnd: newSelEnd
            };
        } else {
            if (firstIdx - 1 < 0) {
                return { text: scopeText, cursor: selStart, selectionStart: blockStart, selectionEnd: blockEnd };
            }
            const targetTok = tokens[firstIdx - 1];
            const before = scopeText.substring(0, targetTok.start);
            const targetText = scopeText.substring(targetTok.start, targetTok.end);
            const sep = scopeText.substring(targetTok.end, blockStart);
            const after = scopeText.substring(blockEnd);

            const newText = before + blockText + sep + targetText + after;
            const newSelStart = targetTok.start;
            const newSelEnd = newSelStart + blockText.length;

            return {
                text: newText,
                cursor: newSelStart,
                selectionStart: newSelStart,
                selectionEnd: newSelEnd
            };
        }
    }

    // Single cursor swap
    const cursor = selStart;
    let activeTokenIndex = -1;
    for (let idx = 0; idx < tokens.length; idx++) {
        const tok = tokens[idx];
        if (cursor >= tok.start && cursor <= tok.end + 1) {
            activeTokenIndex = idx;
            break;
        }
    }

    if (activeTokenIndex === -1) return { text: scopeText, cursor: selStart, selectionStart: selStart, selectionEnd: selEnd };

    const targetTokenIndex = direction === "left" ? activeTokenIndex - 1 : activeTokenIndex + 1;
    if (targetTokenIndex < 0 || targetTokenIndex >= tokens.length) {
        return {
            text: scopeText,
            cursor: selStart,
            selectionStart: tokens[activeTokenIndex].start,
            selectionEnd: tokens[activeTokenIndex].end
        };
    }

    const activeTok = tokens[activeTokenIndex];
    const targetTok = tokens[targetTokenIndex];
    const firstTok = activeTokenIndex < targetTokenIndex ? activeTok : targetTok;
    const secondTok = activeTokenIndex < targetTokenIndex ? targetTok : activeTok;

    const before = scopeText.substring(0, firstTok.start);
    const sep = scopeText.substring(firstTok.end, secondTok.start);
    const after = scopeText.substring(secondTok.end);

    const newText = before + secondTok.text + sep + firstTok.text + after;

    let newActiveStart;
    if (direction === "right") {
        newActiveStart = firstTok.start + secondTok.text.length + sep.length;
    } else {
        newActiveStart = firstTok.start;
    }
    const newActiveEnd = newActiveStart + activeTok.text.length;

    return {
        text: newText,
        cursor: newActiveStart,
        selectionStart: newActiveStart,
        selectionEnd: newActiveEnd
    };
}

export function shiftTagAtCursor(text, selStart, selEnd, direction) {
    if (!text) return { text, cursor: selStart, selectionStart: selStart, selectionEnd: selEnd };

    // Backward compatibility if called as shiftTagAtCursor(text, cursor, direction)
    if (typeof direction === "undefined" && typeof selEnd === "string") {
        direction = selEnd;
        selEnd = selStart;
    }
    if (typeof selEnd === "undefined") {
        selEnd = selStart;
    }

    // Check enclosing brace container
    const braceBlock = findInnermostEnclosingBrace(text, selStart, selEnd);

    if (braceBlock) {
        if (braceBlock.hasPipe) {
            // Case 1: Alternation container {opt1|opt2|...}
            const inner = text.substring(braceBlock.start + 1, braceBlock.end - 1);
            const rawOptions = braceBlock.rawOptions || splitDynamicPromptOptions(inner);
            const options = [];
            let optOffset = braceBlock.start + 1;

            let activeOptionIndex = -1;
            for (let idx = 0; idx < rawOptions.length; idx++) {
                const rawOpt = rawOptions[idx];
                const optStart = optOffset;
                const optEnd = optOffset + rawOpt.length;
                options.push({ text: rawOpt.trim(), raw: rawOpt, start: optStart, end: optEnd });
                if (selStart >= optStart && (selEnd <= optEnd || selStart === selEnd)) {
                    activeOptionIndex = idx;
                }
                optOffset = optEnd + 1;
            }

            if (activeOptionIndex === -1) return { text, cursor: selStart, selectionStart: selStart, selectionEnd: selEnd };

            const activeOpt = options[activeOptionIndex];
            const subTokens = parseTopLevelTokens(activeOpt.raw);
            const trimmedStart = activeOpt.start + (activeOpt.raw.length - activeOpt.raw.trimStart().length);
            const trimmedEnd = activeOpt.end - (activeOpt.raw.length - activeOpt.raw.trimEnd().length);
            const isWholeOptionSelected = selStart < selEnd && selStart <= trimmedStart && selEnd >= trimmedEnd;

            // Shift within option if it contains multiple comma-separated tokens
            if (subTokens.length > 1 && !isWholeOptionSelected) {
                const relSelStart = selStart - activeOpt.start;
                const relSelEnd = selEnd - activeOpt.start;
                const res = shiftTokensInScope(activeOpt.raw, relSelStart, relSelEnd, direction);

                if (res.text === activeOpt.raw) {
                    return {
                        text,
                        cursor: res.cursor + activeOpt.start,
                        selectionStart: (res.selectionStart !== undefined ? res.selectionStart : res.cursor) + activeOpt.start,
                        selectionEnd: (res.selectionEnd !== undefined ? res.selectionEnd : res.cursor) + activeOpt.start
                    };
                }

                const newText = text.substring(0, activeOpt.start) + res.text + text.substring(activeOpt.end);
                const newSelStart = (res.selectionStart !== undefined ? res.selectionStart : res.cursor) + activeOpt.start;
                const newSelEnd = (res.selectionEnd !== undefined ? res.selectionEnd : res.cursor) + activeOpt.start;

                return {
                    text: newText,
                    cursor: res.cursor + activeOpt.start,
                    selectionStart: newSelStart,
                    selectionEnd: newSelEnd
                };
            }

            const targetIndex = direction === "left" ? activeOptionIndex - 1 : activeOptionIndex + 1;
            if (targetIndex < 0 || targetIndex >= options.length) {
                return {
                    text,
                    cursor: selStart,
                    selectionStart: options[activeOptionIndex].start,
                    selectionEnd: options[activeOptionIndex].end
                };
            }
            const targetOpt = options[targetIndex];
            const relCursor = Math.max(0, Math.min(activeOpt.raw.length, selStart - activeOpt.start));

            const newOptions = [...options];
            newOptions[activeOptionIndex] = targetOpt;
            newOptions[targetIndex] = activeOpt;

            const newInner = newOptions.map(o => o.raw).join("|");
            const newText = text.substring(0, braceBlock.start + 1) + newInner + text.substring(braceBlock.end - 1);

            let newOptOffset = braceBlock.start + 1;
            for (let idx = 0; idx < targetIndex; idx++) {
                newOptOffset += newOptions[idx].raw.length + 1;
            }
            const newCursor = newOptOffset + relCursor;

            return {
                text: newText,
                cursor: newCursor,
                selectionStart: newOptOffset,
                selectionEnd: newOptOffset + activeOpt.raw.length
            };
        } else {
            // Case 2: Comma-delimited container {tag1, tag2, ...}
            const innerOffset = braceBlock.start + 1;
            const inner = text.substring(innerOffset, braceBlock.end - 1);
            const relSelStart = selStart - innerOffset;
            const relSelEnd = selEnd - innerOffset;

            const res = shiftTokensInScope(inner, relSelStart, relSelEnd, direction);
            if (res.text === inner) {
                // Keep selection adjusted to global coords when at boundary
                return {
                    text,
                    cursor: res.cursor + innerOffset,
                    selectionStart: (res.selectionStart !== undefined ? res.selectionStart : res.cursor) + innerOffset,
                    selectionEnd: (res.selectionEnd !== undefined ? res.selectionEnd : res.cursor) + innerOffset
                };
            }

            const newText = text.substring(0, innerOffset) + res.text + text.substring(braceBlock.end - 1);
            const newSelStart = (res.selectionStart !== undefined ? res.selectionStart : res.cursor) + innerOffset;
            const newSelEnd = (res.selectionEnd !== undefined ? res.selectionEnd : res.cursor) + innerOffset;

            return {
                text: newText,
                cursor: res.cursor + innerOffset,
                selectionStart: newSelStart,
                selectionEnd: newSelEnd
            };
        }
    }

    // Case 3: Global / Top-level scope
    return shiftTokensInScope(text, selStart, selEnd, direction);
}

export function insertTextWithUndo(textarea, text, newSelStart, newSelEnd) {
    let success = false;
    try {
        if (typeof document !== "undefined" && typeof document.execCommand === "function") {
            success = document.execCommand("insertText", false, text);
        }
    } catch (_) {}
    if (!success) {
        const s = textarea.selectionStart;
        const e = textarea.selectionEnd;
        const val = textarea.value;
        textarea.value = val.substring(0, s) + text + val.substring(e);
    }
    if (typeof newSelStart === "number") {
        const end = typeof newSelEnd === "number" ? newSelEnd : newSelStart;
        textarea.setSelectionRange(newSelStart, end);
    }
    try {
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (_) {}
}

export function handleAutoCloseCurlyBraces(event, textarea, effectiveSettings) {
    if (!textarea) return false;
    const settings = effectiveSettings || getEffectiveFormattingSettings();
    const enabled = settings.autoCloseCurlyBraces !== undefined ? settings.autoCloseCurlyBraces : true;
    if (!enabled) return false;

    if (event.isComposing || event.keyCode === 229) return false;
    if (event.ctrlKey || event.metaKey) return false;

    const selStart = textarea.selectionStart;
    const selEnd = textarea.selectionEnd;
    const text = textarea.value;

    if (event.key === "{" && !event.altKey) {
        let backslashCount = 0;
        let b = selStart - 1;
        while (b >= 0 && text[b] === '\\') {
            backslashCount++;
            b--;
        }
        if ((backslashCount % 2) === 1) {
            return false;
        }

        event.preventDefault();
        event.stopPropagation();

        if (selStart < selEnd) {
            const selected = text.substring(selStart, selEnd);
            insertTextWithUndo(textarea, "{" + selected + "}", selStart + 1, selEnd + 1);
        } else {
            insertTextWithUndo(textarea, "{}", selStart + 1, selStart + 1);
        }
        return true;
    }

    if (event.key === "}" && !event.altKey) {
        if (selStart === selEnd && selStart < text.length && text[selStart] === "}") {
            event.preventDefault();
            event.stopPropagation();
            textarea.setSelectionRange(selStart + 1, selStart + 1);
            return true;
        }
    }

    if (event.key === "Backspace" && !event.altKey) {
        if (selStart === selEnd && selStart > 0 && selStart < text.length) {
            if (text[selStart - 1] === "{" && text[selStart] === "}") {
                event.preventDefault();
                event.stopPropagation();
                textarea.setSelectionRange(selStart - 1, selStart + 1);
                insertTextWithUndo(textarea, "", selStart - 1, selStart - 1);
                return true;
            }
        }
    }

    return false;
}

export function handlePromptKeyDown(event) {
    const textarea = event.target;
    if (!textarea || textarea.tagName !== "TEXTAREA" || textarea.readOnly) return;

    if (!textarea._hasTagSwapHistoryAttached) {
        textarea.addEventListener("input", handleTagSwapHistoryInput, true);
        textarea._hasTagSwapHistoryAttached = true;
    }

    if (handleAutoCloseCurlyBraces(event, textarea)) {
        return;
    }

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
        const selStart = textarea.selectionStart;
        const selEnd = textarea.selectionEnd;
        const direction = event.key === "ArrowRight" ? "right" : "left";
        const result = shiftTagAtCursor(text, selStart, selEnd, direction);

        if (result.text !== text) {
            const scrollTop = textarea.scrollTop;
            const scrollLeft = textarea.scrollLeft;

            const newSelStart = result.selectionStart !== undefined ? result.selectionStart : result.cursor;
            const newSelEnd = result.selectionEnd !== undefined ? result.selectionEnd : result.cursor;

            if (!textarea._tagSwapUndoStack) textarea._tagSwapUndoStack = [];
            textarea._tagSwapUndoStack.push({
                origText: text,
                newText: result.text,
                origSelStart: selStart,
                origSelEnd: selEnd,
                newSelStart,
                newSelEnd
            });
            textarea._tagSwapRedoStack = [];

            let diffStart = 0;
            while (diffStart < text.length && diffStart < result.text.length && text[diffStart] === result.text[diffStart]) {
                diffStart++;
            }
            let oldDiffEnd = text.length;
            let newDiffEnd = result.text.length;
            while (oldDiffEnd > diffStart && newDiffEnd > diffStart && text[oldDiffEnd - 1] === result.text[newDiffEnd - 1]) {
                oldDiffEnd--;
                newDiffEnd--;
            }

            const replacementSlice = result.text.substring(diffStart, newDiffEnd);
            textarea.setSelectionRange(diffStart, oldDiffEnd);
            insertTextWithUndo(textarea, replacementSlice, newSelStart, newSelEnd);

            if (typeof textarea.scrollTop === "number") {
                textarea.scrollTop = scrollTop;
            }
            if (typeof textarea.scrollLeft === "number") {
                textarea.scrollLeft = scrollLeft;
            }
        }
        return;
    }
}

export function handleTagSwapHistoryInput(event) {
    const textarea = event.target;
    if (!textarea) return;

    if (event.inputType === "historyUndo") {
        if (textarea._tagSwapUndoStack && textarea._tagSwapUndoStack.length > 0) {
            const entry = textarea._tagSwapUndoStack[textarea._tagSwapUndoStack.length - 1];
            if (textarea.value === entry.origText) {
                textarea._tagSwapUndoStack.pop();
                textarea.setSelectionRange(entry.origSelStart, entry.origSelEnd);
                if (!textarea._tagSwapRedoStack) textarea._tagSwapRedoStack = [];
                textarea._tagSwapRedoStack.push(entry);
                queueMicrotask(() => {
                    if (textarea.value === entry.origText) {
                        textarea.setSelectionRange(entry.origSelStart, entry.origSelEnd);
                    }
                });
            }
        }
    } else if (event.inputType === "historyRedo") {
        if (textarea._tagSwapRedoStack && textarea._tagSwapRedoStack.length > 0) {
            const entry = textarea._tagSwapRedoStack[textarea._tagSwapRedoStack.length - 1];
            if (textarea.value === entry.newText) {
                textarea._tagSwapRedoStack.pop();
                textarea.setSelectionRange(entry.newSelStart, entry.newSelEnd);
                if (!textarea._tagSwapUndoStack) textarea._tagSwapUndoStack = [];
                textarea._tagSwapUndoStack.push(entry);
                queueMicrotask(() => {
                    if (textarea.value === entry.newText) {
                        textarea.setSelectionRange(entry.newSelStart, entry.newSelEnd);
                    }
                });
            }
        }
    } else if (event.inputType && event.inputType !== "historyUndo" && event.inputType !== "historyRedo") {
        if (textarea._tagSwapRedoStack && textarea._tagSwapRedoStack.length > 0) {
            textarea._tagSwapRedoStack = [];
        }
    }
}

export function attachHotkeysToTextarea(textarea) {
    if (!textarea || textarea._hasTagHotkeysAttached) return;
    textarea.addEventListener("keydown", handlePromptKeyDown, true); // Capture phase
    textarea.addEventListener("input", handleTagSwapHistoryInput, true);
    textarea._hasTagHotkeysAttached = true;
    textarea._hasTagSwapHistoryAttached = true;
}
