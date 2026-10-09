const NAME_STYLES = {
    long: { variable: 'var', function: 'func', argument: 'arg' },
    short: { variable: 'v', function: 'f', argument: 'a' },
};

function createBlockScope() {
    return { kind: 'block', names: new Map(), loopHeaders: [] };
}

function createBracketScope(bracket) {
    return { kind: bracket, loopHeaders: [] };
}

function collectRenames(tokens, reservedNames, prefixes) {
    const renamed = [];
    const globals = new Set();
    const counters = { variable: 0, function: 0, argument: 0 };
    const stack = [createBlockScope()];

    let previousEndsExpression = false;
    let pendingLocals = null;
    let pendingUntil = null;
    let insideLabel = false;

    function currentScope() {
        return stack[stack.length - 1];
    }

    function popScope() {
        if (stack.length > 1) stack.pop();
    }

    function freshName(kind) {
        let name;
        do {
            counters[kind] += 1;
            name = prefixes[kind] + counters[kind];
        } while (reservedNames.has(name));
        return name;
    }

    function declare(name, tokenIndex, scopeNames, kind = 'variable') {
        const newName = freshName(kind);
        scopeNames.set(name, newName);
        renamed[tokenIndex] = newName;
    }

    function lookup(name) {
        for (let i = stack.length - 1; i >= 0; i--) {
            const found = stack[i].names && stack[i].names.get(name);
            if (found) return found;
        }
        return undefined;
    }

    function resolveReference(tokenIndex) {
        const name = tokens[tokenIndex].value;
        const newName = lookup(name);
        if (newName) {
            renamed[tokenIndex] = newName;
        } else {
            globals.add(name);
        }
    }

    function flushPending() {
        if (pendingLocals && stack.length === pendingLocals.depth) {
            for (const [name, tokenIndex] of pendingLocals.names) {
                declare(name, tokenIndex, currentScope().names);
            }
            pendingLocals = null;
        }
        if (pendingUntil && stack.length === pendingUntil.depth) {
            popScope();
            pendingUntil = null;
        }
    }

    function declareParameters(openParenIndex) {
        const scope = createBlockScope();
        stack.push(scope);

        let i = openParenIndex + 1;
        while (tokens[i].type !== 'eof' && tokens[i].value !== ')') {
            if (tokens[i].type === 'name') {
                declare(tokens[i].value, i, scope.names, 'argument');
            }
            i++;
        }
        return i;
    }

    function readNameList(startIndex) {
        const names = [];
        let i = startIndex;

        while (tokens[i].type === 'name') {
            names.push([tokens[i].value, i]);
            i++;
            if (tokens[i].value === '<' && tokens[i + 2]?.value === '>') i += 3;
            if (tokens[i].value === ',') {
                i++;
            } else {
                break;
            }
        }
        return [names, i];
    }

    function handleKeyword(token, i, scope) {
        switch (token.value) {
            case 'local': {
                if (tokens[i + 1].value === 'function') {
                    declare(tokens[i + 2].value, i + 2, currentScope().names, 'function');
                    previousEndsExpression = false;
                    return declareParameters(i + 3);
                }
                const [names, nextIndex] = readNameList(i + 1);
                pendingLocals = { depth: stack.length, names };
                previousEndsExpression = true;
                return nextIndex - 1;
            }

            case 'function': {
                let j = i + 1;
                if (tokens[j].type === 'name') {
                    resolveReference(j);
                    j++;
                    while ((tokens[j].value === '.' || tokens[j].value === ':') && tokens[j + 1]?.type === 'name') {
                        j += 2;
                    }
                }
                previousEndsExpression = false;
                return declareParameters(j);
            }

            case 'for': {
                const [names, nextIndex] = readNameList(i + 1);
                scope.loopHeaders.push(names);
                previousEndsExpression = false;
                return nextIndex - 1;
            }

            case 'while':
                scope.loopHeaders.push(null);
                previousEndsExpression = false;
                return i;

            case 'do': {
                const loopNames = scope.loopHeaders.length ? scope.loopHeaders.pop() : null;
                const bodyScope = createBlockScope();
                stack.push(bodyScope);
                if (loopNames) {
                    for (const [name, tokenIndex] of loopNames) {
                        declare(name, tokenIndex, bodyScope.names);
                    }
                }
                previousEndsExpression = false;
                return i;
            }

            case 'then':
            case 'repeat':
                stack.push(createBlockScope());
                previousEndsExpression = false;
                return i;

            case 'else':
                popScope();
                stack.push(createBlockScope());
                previousEndsExpression = false;
                return i;

            case 'elseif':
                popScope();
                previousEndsExpression = false;
                return i;

            case 'end':
                popScope();
                previousEndsExpression = true;
                return i;

            case 'until':
                pendingUntil = { depth: stack.length };
                previousEndsExpression = false;
                return i;

            case 'goto':
                previousEndsExpression = true;
                return tokens[i + 1].type === 'name' ? i + 1 : i;

            default:
                previousEndsExpression = endsExpression(token);
                return i;
        }
    }

    function handleName(token, i, scope) {
        const previous = tokens[i - 1];
        const next = tokens[i + 1];

        const isMemberName = previous && previous.type === 'operator' && (previous.value === '.' || previous.value === ':');
        const isTableKey =
            scope.kind === '{' &&
            next.value === '=' &&
            previous &&
            previous.type === 'operator' &&
            (previous.value === '{' || previous.value === ',' || previous.value === ';');

        if (!isMemberName && !isTableKey && !insideLabel) {
            resolveReference(i);
        }
        previousEndsExpression = true;
    }

    function handleOperator(token) {
        const value = token.value;

        if (value === '(' || value === '[' || value === '{') {
            stack.push(createBracketScope(value));
            previousEndsExpression = false;
        } else if (value === ')' || value === ']' || value === '}') {
            if (currentScope().kind !== 'block') stack.pop();
            previousEndsExpression = true;
        } else if (value === '::') {
            insideLabel = !insideLabel;
            previousEndsExpression = !insideLabel;
        } else {
            previousEndsExpression = endsExpression(token);
        }
    }

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.type === 'eof') break;

        const scope = currentScope();
        const startsNewStatement =
            scope.kind === 'block' &&
            previousEndsExpression &&
            startsStatement(token) &&
            !(token.value === 'do' && scope.loopHeaders.length);

        if (startsNewStatement) flushPending();

        if (token.type === 'keyword') {
            if (isBlockCloser(token)) flushPending();
            i = handleKeyword(token, i, scope);
        } else if (token.type === 'name') {
            handleName(token, i, scope);
        } else if (token.type === 'operator') {
            handleOperator(token);
        } else {
            previousEndsExpression = endsExpression(token);
        }
    }

    return { renamed, globals };
}

function renameVariables(tokens, prefixes) {
    const { globals } = collectRenames(tokens, new Set(), prefixes);
    const { renamed } = collectRenames(tokens, globals, prefixes);

    renamed.forEach((newName, index) => {
        if (newName) tokens[index].value = newName;
    });
}
