const EXAMPLE_SOURCE = String.raw`local _0x1a=string.char(72,101,108,108,111,44,32,119,111,114,108,100) local _0x2b=0x2A local function _0x3c(_0x4d,_0x5e) if _0x4d>_0x5e then return "\65\66\67\10" end for _0x6f=0x1,3 do local _0x4d=_0x4d+_0x6f _0x2b=_0x2b+_0x4d end return _0x2b end local print=print print(_0x1a,_0x3c(0x10,0x20),"\x68\x69")`;

const DEBOUNCE_MS = 150;

const elements = {
    input: document.getElementById('input'),
    output: document.getElementById('output'),
    inputStats: document.getElementById('input-stats'),
    outputStats: document.getElementById('output-stats'),
    beautify: document.getElementById('beautify'),
    indent: document.getElementById('indent'),
    renameVars: document.getElementById('rename-vars'),
    nameStyle: document.getElementById('name-style'),
    blankLines: document.getElementById('blank-lines'),
    foldStringChar: document.getElementById('fold-string-char'),
    decodeEscapes: document.getElementById('decode-escapes'),
    hexToDecimal: document.getElementById('hex-to-decimal'),
    optionsPanel: document.getElementById('options'),
    fileInput: document.getElementById('file-input'),
    exampleButton: document.getElementById('example-button'),
    clearButton: document.getElementById('clear-button'),
    swapButton: document.getElementById('swap-button'),
    downloadButton: document.getElementById('download-button'),
    copyButton: document.getElementById('copy-button'),
};

function formatCount(count) {
    return count.toLocaleString() + ' characters';
}

function readIndentUnit() {
    const choice = elements.indent.value;
    return choice === 'tab' ? '\t' : ' '.repeat(Number(choice));
}

function readOptions() {
    return {
        beautify: elements.beautify.checked,
        indent: readIndentUnit(),
        blankLines: elements.blankLines.checked,
        renameVars: elements.renameVars.checked,
        nameStyle: elements.nameStyle.value,
        foldStringChar: elements.foldStringChar.checked,
        decodeEscapes: elements.decodeEscapes.checked,
        hexToDecimal: elements.hexToDecimal.checked,
    };
}

function paintEditor(textarea) {
    const layer = document.getElementById(textarea.id + '-highlight');
    layer.innerHTML = highlightLua(textarea.value) + '\n';
    layer.scrollTop = textarea.scrollTop;
    layer.scrollLeft = textarea.scrollLeft;
}

function process() {
    const source = elements.input.value;
    elements.outputStats.className = 'stats';
    elements.blankLines.disabled = !elements.beautify.checked;

    try {
        elements.output.value = deobfuscate(source, readOptions());
        elements.inputStats.textContent = source ? formatCount(source.length) : '';
        elements.outputStats.textContent = source ? formatCount(elements.output.value.length) : '';
    } catch (error) {
        elements.output.value = '';
        elements.outputStats.className = 'stats error';
        elements.outputStats.textContent = 'Could not process this input: ' + error.message;
    } finally {
        paintEditor(elements.input);
        paintEditor(elements.output);
    }
}

function setInput(text) {
    elements.input.value = text;
    process();
}

let debounceTimer;

function processSoon() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(process, DEBOUNCE_MS);
}

function syncScroll(textarea) {
    textarea.addEventListener('scroll', () => {
        const layer = document.getElementById(textarea.id + '-highlight');
        layer.scrollTop = textarea.scrollTop;
        layer.scrollLeft = textarea.scrollLeft;
    });
}

async function copyOutput() {
    try {
        await navigator.clipboard.writeText(elements.output.value);
    } catch {
        elements.output.select();
        document.execCommand('copy');
    }
    elements.copyButton.textContent = 'Copied';
    setTimeout(() => {
        elements.copyButton.textContent = 'Copy';
    }, 1200);
}

function downloadOutput() {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([elements.output.value], { type: 'text/plain' }));
    link.download = 'deobfuscated.lua';
    link.click();
    URL.revokeObjectURL(link.href);
}

async function openFile(event) {
    const file = event.target.files[0];
    if (file) setInput(await file.text());
    event.target.value = '';
}

syncScroll(elements.input);
syncScroll(elements.output);

elements.input.addEventListener('input', () => {
    paintEditor(elements.input);
    processSoon();
});
elements.optionsPanel.querySelectorAll('input, select').forEach((control) => {
    control.addEventListener('input', process);
});

elements.exampleButton.addEventListener('click', () => setInput(EXAMPLE_SOURCE));
elements.clearButton.addEventListener('click', () => setInput(''));
elements.swapButton.addEventListener('click', () => {
    if (elements.output.value) setInput(elements.output.value);
});
elements.downloadButton.addEventListener('click', downloadOutput);
elements.copyButton.addEventListener('click', copyOutput);
elements.fileInput.addEventListener('change', openFile);

process();
