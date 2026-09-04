// Caret coordinate calculation with canvas scale compensation

const CARET_STYLE_PROPERTIES = [
    'direction',
    'boxSizing',
    'width',
    'height',
    'overflowX',
    'overflowY',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'borderStyle',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'fontStyle',
    'fontVariant',
    'fontWeight',
    'fontStretch',
    'fontSize',
    'fontSizeAdjust',
    'lineHeight',
    'fontFamily',
    'textAlign',
    'textTransform',
    'textIndent',
    'textDecoration',
    'letterSpacing',
    'wordSpacing',
    'tabSize',
    'MozTabSize',
];

function getDocument(element) {
    return element?.ownerDocument || document;
}

function getLineHeightPx(computedStyle, ownerDocument) {
    const tempNode = ownerDocument.createElement('span');
    tempNode.innerHTML = '&nbsp;';
    Object.assign(tempNode.style, {
        fontSize: computedStyle.fontSize,
        fontFamily: computedStyle.fontFamily,
        padding: '0',
        position: 'absolute',
        visibility: 'hidden',
    });
    ownerDocument.body.appendChild(tempNode);
    const height = tempNode.offsetHeight || 16;
    ownerDocument.body.removeChild(tempNode);
    return height;
}

export function getLocalCaretCoordinates(element, position) {
    const ownerDocument = getDocument(element);
    const view = ownerDocument.defaultView || window;
    const isInput = element.nodeName === 'INPUT';
    const mirror = ownerDocument.createElement('div');
    const computed = view.getComputedStyle(element);

    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';
    if (!isInput) mirror.style.wordWrap = 'break-word';

    CARET_STYLE_PROPERTIES.forEach(property => {
        if (isInput && property === 'lineHeight') {
            if (computed.boxSizing === 'border-box') {
                const height = parseInt(computed.height, 10) || 0;
                const outerHeight = (parseInt(computed.paddingTop, 10) || 0)
                    + (parseInt(computed.paddingBottom, 10) || 0)
                    + (parseInt(computed.borderTopWidth, 10) || 0)
                    + (parseInt(computed.borderBottomWidth, 10) || 0);
                const targetHeight = outerHeight + (parseInt(computed.lineHeight, 10) || 0);
                mirror.style.lineHeight = height > targetHeight
                    ? `${height - outerHeight}px`
                    : height === targetHeight ? computed.lineHeight : '0';
            } else {
                mirror.style.lineHeight = computed.height;
            }
        } else {
            mirror.style[property] = computed[property];
        }
    });

    const computedLineHeight = computed.lineHeight;
    const lineHeight = computedLineHeight === 'normal'
        ? getLineHeightPx(computed, ownerDocument)
        : (parseFloat(computedLineHeight) || 16);

    mirror.style.overflow = 'hidden';

    const targetPos = (typeof position === 'number') ? position : element.selectionStart;
    mirror.textContent = element.value.substring(0, targetPos);

    const marker = ownerDocument.createElement('span');
    marker.textContent = element.value.substring(targetPos) || '.';
    mirror.appendChild(marker);
    ownerDocument.body.appendChild(mirror);

    const coordinates = {
        top: marker.offsetTop + (parseInt(computed.borderTopWidth, 10) || 0),
        left: marker.offsetLeft + (parseInt(computed.borderLeftWidth, 10) || 0),
        lineHeight,
    };

    ownerDocument.body.removeChild(mirror);
    return coordinates;
}

export function getFixedCaretCoordinates(element, position) {
    if (!element) return { top: 0, left: 0, lineHeight: 16 };

    const rect = element.getBoundingClientRect();
    const localCaret = getLocalCaretCoordinates(element, position);

    // Compute effective scale ratio between rendered DOM bounding rect and CSS offset width
    const layoutWidth = element.offsetWidth || element.clientWidth || rect.width;
    const scaleX = (layoutWidth > 0 && rect.width > 0) ? (rect.width / layoutWidth) : 1;

    const layoutHeight = element.offsetHeight || element.clientHeight || rect.height;
    const scaleY = (layoutHeight > 0 && rect.height > 0) ? (rect.height / layoutHeight) : 1;

    // Adjusted viewport coordinates
    const left = rect.left + ((localCaret.left - element.scrollLeft) * scaleX);
    const top = rect.top + ((localCaret.top - element.scrollTop) * scaleY);
    const lineHeight = localCaret.lineHeight * scaleY;

    return {
        left,
        top,
        bottom: top + lineHeight,
        lineHeight,
    };
}
