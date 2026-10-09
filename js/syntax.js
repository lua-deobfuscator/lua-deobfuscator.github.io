const STATEMENT_KEYWORDS = new Set([
    'local', 'if', 'while', 'for', 'repeat', 'return', 'break', 'goto', 'do', 'function',
]);

const EXPRESSION_ENDING_KEYWORDS = new Set(['end', 'nil', 'true', 'false', 'break']);

const EXPRESSION_ENDING_OPERATORS = new Set([')', ']', '}', '...', ';']);

const BLOCK_CLOSERS = new Set(['end', 'else', 'elseif', 'until']);

function endsExpression(token) {
    switch (token.type) {
        case 'name':
        case 'number':
        case 'string':
            return true;
        case 'keyword':
            return EXPRESSION_ENDING_KEYWORDS.has(token.value);
        case 'operator':
            return EXPRESSION_ENDING_OPERATORS.has(token.value);
        default:
            return false;
    }
}

function startsStatement(token) {
    if (token.type === 'name') return true;
    if (token.type === 'keyword') return STATEMENT_KEYWORDS.has(token.value);
    return token.type === 'operator' && token.value === '::';
}

function isBlockCloser(token) {
    return token.type === 'keyword' && BLOCK_CLOSERS.has(token.value);
}
