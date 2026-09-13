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
        position: 'fixed',
        top: '-99999px',
        left: '-99999px',
        visibility: 'hidden',
    });
    ownerDocument.body.appendChild(tempNode);
    const height = tempNode.offsetHeight || 16;
    ownerDocument.body.removeChild(tempNode);
    return height;
}

const elementStyleCache = new WeakMap();
let sharedMirror = null;
let sharedMarker = null;
let activeOwnerDoc = null;
let activeElement = null;

function getSharedMirror(ownerDocument) {
    if (!sharedMirror || activeOwnerDoc !== ownerDocument || !ownerDocument.body.contains(sharedMirror)) {
        if (sharedMirror && sharedMirror.parentNode) {
            sharedMirror.parentNode.removeChild(sharedMirror);
        }
        activeOwnerDoc = ownerDocument;
        activeElement = null;

        sharedMirror = ownerDocument.createElement('div');
        sharedMirror.setAttribute('aria-hidden', 'true');
        Object.assign(sharedMirror.style, {
            position: 'fixed',
            top: '-99999px',
            left: '-99999px',
            visibility: 'hidden',
            pointerEvents: 'none',
            overflow: 'hidden',
        });

        sharedMarker = ownerDocument.createElement('span');
        ownerDocument.body.appendChild(sharedMirror);
    }
    return { mirror: sharedMirror, marker: sharedMarker };
}

export function getLocalCaretCoordinates(element, position) {
    const ownerDocument = getDocument(element);
    const { mirror, marker } = getSharedMirror(ownerDocument);

    let cached = elementStyleCache.get(element);
    const currentWidth = element.clientWidth;
    const currentHeight = element.clientHeight;

    if (!cached || cached.width !== currentWidth || cached.height !== currentHeight) {
        const view = ownerDocument.defaultView || window;
        const computed = view.getComputedStyle(element);
        const isInput = element.nodeName === 'INPUT';

        const computedLineHeight = computed.lineHeight;
        const lineHeight = computedLineHeight === 'normal'
            ? getLineHeightPx(computed, ownerDocument)
            : (parseFloat(computedLineHeight) || 16);

        const styles = {};
        CARET_STYLE_PROPERTIES.forEach(property => {
            if (isInput && property === 'lineHeight') {
                if (computed.boxSizing === 'border-box') {
                    const height = parseInt(computed.height, 10) || 0;
                    const outerHeight = (parseInt(computed.paddingTop, 10) || 0)
                        + (parseInt(computed.paddingBottom, 10) || 0)
                        + (parseInt(computed.borderTopWidth, 10) || 0)
                        + (parseInt(computed.borderBottomWidth, 10) || 0);
                    const targetHeight = outerHeight + (parseInt(computed.lineHeight, 10) || 0);
                    styles.lineHeight = height > targetHeight
                        ? `${height - outerHeight}px`
                        : height === targetHeight ? computed.lineHeight : '0';
                } else {
                    styles.lineHeight = computed.height;
                }
            } else {
                styles[property] = computed[property];
            }
        });

        cached = {
            width: currentWidth,
            height: currentHeight,
            borderTopWidth: parseInt(computed.borderTopWidth, 10) || 0,
            borderLeftWidth: parseInt(computed.borderLeftWidth, 10) || 0,
            lineHeight,
            isInput,
            styles,
        };
        elementStyleCache.set(element, cached);
        activeElement = null;
    }

    if (activeElement !== element) {
        mirror.style.position = 'fixed';
        mirror.style.top = '-99999px';
        mirror.style.left = '-99999px';
        mirror.style.visibility = 'hidden';
        mirror.style.pointerEvents = 'none';
        mirror.style.overflow = 'hidden';
        mirror.style.whiteSpace = 'pre-wrap';
        mirror.style.wordWrap = cached.isInput ? 'normal' : 'break-word';

        for (const prop in cached.styles) {
            mirror.style[prop] = cached.styles[prop];
        }
        activeElement = element;
    }

    const targetPos = (typeof position === 'number') ? position : element.selectionStart;
    mirror.textContent = element.value.substring(0, targetPos);
    marker.textContent = element.value.substring(targetPos) || '.';
    mirror.appendChild(marker);

    return {
        top: marker.offsetTop + cached.borderTopWidth,
        left: marker.offsetLeft + cached.borderLeftWidth,
        lineHeight: cached.lineHeight,
    };
}

export function getFixedCaretCoordinates(element, position) {
    if (!element) return { top: 0, left: 0, lineHeight: 16 };

    const rect = element.getBoundingClientRect();
    const localCaret = getLocalCaretCoordinates(element, position);

    const layoutWidth = element.offsetWidth || element.clientWidth || rect.width;
    const scaleX = (layoutWidth > 0 && rect.width > 0) ? (rect.width / layoutWidth) : 1;

    const layoutHeight = element.offsetHeight || element.clientHeight || rect.height;
    const scaleY = (layoutHeight > 0 && rect.height > 0) ? (rect.height / layoutHeight) : 1;

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
