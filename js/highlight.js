const MAX_HIGHLIGHT_LENGTH = 300000;
const COMMENT_PATTERN = /--\[(=*)\[[\s\S]*?(?:\]\1\]|$)|--[^\n]*/g;

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function wrapInSpan(className, text) {
    return '<span class="' + className + '">' + escapeHtml(text) + '</span>';
}

function tokenClass(tokens, index) {
    const token = tokens[index];

    switch (token.type) {
        case 'string':
            return 'string';
        case 'number':
            return 'number';
        case 'keyword':
            return /^(true|false|nil)$/.test(token.value) ? 'number' : 'keyword';
        case 'name': {
            const isCalled = tokens[index + 1].value === '(';
            const isDeclared = index > 0 && tokens[index - 1].value === 'function';
            return isCalled || isDeclared ? 'function' : '';
        }
        default:
            return '';
    }
}

function highlightLeading(leading) {
    let html = '';
    let lastEnd = 0;
    let match;

    COMMENT_PATTERN.lastIndex = 0;
    while ((match = COMMENT_PATTERN.exec(leading)) !== null) {
        html += escapeHtml(leading.slice(lastEnd, match.index)) + wrapInSpan('comment', match[0]);
        lastEnd = match.index + match[0].length;
    }
    return html + escapeHtml(leading.slice(lastEnd));
}

function highlightLua(source) {
    if (source.length > MAX_HIGHLIGHT_LENGTH) return escapeHtml(source);

    const tokens = lex(source);
    let html = '';

    tokens.forEach((token, index) => {
        html += highlightLeading(token.leading);
        const className = tokenClass(tokens, index);
        html += className ? wrapInSpan(className, token.value) : escapeHtml(token.value);
    });

    return html;
}
