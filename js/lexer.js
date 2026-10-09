const KEYWORDS = new Set([
    'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function',
    'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return',
    'then', 'true', 'until', 'while',
]);

const PATTERNS = {
    whitespace: /\s+/y,
    longCommentStart: /--\[(=*)\[/y,
    longStringStart: /\[(=*)\[/y,
    name: /[A-Za-z_]\w*/y,
    number: /0[xX][0-9a-fA-F]*(?:\.[0-9a-fA-F]*)?(?:[pP][+-]?\d+)?|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y,
    operator: /\.\.\.|\.\.=|\.\.|==|~=|<=|>=|\/\/=?|::|<<|>>|[-+*\/%^]=|[-+*\/%^#&~|<>=(){}\[\];:,.]/y,
};

function lex(source) {
    const tokens = [];
    let position = 0;
    let leading = '';
    let comments = [];

    function matchAt(pattern) {
        pattern.lastIndex = position;
        return pattern.exec(source);
    }

    function emit(type, value) {
        tokens.push({ type, value, leading, comments });
        leading = '';
        comments = [];
        position += value.length;
    }

    function endOfBracketed(closer) {
        const index = source.indexOf(closer, position);
        return index < 0 ? source.length : index + closer.length;
    }

    function endOfQuoted(quote) {
        let end = position + 1;
        while (end < source.length && source[end] !== quote && source[end] !== '\n') {
            if (source[end] === '\\' && source[end + 1] === 'z') {
                end += 2;
                while (end < source.length && /\s/.test(source[end])) end++;
            } else {
                end += source[end] === '\\' ? 2 : 1;
            }
        }
        end = Math.min(end, source.length);
        return source[end] === quote ? end + 1 : end;
    }

    while (position < source.length) {
        let match = matchAt(PATTERNS.whitespace);
        if (match) {
            leading += match[0];
            position += match[0].length;
            continue;
        }

        if (source.startsWith('--', position)) {
            let end;
            match = matchAt(PATTERNS.longCommentStart);
            if (match) {
                end = endOfBracketed(']' + match[1] + ']');
            } else {
                end = source.indexOf('\n', position);
                if (end < 0) end = source.length;
            }
            const text = source.slice(position, end);
            comments.push(text.replace(/\s+$/, ''));
            leading += text;
            position = end;
            continue;
        }

        const char = source[position];

        if (char === '"' || char === "'") {
            emit('string', source.slice(position, endOfQuoted(char)));
            continue;
        }

        match = matchAt(PATTERNS.longStringStart);
        if (match) {
            const end = endOfBracketed(']' + match[1] + ']');
            emit('string', source.slice(position, end));
            continue;
        }

        match = matchAt(PATTERNS.number);
        if (match && match[0]) {
            emit('number', match[0]);
            continue;
        }

        match = matchAt(PATTERNS.name);
        if (match) {
            emit(KEYWORDS.has(match[0]) ? 'keyword' : 'name', match[0]);
            continue;
        }

        match = matchAt(PATTERNS.operator);
        emit('operator', match ? match[0] : char);
    }

    tokens.push({ type: 'eof', value: '', leading, comments });
    return tokens;
}
