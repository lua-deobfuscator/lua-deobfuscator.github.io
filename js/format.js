const NO_SPACE_BEFORE = new Set([',', ';', ')', ']', '}', '.', ':']);
const NO_SPACE_AFTER = new Set(['(', '[', '{', '.', ':', '#', '::']);
const BLOCK_STARTING_KEYWORDS = new Set(['function', 'if', 'for', 'while', 'repeat', 'do']);
const MULTILINE_TABLE_TOKEN_LIMIT = 14;

function findMultilineTables(tokens) {
    const functionsBefore = [0];
    tokens.forEach((token, i) => {
        const isFunction = token.type === 'keyword' && token.value === 'function';
        functionsBefore.push(functionsBefore[i] + (isFunction ? 1 : 0));
    });

    const multiline = new Set();
    const openings = [];

    tokens.forEach((token, i) => {
        if (token.type !== 'operator') return;

        if (token.value === '{') {
            openings.push(i);
        } else if (token.value === '}') {
            const open = openings.pop();
            if (open === undefined) return;

            const isLarge = i - open > MULTILINE_TABLE_TOKEN_LIMIT;
            const containsFunction = functionsBefore[i] - functionsBefore[open] > 0;
            if (isLarge || containsFunction) multiline.add(open);
        }
    });

    return multiline;
}

function needsSpaceBetween(previous, token, insideLabel) {
    const previousValue = previous.type === 'operator' ? previous.value : '';
    const value = token.type === 'operator' ? token.value : '';

    if (NO_SPACE_BEFORE.has(value) || NO_SPACE_AFTER.has(previousValue)) return false;
    if (value === '::' && insideLabel) return false;

    const canBeCalled =
        previous.type === 'name' ||
        previous.type === 'string' ||
        previousValue === ')' ||
        previousValue === ']' ||
        previousValue === '}';

    if (value === '(' || value === '[') {
        const isAnonymousFunction = value === '(' && previous.type === 'keyword' && previous.value === 'function';
        return !(canBeCalled || isAnonymousFunction);
    }
    if (value === '{') return previous.type !== 'name';

    return true;
}

function formatTokens(tokens, indentUnit, blankLines) {
    const multilineTables = findMultilineTables(tokens);
    const contexts = [{ kind: 'block', loopHeaders: [] }];
    const output = [];

    let level = 0;
    let atLineStart = true;
    let forceBreak = false;
    let justOpened = false;
    let firstInBlock = true;
    let afterBlockEnd = false;
    let insideLabel = false;
    let previous = null;
    let previousEndsExpression = false;
    let previousWasUnary = false;

    function currentContext() {
        return contexts[contexts.length - 1];
    }

    function countsAsIndent(kind) {
        return kind === 'block' || kind === 'table-multiline';
    }

    function pushContext(kind) {
        contexts.push({ kind, loopHeaders: [] });
        if (countsAsIndent(kind)) level++;
    }

    function popContext() {
        if (contexts.length <= 1) return;
        const removed = contexts.pop();
        if (countsAsIndent(removed.kind)) level--;
    }

    function closeBlock() {
        while (contexts.length > 1 && currentContext().kind !== 'block') {
            popContext();
        }
        popContext();
    }

    function startBody() {
        forceBreak = true;
        justOpened = true;
        firstInBlock = true;
        afterBlockEnd = false;
    }

    function openBlock() {
        pushContext('block');
        startBody();
    }

    function newline() {
        output.push('\n');
        atLineStart = true;
    }

    function write(text, spaceBefore) {
        if (atLineStart) {
            output.push(indentUnit.repeat(level));
        } else if (spaceBefore) {
            output.push(' ');
        }
        output.push(text);
        atLineStart = false;
    }

    function beginsStatement(token) {
        const context = currentContext();
        return (
            context.kind === 'block' &&
            previousEndsExpression &&
            startsStatement(token) &&
            !(token.value === 'do' && context.loopHeaders.length) &&
            !(token.value === '::' && insideLabel)
        );
    }

    function insertBlankLineIfNeeded(token, index) {
        if (currentContext().kind !== 'block') return;
        if (!forceBreak && !beginsStatement(token)) return;

        const opensBlock =
            token.type === 'keyword' &&
            (BLOCK_STARTING_KEYWORDS.has(token.value) ||
                (token.value === 'local' && tokens[index + 1].value === 'function'));

        if (!firstInBlock && (afterBlockEnd || opensBlock)) {
            if (!atLineStart) newline();
            newline();
        }
        firstInBlock = false;
        afterBlockEnd = false;
    }

    function writeBlockCloser(token) {
        closeBlock();
        if (!(justOpened && token.value === 'end') && !atLineStart) newline();
        write(token.value, true);

        forceBreak = false;
        justOpened = false;
        firstInBlock = false;
        if (token.value === 'end' || token.value === 'until') afterBlockEnd = true;
        if (token.value === 'else') openBlock();

        previous = token;
        previousEndsExpression = endsExpression(token);
        previousWasUnary = false;
    }

    function updateAfterOperator(token, index, context, endedExpression) {
        const value = token.value;

        if (value === '(' || value === '[') {
            pushContext(value);
        } else if (value === '{') {
            if (multilineTables.has(index)) {
                pushContext('table-multiline');
                forceBreak = true;
            } else {
                pushContext('{');
            }
        } else if (value === ')' || value === ']') {
            popContext();
            if (value === ')' && currentContext().kind === 'params') {
                currentContext().kind = 'block';
                level++;
                startBody();
            }
        } else if (value === ',') {
            if (context.kind === 'table-multiline') forceBreak = true;
        } else if (value === ';') {
            if (context.kind === 'table-multiline' || context.kind === 'block') forceBreak = true;
        } else if (value === '-' || value === '~') {
            previousWasUnary = !endedExpression;
        } else if (value === '#') {
            previousWasUnary = true;
        } else if (value === '::') {
            insideLabel = !insideLabel;
            if (!insideLabel) forceBreak = true;
        }
    }

    function updateAfterKeyword(token, context) {
        const value = token.value;

        if (value === 'then' || value === 'repeat') {
            openBlock();
        } else if (value === 'do') {
            if (context.loopHeaders.length) context.loopHeaders.pop();
            openBlock();
        } else if (value === 'function') {
            pushContext('params');
        } else if (value === 'while' || value === 'for') {
            context.loopHeaders.push(1);
        }
    }

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        if (blankLines && token.type !== 'eof' && !isBlockCloser(token)) {
            insertBlankLineIfNeeded(token, i);
        }

        for (const comment of token.comments) {
            if (!atLineStart) newline();
            write(comment);
            newline();
            justOpened = false;
        }

        if (token.type === 'eof') break;

        if (isBlockCloser(token)) {
            writeBlockCloser(token);
            continue;
        }

        const context = currentContext();
        const isOperator = token.type === 'operator';

        if ((forceBreak || beginsStatement(token)) && !atLineStart) newline();
        forceBreak = false;
        justOpened = false;

        if (isOperator && token.value === '}') {
            if (context.kind === 'table-multiline') {
                popContext();
                if (!atLineStart) newline();
            } else {
                popContext();
            }
        }

        const spaceBefore = previous && !previousWasUnary && needsSpaceBetween(previous, token, insideLabel);
        write(token.value, spaceBefore);

        const endedExpression = previousEndsExpression;
        previousWasUnary = false;

        if (isOperator) {
            updateAfterOperator(token, i, context, endedExpression);
        } else if (token.type === 'keyword') {
            updateAfterKeyword(token, context);
        }

        previous = token;
        previousEndsExpression = endsExpression(token) || (isOperator && token.value === '::' && !insideLabel);
    }

    return output.join('').replace(/\s+$/, '') + '\n';
}
