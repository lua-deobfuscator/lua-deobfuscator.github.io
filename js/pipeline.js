function deobfuscate(source, options) {
    let tokens = lex(source);

    if (options.foldStringChar) tokens = foldStringChar(tokens);
    if (options.hexToDecimal) convertHexNumbers(tokens);
    if (options.decodeEscapes) normalizeStringEscapes(tokens);
    if (options.renameVars) renameVariables(tokens, NAME_STYLES[options.nameStyle]);

    if (options.beautify) {
        return formatTokens(tokens, options.indent, options.blankLines);
    }
    return tokens.map((token) => token.leading + token.value).join('');
}
