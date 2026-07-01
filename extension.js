const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

// ─── State ────────────────────────────────────────────────────────────────────

/** @type {Record<string, Record<string, any>>} */
let allLocaleKeys = {};

/** @type {Record<string, Record<string, string>>} locale → key → absolute file path */
let keyFileMap = {};

/** @type {string} */
let localesAbsPath = '';

/** @type {vscode.DiagnosticCollection} */
let diagnosticCollection;

/** @type {vscode.TextEditorDecorationType} */
let inlineDecorationType;

// ─── Activation ───────────────────────────────────────────────────────────────

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    diagnosticCollection = vscode.languages.createDiagnosticCollection('ngx-i18n');
    context.subscriptions.push(diagnosticCollection);

    inlineDecorationType = vscode.window.createTextEditorDecorationType({
        after: {
            color: new vscode.ThemeColor('editorCodeLens.foreground'),
            fontStyle: 'italic',
            margin: '0 0 0 6px',
        },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
    context.subscriptions.push(inlineDecorationType);

    // Defer initial load so the workspace filesystem is fully ready
    setTimeout(() => {
        loadLocaleKeys();
        revalidateAll();
        refreshAllDecorations();
        if (vscode.window.activeTextEditor) {
            validateDocument(vscode.window.activeTextEditor.document);
            updateDecorations(vscode.window.activeTextEditor);
        }
    }, 1500);

    // Watch locale JSON changes
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.json');
    watcher.onDidChange(uri => { if (isLocaleFile(uri)) { loadLocaleKeys(); revalidateAll(); refreshAllDecorations(); } });
    watcher.onDidCreate(uri => { if (isLocaleFile(uri)) { loadLocaleKeys(); revalidateAll(); refreshAllDecorations(); } });
    watcher.onDidDelete(uri => { if (isLocaleFile(uri)) { loadLocaleKeys(); revalidateAll(); refreshAllDecorations(); } });
    context.subscriptions.push(watcher);

    // Validate + decorate on document events
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => {
            validateDocument(doc);
            const editor = vscode.window.visibleTextEditors.find(e => e.document === doc);
            if (editor) updateDecorations(editor);
        }),
        vscode.workspace.onDidChangeTextDocument(e => {
            validateDocument(e.document);
            const editor = vscode.window.visibleTextEditors.find(ed => ed.document === e.document);
            if (editor) updateDecorations(editor);
        }),
        vscode.workspace.onDidSaveTextDocument(doc => {
            validateDocument(doc);
            const editor = vscode.window.visibleTextEditors.find(e => e.document === doc);
            if (editor) updateDecorations(editor);
        }),
        vscode.workspace.onDidCloseTextDocument(doc => diagnosticCollection.delete(doc.uri)),
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) { validateDocument(editor.document); updateDecorations(editor); }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('ngxI18n')) { loadLocaleKeys(); revalidateAll(); refreshAllDecorations(); }
        })
    );

    // ── Commands ──────────────────────────────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand('i18nKV.reload', () => {
            loadLocaleKeys(); revalidateAll(); refreshAllDecorations();
            vscode.window.showInformationMessage('i18nKV: Locale files reloaded ✓');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('i18nKV.openLocaleFile', async ({ filePath, key }) => {
            if (!filePath || !fs.existsSync(filePath)) {
                vscode.window.showWarningMessage(`i18nKV: File not found — ${filePath}`);
                return;
            }
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            const editor = await vscode.window.showTextDocument(doc);
            const segments = key.split('.');
            const lastSegment = segments[segments.length - 1];
            const lines = doc.getText().split('\n');
            let targetLine = 0;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(`"${lastSegment}"`)) { targetLine = i; break; }
            }
            const pos = new vscode.Position(targetLine, 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        })
    );

    // Quick fix: create missing key in all locales
    context.subscriptions.push(
        vscode.commands.registerCommand('i18nKV.createKey', async ({ key }) => {
            await createKeyInAllLocales(key);
        })
    );

    // ── Providers ─────────────────────────────────────────────────────────────

    const langs = [{ language: 'html' }, { language: 'typescript' }];

    context.subscriptions.push(
        vscode.languages.registerHoverProvider(langs, { provideHover }),
        vscode.languages.registerCompletionItemProvider(langs, { provideCompletionItems }, "'", '"', '.'),
        vscode.languages.registerCodeActionsProvider(langs, { provideCodeActions }, {
            providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
        }),
        vscode.languages.registerDefinitionProvider(langs, { provideDefinition })
    );
}

function deactivate() {}

// ─── Config ───────────────────────────────────────────────────────────────────

function getConfig() {
    const cfg = vscode.workspace.getConfiguration('ngxI18n');
    return {
        localesPath: cfg.get('localesPath', 'src/assets/i18n'),
        sourceLocale: cfg.get('sourceLocale', 'es'),
        severity: cfg.get('severity', 'error'),
    };
}

function getWorkspaceRoot() {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri.fsPath : null;
}

function isLocaleFile(uri) {
    return localesAbsPath && uri.fsPath.startsWith(localesAbsPath);
}

// ─── Locale loader ────────────────────────────────────────────────────────────

/**
 * Whether the locales directory uses the flat pattern ({locale}.json)
 * or the namespaced pattern ({locale}/{namespace}.json subdirs).
 * @type {'flat' | 'namespaced' | null}
 */
let localeStructure = null;

function flattenKeys(obj, prefix, result) {
    for (const key of Object.keys(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        const val = obj[key];
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            flattenKeys(val, fullKey, result);
        } else {
            result[fullKey] = val;
        }
    }
}

/**
 * Detect which file structure the locales directory uses:
 *  - 'namespaced': contains subdirectories (es/, en/, fr/) each with *.json files
 *  - 'flat':       contains {locale}.json files directly (en.json, es.json, ...)
 * @param {string} localesRoot
 * @returns {'flat' | 'namespaced'}
 */
function detectLocaleStructure(localesRoot) {
    try {
        const entries = fs.readdirSync(localesRoot, { withFileTypes: true });
        const hasDirs = entries.some(e => e.isDirectory());
        if (hasDirs) return 'namespaced';
        const hasJsonFiles = entries.some(e => e.isFile() && e.name.endsWith('.json'));
        if (hasJsonFiles) return 'flat';
    } catch (_) { }
    return 'namespaced'; // default
}

function loadLocaleKeys() {
    allLocaleKeys = {};
    keyFileMap = {};
    localeStructure = null;
    const root = getWorkspaceRoot();
    if (!root) return;

    const { localesPath } = getConfig();
    const localesRoot = path.join(root, localesPath);
    localesAbsPath = localesRoot;
    if (!fs.existsSync(localesRoot)) return;

    localeStructure = detectLocaleStructure(localesRoot);

    if (localeStructure === 'namespaced') {
        // Pattern: {localesRoot}/{locale}/{namespace}.json
        let localeDirs;
        try {
            localeDirs = fs.readdirSync(localesRoot, { withFileTypes: true })
                .filter(d => d.isDirectory()).map(d => d.name);
        } catch (e) { return; }

        for (const locale of localeDirs) {
            const localePath = path.join(localesRoot, locale);
            allLocaleKeys[locale] = {};
            keyFileMap[locale] = {};
            try {
                const files = fs.readdirSync(localePath).filter(f => f.endsWith('.json'));
                for (const file of files) {
                    const filePath = path.join(localePath, file);
                    try {
                        const flat = {};
                        flattenKeys(JSON.parse(fs.readFileSync(filePath, 'utf8')), '', flat);
                        for (const k of Object.keys(flat)) {
                            allLocaleKeys[locale][k] = flat[k];
                            keyFileMap[locale][k] = filePath;
                        }
                    } catch (_) { }
                }
            } catch (_) { }
        }
    } else {
        // Pattern: {localesRoot}/{locale}.json  (e.g. en.json, es.json)
        let files;
        try {
            files = fs.readdirSync(localesRoot, { withFileTypes: true })
                .filter(e => e.isFile() && e.name.endsWith('.json'))
                .map(e => e.name);
        } catch (e) { return; }

        for (const file of files) {
            const locale = path.basename(file, '.json'); // "en", "es", "fr", ...
            const filePath = path.join(localesRoot, file);
            allLocaleKeys[locale] = {};
            keyFileMap[locale] = {};
            try {
                const flat = {};
                flattenKeys(JSON.parse(fs.readFileSync(filePath, 'utf8')), '', flat);
                for (const k of Object.keys(flat)) {
                    allLocaleKeys[locale][k] = flat[k];
                    keyFileMap[locale][k] = filePath;
                }
            } catch (_) { }
        }
    }
}

function getSourceKeys() {
    const { sourceLocale } = getConfig();
    return allLocaleKeys[sourceLocale] ?? {};
}

// ─── Key extraction ───────────────────────────────────────────────────────────

/**
 * @param {vscode.TextDocument} doc
 * @returns {{ key: string, range: vscode.Range }[]}
 */
function extractI18nUsages(doc) {
    const text = doc.getText();
    const usages = [];
    const seen = new Set();

    // Keys can be dot-notation nested (company.tabs.menu) OR flat with underscores/capitals (Athletes, Search_by)
    // Must contain at least one dot OR underscore to distinguish from plain strings, unless it's a flat-structure project
    const QUOTED_KEY_RE = /['"]([a-zA-Z][a-zA-Z0-9_]*(?:[._][a-zA-Z0-9_]+)*)['"]/g;
    const translatePipeRe = /\(([^)]*)\)\s*\|\s*translate|['"]([a-zA-Z][a-zA-Z0-9_]*(?:[._][a-zA-Z0-9_]*)*)['"]\s*\|\s*translate/g;

    let match;
    translatePipeRe.lastIndex = 0;
    while ((match = translatePipeRe.exec(text)) !== null) {
        const inner = match[1] ?? match[2];
        const innerStart = match.index + match[0].indexOf(inner);
        if (match[1]) {
            QUOTED_KEY_RE.lastIndex = 0;
            let km;
            while ((km = QUOTED_KEY_RE.exec(inner)) !== null) {
                const key = km[1];
                const keyStart = innerStart + km.index + 1;
                if (!seen.has(keyStart)) {
                    seen.add(keyStart);
                    usages.push({ key, range: new vscode.Range(doc.positionAt(keyStart), doc.positionAt(keyStart + key.length)) });
                }
            }
        } else {
            const key = match[2];
            const keyStart = innerStart;
            if (!seen.has(keyStart)) {
                seen.add(keyStart);
                usages.push({ key, range: new vscode.Range(doc.positionAt(keyStart), doc.positionAt(keyStart + key.length)) });
            }
        }
    }

    const serviceRe = /translate(?:Service)?\.(?:instant|get|stream)\(\s*['"]([a-zA-Z][a-zA-Z0-9_]*(?:[._][a-zA-Z0-9_]*)*)['"]/g;
    serviceRe.lastIndex = 0;
    while ((match = serviceRe.exec(text)) !== null) {
        const key = match[1];
        const keyStart = match.index + match[0].lastIndexOf(key);
        if (!seen.has(keyStart)) {
            seen.add(keyStart);
            usages.push({ key, range: new vscode.Range(doc.positionAt(keyStart), doc.positionAt(keyStart + key.length)) });
        }
    }

    return usages;
}

// ─── Validation ───────────────────────────────────────────────────────────────

function getSeverity(severityStr) {
    switch (severityStr) {
        case 'warning': return vscode.DiagnosticSeverity.Warning;
        case 'info': return vscode.DiagnosticSeverity.Information;
        default: return vscode.DiagnosticSeverity.Error;
    }
}

function validateDocument(doc) {
    if (!['html', 'typescript'].includes(doc.languageId)) return;
    const sourceKeys = getSourceKeys();
    if (Object.keys(sourceKeys).length === 0) { diagnosticCollection.set(doc.uri, []); return; }

    const { severity } = getConfig();
    const diags = [];
    for (const { key, range } of extractI18nUsages(doc)) {
        if (!(key in sourceKeys)) {
            const diag = new vscode.Diagnostic(range, `i18n key "${key}" not found in source locale`, getSeverity(severity));
            diag.source = 'ngx-i18n';
            diag.code = 'missing-key';
            diags.push(diag);
        }
    }
    diagnosticCollection.set(doc.uri, diags);
}

function revalidateAll() {
    for (const doc of vscode.workspace.textDocuments) validateDocument(doc);
}

// ─── Inline decorations ───────────────────────────────────────────────────────

function truncate(val, max = 40) {
    if (typeof val !== 'string') return String(val);
    return val.length > max ? val.slice(0, max) + '…' : val;
}

function updateDecorations(editor) {
    if (!editor) return;
    const doc = editor.document;
    if (!['html', 'typescript'].includes(doc.languageId)) return;
    const sourceKeys = getSourceKeys();
    if (Object.keys(sourceKeys).length === 0) { editor.setDecorations(inlineDecorationType, []); return; }

    const decorations = [];
    for (const { key, range } of extractI18nUsages(doc)) {
        const value = sourceKeys[key];
        if (value !== undefined) {
            decorations.push({ range, renderOptions: { after: { contentText: truncate(String(value)) } } });
        }
    }
    editor.setDecorations(inlineDecorationType, decorations);
}

function refreshAllDecorations() {
    for (const editor of vscode.window.visibleTextEditors) updateDecorations(editor);
}

// ─── Hover ────────────────────────────────────────────────────────────────────

const LOCALE_LABELS = { es: '🇪🇸 ES', en: '🇬🇧 EN', fr: '🇫🇷 FR' };

/** Returns locale keys sorted: es first, en second, rest alphabetically */
function sortedLocales() {
    const priority = ['es', 'en'];
    const all = Object.keys(allLocaleKeys);
    const head = priority.filter(l => all.includes(l));
    const tail = all.filter(l => !priority.includes(l)).sort();
    return [...head, ...tail];
}

function provideHover(doc, position) {
    if (!['html', 'typescript'].includes(doc.languageId)) return null;
    const sourceKeys = getSourceKeys();
    if (Object.keys(sourceKeys).length === 0) return null;

    const usage = extractI18nUsages(doc).find(u => u.range.contains(position));
    if (!usage) return null;

    const { key } = usage;
    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true;
    md.supportHtml = true;

    if (!(key in sourceKeys)) {
        md.appendMarkdown(`**ngx-i18n** ❌ \`${key}\` — key not found\n`);
        return new vscode.Hover(md, usage.range);
    }

    md.appendMarkdown(`**ngx-i18n** \`${key}\`\n\n---\n\n`);

    for (const locale of sortedLocales()) {
        const label = LOCALE_LABELS[locale] ?? `🌐 ${locale.toUpperCase()}`;
        const val = allLocaleKeys[locale]?.[key];
        const filePath = keyFileMap[locale]?.[key];
        const cmdArgs = encodeURIComponent(JSON.stringify({ filePath, key }));
        const openLink = filePath
            ? `[$(go-to-file)](command:i18nKV.openLocaleFile?${cmdArgs} "Abrir ${locale}/${path.basename(filePath)}")`
            : '';

        md.appendMarkdown(val !== undefined
            ? `${label} &nbsp; ${String(val)} &nbsp; ${openLink}\n\n`
            : `${label} &nbsp; *(missing)* &nbsp; ${openLink}\n\n`
        );
    }

    return new vscode.Hover(md, usage.range);
}

// ─── Ctrl+Click → go to source locale file ───────────────────────────────────

/**
 * Ctrl+Click on any i18n key opens the source locale JSON at the key's line.
 * @param {vscode.TextDocument} doc
 * @param {vscode.Position} position
 */
function provideDefinition(doc, position) {
    if (!['html', 'typescript'].includes(doc.languageId)) return null;

    const usage = extractI18nUsages(doc).find(u => u.range.contains(position));
    if (!usage) return null;

    const { sourceLocale } = getConfig();
    const filePath = keyFileMap[sourceLocale]?.[usage.key];
    if (!filePath || !fs.existsSync(filePath)) return null;

    // Find the line in the JSON file that contains the last key segment
    const segments = usage.key.split('.');
    const lastSegment = segments[segments.length - 1];
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    let targetLine = 0;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`"${lastSegment}"`)) { targetLine = i; break; }
    }

    return new vscode.Location(
        vscode.Uri.file(filePath),
        new vscode.Position(targetLine, 0)
    );
}

// ─── Autocompletado ───────────────────────────────────────────────────────────

/**
 * Suggests i18n keys when typing inside a translate pipe context.
 * Triggers on ' " and .
 * @param {vscode.TextDocument} doc
 * @param {vscode.Position} position
 */
function provideCompletionItems(doc, position) {
    const sourceKeys = getSourceKeys();
    if (Object.keys(sourceKeys).length === 0) return null;

    const lineText = doc.lineAt(position).text;
    const textBefore = lineText.slice(0, position.character);

    // Only suggest inside translate pipe context:
    // must have | translate somewhere on the line, or the user is typing a key in quotes
    const hasTranslatePipe = lineText.includes('| translate') || lineText.includes('|translate');
    const inTranslateCall = /translate(?:Service)?\.(?:instant|get|stream)\(\s*['"][^'"]*$/.test(textBefore);

    if (!hasTranslatePipe && !inTranslateCall) return null;

    // Extract what the user has typed so far (the partial key)
    const partialMatch = textBefore.match(/['"]([a-z][a-zA-Z0-9.]*)?$/);
    const partial = partialMatch ? (partialMatch[1] ?? '') : '';

    const items = [];
    for (const key of Object.keys(sourceKeys)) {
        if (!key.startsWith(partial)) continue;

        const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Value);
        const value = sourceKeys[key];
        item.detail = value !== undefined ? String(value) : undefined;

        // Show all locale values in documentation
        const md = new vscode.MarkdownString();
        for (const locale of Object.keys(allLocaleKeys)) {
            const label = LOCALE_LABELS[locale] ?? locale.toUpperCase();
            const v = allLocaleKeys[locale]?.[key];
            md.appendMarkdown(`${label} &nbsp; ${v !== undefined ? String(v) : '*(missing)*'}\n\n`);
        }
        item.documentation = md;

        // Replace from start of the partial key to current position
        const startChar = position.character - partial.length;
        item.range = new vscode.Range(position.line, startChar, position.line, position.character);
        item.insertText = key;
        item.filterText = key;
        items.push(item);
    }

    return items;
}

// ─── Quick Fix — crear key en todos los locales ───────────────────────────────

/**
 * @param {vscode.TextDocument} doc
 * @param {vscode.Range} range
 * @param {vscode.CodeActionContext} context
 */
function provideCodeActions(doc, range, context) {
    const actions = [];

    for (const diag of context.diagnostics) {
        if (diag.source !== 'ngx-i18n' || diag.code !== 'missing-key') continue;

        // Extract the missing key from the diagnostic message
        const keyMatch = diag.message.match(/i18n key "([^"]+)"/);
        if (!keyMatch) continue;
        const key = keyMatch[1];

        const action = new vscode.CodeAction(
            `💡 Crear key "${key}" en todos los locales`,
            vscode.CodeActionKind.QuickFix
        );
        action.command = {
            command: 'i18nKV.createKey',
            title: 'Crear key en todos los locales',
            arguments: [{ key }],
        };
        action.diagnostics = [diag];
        action.isPreferred = true;
        actions.push(action);
    }

    return actions;
}

/**
 * Inserts a missing key into all locale JSON files.
 * Uses the namespace (first segment) to determine which file to write to.
 * If the file doesn't exist yet, creates it with just that namespace.
 * @param {string} key  e.g. "company.tabs.newKey"
 */
async function createKeyInAllLocales(key) {
    const root = getWorkspaceRoot();
    if (!root) return;

    const { localesPath, sourceLocale } = getConfig();
    const localesRoot = path.join(root, localesPath);
    const segments = key.split('.');

    // Ask the user for the source locale value
    const placeholder = await vscode.window.showInputBox({
        prompt: `Valor para "${key}" en ${sourceLocale} (source locale)`,
        placeHolder: 'Escribe la traducción...',
        ignoreFocusOut: true,
    });

    if (placeholder === undefined) return; // user cancelled

    let createdIn = [];
    const structure = localeStructure ?? detectLocaleStructure(localesRoot);

    if (structure === 'namespaced') {
        // Pattern: {localesRoot}/{locale}/{namespace}.json
        const namespace = segments[0]; // e.g. "company"
        let localeDirs = [];
        try {
            localeDirs = fs.readdirSync(localesRoot, { withFileTypes: true })
                .filter(d => d.isDirectory()).map(d => d.name);
        } catch (_) { }

        if (localeDirs.length === 0) {
            vscode.window.showWarningMessage('i18nKV: No se encontraron carpetas de locale.');
            return;
        }

        for (const locale of localeDirs) {
            const localePath = path.join(localesRoot, locale);
            const targetFile = path.join(localePath, `${namespace}.json`);

            let json = {};
            if (fs.existsSync(targetFile)) {
                try { json = JSON.parse(fs.readFileSync(targetFile, 'utf8')); } catch (_) { json = {}; }
            }

            const value = locale === sourceLocale ? placeholder : `[${locale.toUpperCase()}] ${placeholder}`;
            setNestedKey(json, segments, value);

            try {
                fs.writeFileSync(targetFile, JSON.stringify(json, null, 2) + '\n', 'utf8');
                createdIn.push(locale);
            } catch (e) {
                vscode.window.showErrorMessage(`i18nKV: Error escribiendo ${targetFile}: ${e.message}`);
            }
        }
    } else {
        // Pattern: {localesRoot}/{locale}.json  (e.g. en.json, es.json)
        let localeFiles = [];
        try {
            localeFiles = fs.readdirSync(localesRoot, { withFileTypes: true })
                .filter(e => e.isFile() && e.name.endsWith('.json'))
                .map(e => e.name);
        } catch (_) { }

        if (localeFiles.length === 0) {
            vscode.window.showWarningMessage('i18nKV: No se encontraron archivos de locale.');
            return;
        }

        for (const file of localeFiles) {
            const locale = path.basename(file, '.json');
            const targetFile = path.join(localesRoot, file);

            let json = {};
            if (fs.existsSync(targetFile)) {
                try { json = JSON.parse(fs.readFileSync(targetFile, 'utf8')); } catch (_) { json = {}; }
            }

            const value = locale === sourceLocale ? placeholder : `[${locale.toUpperCase()}] ${placeholder}`;
            setNestedKey(json, segments, value);

            try {
                fs.writeFileSync(targetFile, JSON.stringify(json, null, 2) + '\n', 'utf8');
                createdIn.push(locale);
            } catch (e) {
                vscode.window.showErrorMessage(`i18nKV: Error escribiendo ${targetFile}: ${e.message}`);
            }
        }
    }

    // Reload keys and re-validate
    loadLocaleKeys();
    revalidateAll();
    refreshAllDecorations();

    vscode.window.showInformationMessage(
        `i18nKV: Key "${key}" creado en ${createdIn.join(', ')} ✓`
    );
}

/**
 * Set a value at a nested path in an object.
 * setNestedKey(obj, ['company','tabs','newKey'], 'Valor')
 * @param {Record<string, any>} obj
 * @param {string[]} segments
 * @param {string} value
 */
function setNestedKey(obj, segments, value) {
    let current = obj;
    for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i];
        if (!current[seg] || typeof current[seg] !== 'object') {
            current[seg] = {};
        }
        current = current[seg];
    }
    current[segments[segments.length - 1]] = value;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { activate, deactivate };
