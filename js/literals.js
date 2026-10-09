const utf8Encoder = new TextEncoder();

const SIMPLE_ESCAPES = {
    a: 7,
    b: 8,
    f: 12,
    n: 10,
    r: 13,
    t: 9,
    v: 11,
    '\\': 92,
    '"': 34,
    "'": 39,
    '\n': 10,
};

const MAX_SIGNED_64_BIT = 0x7fffffffffffffffn;

function pushAll(target, items) {
    for (const item of items) {
        target.push(item);
    }
}

function decodeUtf8(bytes) {
    try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
        return [...text].map((char) => char.codePointAt(0));
    } catch {
        return null;
    }
}

function chooseQuote(bytes) {
    const hasDoubleQuote = bytes.includes(34);
    const hasSingleQuote = bytes.includes(39);
    return hasDoubleQuote && !hasSingleQuote ? "'" : '"';
}

function encodeLuaString(bytes, quote = '"') {
    const quoteCode = quote.charCodeAt(0);
    const pieces = [];

    function escapeAscii(code) {
        if (code === 92) return '\\\\';
        if (code === quoteCode) return '\\' + quote;
        if (code === 10) return '\\n';
        if (code === 9) return '\\t';
        if (code === 13) return '\\r';
        if (code >= 32 && code < 127) return String.fromCharCode(code);
        return { byte: code };
    }

    const codePoints = decodeUtf8(bytes);
    if (codePoints) {
        for (const code of codePoints) {
            if (code < 128) {
                pieces.push(escapeAscii(code));
            } else if (code >= 160) {
                pieces.push(String.fromCodePoint(code));
            } else {
                for (const byte of utf8Encoder.encode(String.fromCodePoint(code))) {
                    pieces.push({ byte });
                }
            }
        }
    } else {
        for (const byte of bytes) {
            pieces.push(byte < 128 ? escapeAscii(byte) : { byte });
        }
    }

    const body = pieces.map((piece, index) => {
        if (typeof piece === 'string') return piece;
        const next = pieces[index + 1];
        const nextIsDigit = typeof next === 'string' && /^\d/.test(next);
        const digits = nextIsDigit ? String(piece.byte).padStart(3, '0') : String(piece.byte);
        return '\\' + digits;
    });

    return quote + body.join('') + quote;
}

function decodeLuaString(raw) {
    const body = raw.slice(1, -1);
    const bytes = [];
    let i = 0;

    while (i < body.length) {
        if (body[i] !== '\\') {
            let next = body.indexOf('\\', i);
            if (next < 0) next = body.length;
            pushAll(bytes, utf8Encoder.encode(body.slice(i, next)));
            i = next;
            continue;
        }

        const escape = body[i + 1];
        let match;

        if (escape !== undefined && escape in SIMPLE_ESCAPES) {
            bytes.push(SIMPLE_ESCAPES[escape]);
            i += 2;
        } else if (escape === '\r') {
            bytes.push(10);
            i += body[i + 2] === '\n' ? 3 : 2;
        } else if (escape === 'x' && (match = /^[0-9a-fA-F]{2}/.exec(body.slice(i + 2, i + 4)))) {
            bytes.push(parseInt(match[0], 16));
            i += 4;
        } else if (escape === 'z') {
            i += 2;
            while (i < body.length && /\s/.test(body[i])) i++;
        } else if (escape && /\d/.test(escape)) {
            match = /^\d{1,3}/.exec(body.slice(i + 1, i + 4));
            if (Number(match[0]) > 255) return null;
            bytes.push(Number(match[0]));
            i += 1 + match[0].length;
        } else if (escape === 'u' && (match = /^\{([0-9a-fA-F]+)\}/.exec(body.slice(i + 2, i + 14)))) {
            pushAll(bytes, utf8Encoder.encode(String.fromCodePoint(parseInt(match[1], 16))));
            i += 2 + match[0].length;
        } else {
            return null;
        }
    }

    return bytes;
}

function readCharArguments(tokens, start) {
    const bytes = [];
    let i = start;

    while (tokens[i].value !== ')') {
        const argument = tokens[i];
        const number = Number(argument.value);
        const isByte = argument.type === 'number' && Number.isInteger(number) && number >= 0 && number <= 255;
        if (!isByte) return null;

        bytes.push(number);
        i++;

        if (tokens[i].value === ',') {
            i++;
        } else if (tokens[i].value !== ')') {
            return null;
        }
    }

    return { bytes, end: i };
}

function foldStringChar(tokens) {
    const result = [];

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const previous = result[result.length - 1];
        const isMemberAccess = previous && previous.type === 'operator' && (previous.value === '.' || previous.value === ':');

        const isStringCharCall =
            token.type === 'name' &&
            token.value === 'string' &&
            tokens[i + 1].value === '.' &&
            tokens[i + 2]?.value === 'char' &&
            tokens[i + 3]?.value === '(' &&
            !isMemberAccess;

        if (isStringCharCall) {
            const call = readCharArguments(tokens, i + 4);
            if (call) {
                let literal = encodeLuaString(call.bytes, chooseQuote(call.bytes));
                const after = tokens[call.end + 1];
                const needsParentheses = after.type === 'operator' && [':', '.', '['].includes(after.value);
                if (needsParentheses) literal = '(' + literal + ')';

                result.push({ type: 'string', value: literal, leading: token.leading, comments: token.comments });
                i = call.end;
                continue;
            }
        }

        result.push(token);
    }

    return result;
}

function convertHexNumbers(tokens) {
    for (const token of tokens) {
        if (token.type !== 'number' || !/^0[xX][0-9a-fA-F]+$/.test(token.value)) continue;
        const value = BigInt(token.value);
        if (value <= MAX_SIGNED_64_BIT) {
            token.value = value.toString();
        }
    }
}

function normalizeStringEscapes(tokens) {
    for (const token of tokens) {
        const isQuoted = token.type === 'string' && token.value.length > 1 && /^["']/.test(token.value);
        if (!isQuoted) continue;

        try {
            const bytes = decodeLuaString(token.value);
            if (bytes) {
                token.value = encodeLuaString(bytes, chooseQuote(bytes));
            }
        } catch {
            continue;
        }
    }
}
