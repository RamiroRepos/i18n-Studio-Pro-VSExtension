const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

// ─── State ────────────────────────────────────────────────────────────────────

/** @type {Record<string, Record<string, any>>} */
let allLocaleKeys = {};

/** @type {vscode.WebviewPanel | undefined} */
let tablePanel;

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
    outputChannel = vscode.window.createOutputChannel('i18n Studio Pro');
    context.subscriptions.push(outputChannel);
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

    // Initial load — try immediately, then retry once the workspace is fully ready
    function initialLoad() {
        loadLocaleKeys();
        revalidateAll();
        refreshAllDecorations();
        if (vscode.window.activeTextEditor) {
            validateDocument(vscode.window.activeTextEditor.document);
            updateDecorations(vscode.window.activeTextEditor);
        }
    }

    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        initialLoad();
    }
    // Retry after workspace is fully settled in case files weren't ready yet
    setTimeout(initialLoad, 1500);

    // Reload when the user opens a new workspace folder
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => initialLoad())
    );

    // Watch locale JSON changes
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.json');
    const onLocaleChange = uri => {
        if (!isLocaleFile(uri)) return;
        loadLocaleKeys(); revalidateAll(); refreshAllDecorations();
        if (tablePanel) tablePanel.webview.postMessage({ type: 'update', data: buildTableData() });
        sendSidebarState();
    };
    watcher.onDidChange(onLocaleChange);
    watcher.onDidCreate(onLocaleChange);
    watcher.onDidDelete(onLocaleChange);
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
            if (e.affectsConfiguration('i18nKV')) { loadLocaleKeys(); revalidateAll(); refreshAllDecorations(); sendSidebarState(); }
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
        vscode.commands.registerCommand('i18nKV.showTable', () => {
            showI18nTable(context);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('i18nKV.showTableForFile', () => {
            const editor = vscode.window.activeTextEditor;
            showI18nTable(context, editor?.document ?? null);
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

    context.subscriptions.push(
        vscode.commands.registerCommand('i18nKV.sortLocaleFile', async ({ filePath }) => {
            await sortLocaleFile(filePath);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('i18nKV.sortAllLocaleFiles', async () => {
            await sortAllLocaleFiles();
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
        vscode.languages.registerDefinitionProvider(langs, { provideDefinition }),
        vscode.languages.registerHoverProvider({ language: 'json' }, { provideHover: provideLocaleJsonHover }),
        vscode.languages.registerCodeLensProvider({ language: 'json' }, { provideCodeLenses: provideLocaleJsonCodeLenses }),
        vscode.window.registerWebviewViewProvider('i18nStudioPro.sidebar', sidebarViewProvider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );
}

function deactivate() {}

// ─── Config ───────────────────────────────────────────────────────────────────

function getConfig() {
    const cfg = vscode.workspace.getConfiguration('i18nKV');
    return {
        localesPath: cfg.get('localesPath', 'src/assets/i18n'),
        sourceLocale: cfg.get('sourceLocale', 'es'),
        severity: cfg.get('severity', 'info'),
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

/** @type {vscode.WebviewView | undefined} */
let sidebarView;

/** @type {boolean} */
let scanCancelled = false;

/** @type {vscode.OutputChannel} */
let outputChannel;

/** @type {string[]} last scan log lines, kept for issue reports */
let lastScanLog = [];

function flattenKeys(obj, prefix, result) {
    for (const key of Object.keys(obj)) {
        const fullKey = prefix != null && prefix !== '' ? `${prefix}.${key}` : key;
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
                        flattenKeys(JSON.parse(fs.readFileSync(filePath, 'utf8')), null, flat);
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
                flattenKeys(JSON.parse(fs.readFileSync(filePath, 'utf8')), null, flat);
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
            // Inside a parenthesized expression like (cond ? 'key1' : 'key2') | translate
            // Only extract strings that appear as ternary branches (after ? or :),
            // not strings that are part of comparison conditions (=== 'value', !== 'value')
            const ternaryBranchRe = /[?:]\s*['"]([a-zA-Z][a-zA-Z0-9_]*(?:[._][a-zA-Z0-9_]+)*)['"]/g;
            let km;
            while ((km = ternaryBranchRe.exec(inner)) !== null) {
                // km[0] starts with ? or :, key starts after that + quote
                const key = km[1];
                const keyStart = innerStart + km.index + km[0].indexOf(key);
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

const LOCALE_LABELS = { es: '🇪🇸 ES', en: 'EN', fr: '🇫🇷 FR' };

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
 * Create a key in all locales using provided translations map.
 * @param {string} key  dot-notation key e.g. "company.tabs.newKey"
 * @param {Record<string, string>} translations  locale → value map
 */
async function createKeyWithTranslations(key, translations) {
    const root = getWorkspaceRoot();
    if (!root) return;

    const { localesPath } = getConfig();
    const localesRoot = path.join(root, localesPath);
    const segments = key.split('.');
    const structure = localeStructure ?? detectLocaleStructure(localesRoot);
    const createdIn = [];

    if (structure === 'namespaced') {
        const namespace = segments[0];
        let localeDirs = [];
        try {
            localeDirs = fs.readdirSync(localesRoot, { withFileTypes: true })
                .filter(d => d.isDirectory()).map(d => d.name);
        } catch (_) { }

        for (const locale of localeDirs) {
            const targetFile = path.join(localesRoot, locale, `${namespace}.json`);
            let json = {};
            if (fs.existsSync(targetFile)) {
                try { json = JSON.parse(fs.readFileSync(targetFile, 'utf8')); } catch (_) { json = {}; }
            }
            const value = translations[locale] ?? translations[Object.keys(translations)[0]] ?? '';
            setNestedKey(json, segments, value);
            try {
                fs.writeFileSync(targetFile, JSON.stringify(json, null, 2) + '\n', 'utf8');
                createdIn.push(locale);
            } catch (e) {
                vscode.window.showErrorMessage(`i18n Studio Pro: Error writing ${targetFile}: ${e.message}`);
            }
        }
    } else {
        let localeFiles = [];
        try {
            localeFiles = fs.readdirSync(localesRoot, { withFileTypes: true })
                .filter(e => e.isFile() && e.name.endsWith('.json')).map(e => e.name);
        } catch (_) { }

        for (const file of localeFiles) {
            const locale = path.basename(file, '.json');
            const targetFile = path.join(localesRoot, file);
            let json = {};
            if (fs.existsSync(targetFile)) {
                try { json = JSON.parse(fs.readFileSync(targetFile, 'utf8')); } catch (_) { json = {}; }
            }
            const value = translations[locale] ?? translations[Object.keys(translations)[0]] ?? '';
            setNestedKey(json, segments, value);
            try {
                fs.writeFileSync(targetFile, JSON.stringify(json, null, 2) + '\n', 'utf8');
                createdIn.push(locale);
            } catch (e) {
                vscode.window.showErrorMessage(`i18n Studio Pro: Error writing ${targetFile}: ${e.message}`);
            }
        }
    }

    loadLocaleKeys();
    revalidateAll();
    refreshAllDecorations();

    sidebarView?.webview.postMessage({ type: 'keyCreated', key });
    vscode.window.showInformationMessage(`i18n Studio Pro: Key "${key}" created in ${createdIn.join(', ')} ✓`);
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

// ─── Hover en archivos JSON de locale ────────────────────────────────────────

/**
 * Hover provider para archivos .json dentro de la carpeta de locales.
 * Al posicionarse sobre una key (string en posición de clave), muestra las
 * traducciones de todos los idiomas disponibles.
 *
 * @param {vscode.TextDocument} doc
 * @param {vscode.Position} position
 * @returns {vscode.Hover | null}
 */
function provideLocaleJsonHover(doc, position) {
    if (!localesAbsPath || !doc.uri.fsPath.startsWith(localesAbsPath)) return null;
    if (Object.keys(allLocaleKeys).length === 0) return null;

    // Determine which locale this file belongs to
    const relPath = path.relative(localesAbsPath, doc.uri.fsPath);
    const parts = relPath.split(path.sep);
    const effectiveStructure = localeStructure ?? detectLocaleStructure(localesAbsPath);
    let fileLocale;
    if (effectiveStructure === 'namespaced' && parts.length >= 2) {
        fileLocale = parts[0]; // e.g. "es"
    } else if (effectiveStructure === 'flat') {
        fileLocale = path.basename(doc.uri.fsPath, '.json'); // e.g. "es"
    }
    if (!fileLocale || !allLocaleKeys[fileLocale]) return null;

    // Find what key the cursor is on.
    // JSON keys look like:  "company.tabs.menu": "value"  (flat)
    // or nested:            "menu": "value"  at some nesting level
    // We reconstruct the full dot-notation key by walking the document text.
    const fullKey = resolveJsonKeyAtPosition(doc, position);
    if (!fullKey) return null;

    // Check if this key exists in any locale
    const existsInAny = Object.values(allLocaleKeys).some(keys => fullKey in keys);
    if (!existsInAny) return null;

    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true;

    md.appendMarkdown(`**ngx-i18n** \`${fullKey}\`\n\n---\n\n`);

    for (const locale of sortedLocales()) {
        if (locale === fileLocale) continue; // skip the current file's locale
        const label = LOCALE_LABELS[locale] ?? `🌐 ${locale.toUpperCase()}`;
        const val = allLocaleKeys[locale]?.[fullKey];
        const filePath = keyFileMap[locale]?.[fullKey];
        const cmdArgs = encodeURIComponent(JSON.stringify({ filePath, key: fullKey }));
        const openLink = filePath
            ? `[$(go-to-file)](command:i18nKV.openLocaleFile?${cmdArgs} "Abrir en ${locale}")`
            : '';

        md.appendMarkdown(val !== undefined
            ? `${label} &nbsp; ${String(val)} &nbsp; ${openLink}\n\n`
            : `${label} &nbsp; *(missing)* &nbsp; ${openLink}\n\n`
        );
    }

    return new vscode.Hover(md);
}

/**
 * Given a cursor position inside a JSON document, reconstructs the full
 * dot-notation key path (e.g. "company.tabs.menu").
 * Works for both flat keys ("company.tabs.menu": ...) and nested objects.
 *
 * @param {vscode.TextDocument} doc
 * @param {vscode.Position} position
 * @returns {string | null}
 */
function resolveJsonKeyAtPosition(doc, position) {
    const lineText = doc.lineAt(position.line).text;

    // The cursor must be over a JSON key (a quoted string before a colon)
    const keyOnLineMatch = lineText.match(/^\s*"([^"]+)"\s*:/);
    if (!keyOnLineMatch) return null;

    const keySegment = keyOnLineMatch[1];

    // Check if the cursor is actually inside the key string
    const keyStart = lineText.indexOf(`"${keySegment}"`);
    const keyEnd = keyStart + keySegment.length + 2; // +2 for quotes
    if (position.character < keyStart || position.character > keyEnd) return null;

    // Walk backwards through the document to reconstruct the full key path
    const segments = [keySegment];
    let currentIndent = lineText.match(/^(\s*)/)[1].length;

    for (let lineIdx = position.line - 1; lineIdx >= 0 && currentIndent > 0; lineIdx--) {
        const prevLine = doc.lineAt(lineIdx).text;
        const prevIndent = prevLine.match(/^(\s*)/)[1].length;

        if (prevIndent < currentIndent) {
            // This line could be a parent key (object opener: "key": {)
            const parentKeyMatch = prevLine.match(/^\s*"([^"]+)"\s*:\s*\{/);
            if (parentKeyMatch) {
                segments.unshift(parentKeyMatch[1]);
                currentIndent = prevIndent;
            } else {
                // Root opening brace or array — stop walking
                break;
            }
        }
        // If prevIndent >= currentIndent, it's a sibling — keep walking up
    }

    return segments.join('.');
}

// ─── Vista tabla i18n ─────────────────────────────────────────────────────────

/**
 * Abre (o revela) el Webview panel con la tabla de keys × idiomas.
 * @param {vscode.ExtensionContext} context
 * @param {vscode.TextDocument | null} filterDoc  Si se pasa, filtra por las keys de ese archivo
 */
function showI18nTable(context, filterDoc = null) {
    const data = buildTableData(filterDoc);

    if (tablePanel) {
        tablePanel.reveal(vscode.ViewColumn.One);
        tablePanel.webview.postMessage({ type: 'update', data });
        return;
    }

    tablePanel = vscode.window.createWebviewPanel(
        'i18nTable',
        'i18n Key Table',
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true }
    );

    tablePanel.webview.html = getTableHtml(tablePanel.webview);
    // Small delay so the webview JS has time to set up the message listener before we send data
    setTimeout(() => {
        if (tablePanel) tablePanel.webview.postMessage({ type: 'update', data });
    }, 300);

    tablePanel.webview.onDidReceiveMessage(msg => {
        if (msg.type === 'openFile') {
            vscode.commands.executeCommand('i18nKV.openLocaleFile', { filePath: msg.filePath, key: msg.key });
        } else if (msg.type === 'createKey') {
            createKeyInAllLocales(msg.key);
        } else if (msg.type === 'sortAll') {
            sortAllLocaleFiles().then(() => {
                if (tablePanel) tablePanel.webview.postMessage({ type: 'update', data: buildTableData() });
            });
        }
    }, undefined, context.subscriptions);

    tablePanel.onDidDispose(() => { tablePanel = undefined; }, null, context.subscriptions);
}

/**
 * Builds the data payload for the table webview.
 * @param {vscode.TextDocument | null} filterDoc  If provided, filters to keys used in that file
 * @returns {{ locales: string[], rows: object[], fileName: string|null, suggestions: string[] }}
 */
function buildTableData(filterDoc = null) {
    const locales = sortedLocales();
    const allKeys = new Set();
    for (const locale of locales) {
        for (const key of Object.keys(allLocaleKeys[locale] ?? {})) {
            allKeys.add(key);
        }
    }

    let fileKeys = null;
    let fileName = null;
    let suggestions = [];

    if (filterDoc && ['html', 'typescript'].includes(filterDoc.languageId)) {
        fileName = path.basename(filterDoc.uri.fsPath);
        const usages = extractI18nUsages(filterDoc);
        fileKeys = new Set(usages.map(u => u.key));
        suggestions = extractPlainTextSuggestions(filterDoc);
    }

    const sourceRows = fileKeys
        ? Array.from(fileKeys).sort()
        : Array.from(allKeys).sort();

    const rows = sourceRows.map(key => ({
        key,
        values: Object.fromEntries(
            locales.map(locale => [locale, allLocaleKeys[locale]?.[key] ?? null])
        ),
        files: Object.fromEntries(
            locales.map(locale => [locale, keyFileMap[locale]?.[key] ?? null])
        ),
    }));

    return { locales, rows, fileName, suggestions };
}

/**
 * Scans an HTML/TS document for plain text strings that are NOT already wrapped
 * in a translate pipe or translate service call, and returns them as suggestions.
 * @param {vscode.TextDocument} doc
 * @returns {string[]}
 */
function extractPlainTextSuggestions(doc) {
    if (doc.languageId !== 'html') return [];
    const text = doc.getText();
    const suggestions = new Set();

    // Match text content between HTML tags that doesn't contain | translate
    // e.g.  <button>Save</button>  or  <label>First name</label>
    const tagContentRe = />([^<>{}"']+)</g;
    let m;
    while ((m = tagContentRe.exec(text)) !== null) {
        const raw = m[1].trim();
        // Skip empty, whitespace-only, template expressions, and things already translated
        if (!raw || raw.length < 3) continue;
        if (/^\d+$/.test(raw)) continue;          // pure numbers
        if (/\{\{/.test(raw)) continue;            // angular template expression
        if (/\|\s*translate/.test(raw)) continue;  // already translated
        suggestions.add(raw);
    }

    // Also match placeholder/title/label attributes with plain text
    const attrRe = /(?:placeholder|title|label|aria-label)\s*=\s*"([^"{}|]+)"/g;
    while ((m = attrRe.exec(text)) !== null) {
        const raw = m[1].trim();
        if (raw && raw.length >= 3 && !/\{\{/.test(raw)) {
            suggestions.add(raw);
        }
    }

    return Array.from(suggestions).slice(0, 30); // cap at 30
}

/**
 * Returns the HTML for the i18n table webview.
 * @param {vscode.Webview} _webview
 * @returns {string}
 */
function getTableHtml(_webview) {
    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>i18n Key Table</title>
<style>
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --border: var(--vscode-panel-border, #444);
    --header-bg: var(--vscode-editorGroupHeader-tabsBackground);
    --row-hover: var(--vscode-list-hoverBackground);
    --missing-color: var(--vscode-editorWarning-foreground, #e8a400);
    --input-bg: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --input-border: var(--vscode-input-border);
    --badge-bg: var(--vscode-badge-background);
    --badge-fg: var(--vscode-badge-foreground);
    --link: var(--vscode-textLink-foreground);
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --btn-hover: var(--vscode-button-hoverBackground);
    --section-bg: var(--vscode-sideBar-background, #1e1e1e);
    --tag-bg: var(--vscode-badge-background);
    --tag-fg: var(--vscode-badge-foreground);
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 12px 16px; background: var(--bg); color: var(--fg); font-family: var(--vscode-font-family); font-size: 13px; }
  h2 { margin: 0 0 4px; font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
  .file-context { font-size: 11px; opacity: 0.6; margin-bottom: 10px; }
  .file-context span { font-family: monospace; opacity: 1; font-weight: 600; }
  .toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
  .toolbar input {
    flex: 1; min-width: 180px; padding: 4px 8px; border-radius: 3px;
    background: var(--input-bg); color: var(--input-fg);
    border: 1px solid var(--input-border, var(--border)); outline: none; font-size: 13px;
  }
  .toolbar label { display: flex; align-items: center; gap: 4px; cursor: pointer; user-select: none; }
  .toolbar-btn {
    padding: 3px 10px; border-radius: 3px; font-size: 12px; cursor: pointer;
    background: var(--btn-bg); color: var(--btn-fg); border: none;
  }
  .toolbar-btn:hover { background: var(--btn-hover); }
  .badge { background: var(--badge-bg); color: var(--badge-fg); border-radius: 10px; padding: 1px 7px; font-size: 11px; }
  .table-wrap { overflow: auto; border: 1px solid var(--border); border-radius: 4px; }
  table { width: 100%; border-collapse: collapse; min-width: 400px; }
  thead th {
    position: sticky; top: 0; z-index: 2;
    background: var(--header-bg); text-align: left;
    padding: 6px 10px; border-bottom: 1px solid var(--border);
    font-weight: 600; white-space: nowrap;
  }
  thead th:first-child { min-width: 220px; }
  tbody tr:hover { background: var(--row-hover); }
  td { padding: 4px 10px; border-bottom: 1px solid var(--border, #3334); vertical-align: top; max-width: 320px; word-break: break-word; }
  td.key-cell { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; white-space: nowrap; }
  td.missing { color: var(--missing-color); font-style: italic; }
  .open-btn {
    background: none; border: none; cursor: pointer; color: var(--link);
    padding: 0 3px; font-size: 11px; vertical-align: middle; opacity: 0.7;
  }
  .open-btn:hover { opacity: 1; text-decoration: underline; }
  .no-results { padding: 24px; text-align: center; opacity: 0.5; }

  /* Suggestions section */
  .suggestions-section { margin-top: 16px; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
  .suggestions-header {
    background: var(--section-bg); padding: 7px 12px;
    font-weight: 600; font-size: 12px; display: flex; align-items: center; gap: 6px;
    border-bottom: 1px solid var(--border);
  }
  .suggestions-header .icon { opacity: 0.7; }
  .suggestions-list { padding: 8px 12px; display: flex; flex-wrap: wrap; gap: 6px; }
  .suggestion-chip {
    display: inline-flex; align-items: center; gap: 5px;
    background: var(--tag-bg); color: var(--tag-fg);
    border-radius: 12px; padding: 2px 10px; font-size: 12px; cursor: default;
    border: 1px solid transparent;
  }
  .suggestion-chip:hover { border-color: var(--link); }
  .suggestion-chip button {
    background: none; border: none; cursor: pointer; color: var(--link);
    font-size: 11px; padding: 0; line-height: 1;
  }
  .suggestion-chip button:hover { text-decoration: underline; }
  .layout { display: flex; flex-direction: column; height: 100vh; padding: 12px 16px; gap: 0; overflow: hidden; }
  .layout h2 { flex-shrink: 0; }
  .layout .file-context { flex-shrink: 0; }
  .layout .toolbar { flex-shrink: 0; }
  .layout .table-wrap { flex: 1; min-height: 0; }
  .layout .suggestions-section { flex-shrink: 0; max-height: 160px; overflow-y: auto; }
</style>
</head>
<body>
<div class="layout">
<h2>i18n Key Table <span class="badge" id="count">0</span></h2>
<div class="file-context" id="fileContext" style="display:none">
  Mostrando keys de: <span id="fileName"></span>
</div>
<div class="toolbar">
  <input id="search" type="text" placeholder="Buscar key o valor..." autocomplete="off" />
  <label><input type="checkbox" id="onlyMissing" /> Solo faltantes</label>
  <button class="toolbar-btn" id="sortAllBtn" title="Ordena todas las keys de todos los locale JSON alfabéticamente">⇅ Ordenar A→Z</button>
</div>
<div class="table-wrap">
  <table id="tbl">
    <thead id="thead"></thead>
    <tbody id="tbody"></tbody>
  </table>
  <div class="no-results" id="noResults" style="display:none">Sin resultados</div>
</div>
<div class="suggestions-section" id="suggestionsSection" style="display:none">
  <div class="suggestions-header">
    <span class="icon">💡</span> Textos sin traducir detectados — click para crear key
  </div>
  <div class="suggestions-list" id="suggestionsList"></div>
</div>
</div>
<script>
  const vscode = acquireVsCodeApi();
  let _locales = [];
  let _rows = [];

  window.addEventListener('message', e => {
    if (e.data.type === 'update') {
      const { locales, rows, fileName, suggestions } = e.data.data;
      _locales = locales;
      _rows = rows;
      buildHeader();
      renderRows();
      renderFileContext(fileName);
      renderSuggestions(suggestions || []);
    }
  });

  function renderFileContext(fileName) {
    const ctx = document.getElementById('fileContext');
    const nameEl = document.getElementById('fileName');
    if (fileName) {
      nameEl.textContent = fileName;
      ctx.style.display = 'block';
    } else {
      ctx.style.display = 'none';
    }
  }

  function renderSuggestions(suggestions) {
    const section = document.getElementById('suggestionsSection');
    const list = document.getElementById('suggestionsList');
    list.innerHTML = '';
    if (!suggestions.length) { section.style.display = 'none'; return; }
    section.style.display = 'block';
    for (const text of suggestions) {
      const chip = document.createElement('span');
      chip.className = 'suggestion-chip';
      const label = document.createElement('span');
      label.textContent = text.length > 40 ? text.slice(0, 40) + '…' : text;
      label.title = text;
      const btn = document.createElement('button');
      btn.textContent = '+ crear key';
      btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'createKey', key: text });
      });
      chip.appendChild(label);
      chip.appendChild(btn);
      list.appendChild(chip);
    }
  }

  function buildHeader() {
    const thead = document.getElementById('thead');
    const tr = document.createElement('tr');
    const thKey = document.createElement('th');
    thKey.textContent = 'Key';
    tr.appendChild(thKey);
    for (const locale of _locales) {
      const th = document.createElement('th');
      th.textContent = locale.toUpperCase();
      tr.appendChild(th);
    }
    thead.innerHTML = '';
    thead.appendChild(tr);
  }

  function renderRows() {
    const search = document.getElementById('search').value.toLowerCase().trim();
    const onlyMissing = document.getElementById('onlyMissing').checked;
    const tbody = document.getElementById('tbody');
    tbody.innerHTML = '';

    let count = 0;
    for (const row of _rows) {
      const hasMissing = _locales.some(l => row.values[l] === null || row.values[l] === undefined);
      if (onlyMissing && !hasMissing) continue;

      if (search) {
        const inKey = row.key.toLowerCase().includes(search);
        const inVals = Object.values(row.values).some(v => v && String(v).toLowerCase().includes(search));
        if (!inKey && !inVals) continue;
      }

      const tr = document.createElement('tr');

      const tdKey = document.createElement('td');
      tdKey.className = 'key-cell';
      tdKey.title = row.key;
      tdKey.textContent = row.key;
      tr.appendChild(tdKey);

      for (const locale of _locales) {
        const td = document.createElement('td');
        const val = row.values[locale];
        const filePath = row.files[locale];
        if (val === null || val === undefined) {
          td.className = 'missing';
          td.textContent = '(missing)';
        } else {
          const span = document.createElement('span');
          span.textContent = String(val);
          td.appendChild(span);
          if (filePath) {
            const btn = document.createElement('button');
            btn.className = 'open-btn';
            btn.title = 'Abrir en editor';
            btn.textContent = '↗';
            btn.addEventListener('click', () => {
              vscode.postMessage({ type: 'openFile', filePath, key: row.key });
            });
            td.appendChild(btn);
          }
        }
        tr.appendChild(td);
      }

      tbody.appendChild(tr);
      count++;
    }

    document.getElementById('count').textContent = count;
    document.getElementById('noResults').style.display = count === 0 ? 'block' : 'none';
  }

  document.getElementById('search').addEventListener('input', renderRows);
  document.getElementById('onlyMissing').addEventListener('change', renderRows);
  document.getElementById('sortAllBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'sortAll' });
  });
</script>
</body>
</html>`;
}

// ─── CodeLens para locale JSON ───────────────────────────────────────────────

/**
 * Provides two CodeLens actions on the first line of any locale JSON file:
 *  1. "Ver tabla i18n"  — opens the key table
 *  2. "Ordenar keys A→Z" — sorts all keys alphabetically (with confirmation)
 * @param {vscode.TextDocument} doc
 * @returns {vscode.CodeLens[]}
 */
function provideLocaleJsonCodeLenses(doc) {
    if (!localesAbsPath || !doc.uri.fsPath.startsWith(localesAbsPath)) return [];

    const topLine = new vscode.Range(0, 0, 0, 0);
    const filePath = doc.uri.fsPath;

    const lensTable = new vscode.CodeLens(topLine, {
        title: '$(table) Ver tabla i18n',
        command: 'i18nKV.showTable',
        tooltip: 'Abrir la tabla completa de keys × idiomas',
    });

    const lensSort = new vscode.CodeLens(topLine, {
        title: '$(sort-precedence) Ordenar keys A→Z',
        command: 'i18nKV.sortLocaleFile',
        arguments: [{ filePath }],
        tooltip: 'Ordena todas las keys de este archivo JSON alfabéticamente (recursivo)',
    });

    return [lensTable, lensSort];
}

// ─── Sort locale files ────────────────────────────────────────────────────────

/**
 * Recursively sorts all keys of a plain object alphabetically.
 * @param {any} obj
 * @returns {any}
 */
function sortObjectKeys(obj) {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    return Object.keys(obj).sort().reduce((acc, key) => {
        acc[key] = sortObjectKeys(obj[key]);
        return acc;
    }, {});
}

/**
 * Collects all locale JSON file paths from the locales directory.
 * @returns {string[]}
 */
function collectAllLocaleFilePaths() {
    const files = [];
    if (!localesAbsPath || !fs.existsSync(localesAbsPath)) return files;
    const structure = localeStructure ?? detectLocaleStructure(localesAbsPath);
    try {
        if (structure === 'namespaced') {
            const localeDirs = fs.readdirSync(localesAbsPath, { withFileTypes: true })
                .filter(d => d.isDirectory()).map(d => d.name);
            for (const locale of localeDirs) {
                const localePath = path.join(localesAbsPath, locale);
                const jsonFiles = fs.readdirSync(localePath).filter(f => f.endsWith('.json'));
                for (const f of jsonFiles) files.push(path.join(localePath, f));
            }
        } else {
            const jsonFiles = fs.readdirSync(localesAbsPath, { withFileTypes: true })
                .filter(e => e.isFile() && e.name.endsWith('.json')).map(e => e.name);
            for (const f of jsonFiles) files.push(path.join(localesAbsPath, f));
        }
    } catch (_) { }
    return files;
}

/**
 * Sorts a list of files in place, rewriting each one.
 * @param {string[]} files
 */
function sortFiles(files) {
    let errors = 0;
    for (const filePath of files) {
        try {
            const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            fs.writeFileSync(filePath, JSON.stringify(sortObjectKeys(json), null, 2) + '\n', 'utf8');
        } catch (e) {
            errors++;
            vscode.window.showErrorMessage(`i18nKV: Error en "${path.basename(filePath)}": ${e.message}`);
        }
    }
    return errors;
}

/**
 * Asks the user whether to sort just this file or all locale files, then sorts accordingly.
 * @param {string} filePath
 */
async function sortLocaleFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
        vscode.window.showWarningMessage('i18nKV: Archivo no encontrado.');
        return;
    }

    const fileName = path.basename(filePath);
    const allFiles = collectAllLocaleFilePaths();
    const allNames = allFiles.map(f => path.relative(localesAbsPath, f)).join(', ');

    const choice = await vscode.window.showWarningMessage(
        `Ordenar keys alfabéticamente (recursivo en todos los niveles).\n\n¿Qué archivos quieres ordenar?`,
        { modal: true },
        `Solo "${fileName}"`,
        'Todos los locales'
    );

    if (!choice) return;

    if (choice === `Solo "${fileName}"`) {
        const errors = sortFiles([filePath]);
        loadLocaleKeys();
        if (errors === 0) vscode.window.showInformationMessage(`i18nKV: "${fileName}" ordenado ✓`);
    } else {
        if (allFiles.length === 0) {
            vscode.window.showWarningMessage('i18nKV: No se encontraron archivos de locale.');
            return;
        }
        const confirm = await vscode.window.showWarningMessage(
            `Se reescribirán ${allFiles.length} archivos:\n${allNames}`,
            { modal: true },
            'Ordenar todos'
        );
        if (confirm !== 'Ordenar todos') return;
        const errors = sortFiles(allFiles);
        loadLocaleKeys();
        if (errors === 0) vscode.window.showInformationMessage(`i18nKV: ${allFiles.length} archivos ordenados ✓`);
    }
}

/**
 * Sorts ALL locale JSON files alphabetically, with a single confirmation.
 */
async function sortAllLocaleFiles() {
    const files = collectAllLocaleFilePaths();

    if (files.length === 0) {
        vscode.window.showWarningMessage('i18nKV: No se encontraron archivos de locale.');
        return;
    }

    const fileNames = files.map(f => path.relative(localesAbsPath, f)).join(', ');
    const confirm = await vscode.window.showWarningMessage(
        `¿Ordenar keys alfabéticamente en TODOS los archivos de locale?\n\n${fileNames}`,
        { modal: true },
        'Ordenar todos'
    );
    if (confirm !== 'Ordenar todos') return;

    const errors = sortFiles(files);
    loadLocaleKeys();
    if (errors === 0) {
        vscode.window.showInformationMessage(`i18nKV: ${files.length} archivos ordenados ✓`);
    }
}

// ─── Sidebar WebviewView ──────────────────────────────────────────────────────

function sendSidebarState() {
    if (!sidebarView) return;
    const cfg = getConfig();
    const locales = Object.keys(allLocaleKeys);
    const keyCount = Object.keys(getSourceKeys()).length;
    sidebarView.webview.postMessage({ type: 'state', config: cfg, localeStructure, locales, keyCount });
}

async function saveWorkspaceSetting(key, value) {
    try {
        await vscode.workspace.getConfiguration('i18nKV').update(key, value, vscode.ConfigurationTarget.Workspace);
        sidebarView?.webview.postMessage({ type: 'settingsSaved' });
    } catch (e) {
        sidebarView?.webview.postMessage({ type: 'settingsError', message: e.message });
    }
}

async function runProjectScan() {
    if (!sidebarView) return;
    scanCancelled = false;
    lastScanLog = [];

    const startTime = Date.now();
    const log = (msg) => {
        const line = `[${new Date().toISOString()}] ${msg}`;
        lastScanLog.push(line);
        outputChannel.appendLine(line);
    };

    log('Scan started');

    let uris;
    try {
        uris = await vscode.workspace.findFiles(
            '**/*.{html,ts}',
            '{**/node_modules/**,**/.git/**,**/dist/**,**/*.spec.ts}'
        );
    } catch (e) {
        log(`findFiles error: ${e.message}`);
        throw e;
    }

    const total = uris.length;
    log(`Found ${total} files to scan`);
    sidebarView.webview.postMessage({ type: 'scanProgress', done: 0, total });

    const sourceKeys = getSourceKeys();
    const missingKeys = [];
    const plainTextByFile = {};
    const BATCH = 5;

    // Adaptive yield: starts at 20ms, adjusts based on how long each file takes.
    // Target: keep each file under 30ms of total work so the UI stays responsive.
    let yieldMs = 20;

    for (let i = 0; i < uris.length; i += BATCH) {
        if (scanCancelled) {
            log('Scan cancelled by user');
            break;
        }
        const batch = uris.slice(i, i + BATCH);
        for (const uri of batch) {
            if (scanCancelled) break;
            const fileStart = Date.now();
            try {
                const doc = await vscode.workspace.openTextDocument(uri);
                for (const { key, range } of extractI18nUsages(doc)) {
                    if (!(key in sourceKeys)) {
                        missingKeys.push({
                            key,
                            file: vscode.workspace.asRelativePath(uri),
                            line: range.start.line + 1,
                            filePath: uri.fsPath,
                        });
                    }
                }
                const suggestions = extractPlainTextSuggestions(doc);
                if (suggestions.length > 0) {
                    plainTextByFile[vscode.workspace.asRelativePath(uri)] = suggestions;
                }
            } catch (e) {
                log(`Error processing ${vscode.workspace.asRelativePath(uri)}: ${e.message}`);
            }
            // Adaptive yield: if processing took long, reduce yield; if fast, give more breathing room
            const elapsed = Date.now() - fileStart;
            yieldMs = elapsed > 30 ? Math.max(5, yieldMs - 5) : Math.min(80, yieldMs + 3);
            await new Promise(r => setTimeout(r, yieldMs));
        }
        sidebarView.webview.postMessage({ type: 'scanProgress', done: Math.min(i + BATCH, total), total });
    }

    if (!scanCancelled) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        log(`Scan complete: ${total} files, ${missingKeys.length} missing keys, ${Object.keys(plainTextByFile).length} files with plain text suggestions (${elapsed}s)`);
        sidebarView.webview.postMessage({ type: 'scanResult', missingKeys, plainTextByFile });
    }
}

function handleSidebarMessage(msg) {
    switch (msg.type) {
        case 'ready':
            sendSidebarState();
            break;
        case 'saveSetting':
            saveWorkspaceSetting(msg.key, msg.value);
            break;
        case 'scan':
            runProjectScan().catch(e => {
                sidebarView?.webview.postMessage({ type: 'scanError', message: e.message });
            });
            break;
        case 'cancelScan':
            scanCancelled = true;
            break;
        case 'openAddKeyForm': {
            // msg.text = suggested plain text, open the add-key form in sidebar
            const cfg = getConfig();
            const locs = sortedLocales();
            sidebarView?.webview.postMessage({
                type: 'openAddKeyForm',
                text: msg.text,
                sourceLocale: cfg.sourceLocale,
                locales: locs,
            });
            break;
        }
        case 'createKeyWithTranslations':
            createKeyWithTranslations(msg.key, msg.translations);
            break;
        case 'createKey':
            createKeyInAllLocales(msg.key);
            break;
        case 'openFile':
            vscode.commands.executeCommand('i18nKV.openLocaleFile', { filePath: msg.filePath, key: msg.key });
            break;
        case 'openGithubIssue':
            vscode.env.openExternal(vscode.Uri.parse(msg.url));
            break;
        case 'getEditorContext': {
            const editor = vscode.window.activeTextEditor;
            const selectedText = editor?.document.getText(editor.selection) ?? '';
            const file = editor ? vscode.workspace.asRelativePath(editor.document.uri) : '';
            const line = editor ? (editor.selection.start.line + 1) : 0;
            const snippet = editor ? editor.document.lineAt(editor.selection.start.line).text.trim() : '';
            const scanLogs = lastScanLog.slice(-30).join('\n'); // last 30 log lines
            sidebarView?.webview.postMessage({ type: 'editorContext', selectedText, file, line, snippet, scanLogs });
            break;
        }
    }
}

const sidebarViewProvider = {
    resolveWebviewView(webviewView) {
        sidebarView = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = getSidebarHtml();
        setTimeout(() => sendSidebarState(), 300);
        webviewView.webview.onDidReceiveMessage(handleSidebarMessage);
        webviewView.onDidChangeVisibility(() => { if (webviewView.visible) sendSidebarState(); });
        webviewView.onDidDispose(() => { sidebarView = undefined; });
    }
};

function getSidebarHtml() {
    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>i18n Studio Pro</title>
<style>
  :root {
    --bg: var(--vscode-sideBar-background);
    --fg: var(--vscode-sideBar-foreground, var(--vscode-editor-foreground));
    --border: var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border, #3334));
    --header-bg: var(--vscode-sideBarSectionHeader-background);
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --btn-hover: var(--vscode-button-hoverBackground);
    --btn2-bg: var(--vscode-button-secondaryBackground);
    --btn2-fg: var(--vscode-button-secondaryForeground);
    --btn2-hover: var(--vscode-button-secondaryHoverBackground);
    --input-bg: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --input-border: var(--vscode-input-border, #3334);
    --link: var(--vscode-textLink-foreground);
    --warn: var(--vscode-editorWarning-foreground, #e8a400);
    --success: var(--vscode-testing-iconPassed, #4caf50);
    --badge-bg: var(--vscode-badge-background);
    --badge-fg: var(--vscode-badge-foreground);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--fg); font-family: var(--vscode-font-family); font-size: 13px; }

  .section { border-bottom: 1px solid var(--border); }
  .section-header {
    display: flex; align-items: center; gap: 6px;
    padding: 7px 12px; cursor: pointer; user-select: none;
    background: var(--header-bg);
    font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
  }
  .section-header:hover { filter: brightness(1.1); }
  .section-header .chevron { margin-left: auto; font-size: 10px; }
  .section-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
  .section-body.hidden { display: none; }

  label { font-size: 11px; opacity: .7; display: block; margin-bottom: 2px; }
  input[type="text"], select, textarea {
    width: 100%; padding: 4px 8px;
    background: var(--input-bg); color: var(--input-fg);
    border: 1px solid var(--input-border); border-radius: 3px;
    font-size: 12px; font-family: inherit; outline: none;
  }
  textarea { resize: vertical; min-height: 60px; }

  .row { display: flex; gap: 4px; align-items: center; }
  .row input { flex: 1; }

  button {
    width: 100%; padding: 5px 10px; border: none; border-radius: 3px;
    font-size: 12px; cursor: pointer; font-family: inherit;
    background: var(--btn-bg); color: var(--btn-fg);
  }
  button:hover { background: var(--btn-hover); }
  button.secondary { background: var(--btn2-bg); color: var(--btn2-fg); }
  button.secondary:hover { background: var(--btn2-hover); }
  button.small { width: auto; padding: 3px 8px; font-size: 11px; }
  button:disabled { opacity: .5; cursor: default; }

  .info-row { font-size: 11px; opacity: .7; display: flex; justify-content: space-between; }
  .badge { background: var(--badge-bg); color: var(--badge-fg); border-radius: 10px; padding: 1px 7px; font-size: 10px; }

  .progress-wrap { display: none; flex-direction: column; gap: 4px; }
  .progress-bar { height: 4px; background: var(--input-bg); border-radius: 2px; overflow: hidden; }
  .progress-fill { height: 100%; width: 0; background: var(--btn-bg); transition: width .1s; }
  .progress-text { font-size: 11px; opacity: .7; text-align: center; }

  details { font-size: 12px; }
  details summary { cursor: pointer; padding: 4px 0; user-select: none; list-style: none; display: flex; align-items: center; gap: 4px; }
  details summary::-webkit-details-marker { display: none; }
  details summary::before { content: '▸'; font-size: 10px; transition: transform .15s; }
  details[open] summary::before { content: '▾'; }
  details summary:hover { color: var(--link); }

  .missing-list { list-style: none; max-height: 220px; overflow-y: auto; margin-top: 4px; }
  .missing-item { padding: 4px 0; border-bottom: 1px solid var(--border); font-size: 11px; display: flex; flex-direction: column; gap: 2px; }
  .missing-item code { font-family: var(--vscode-editor-font-family, monospace); color: var(--warn); }
  .missing-item .loc { opacity: .6; font-size: 10px; display: flex; align-items: center; justify-content: space-between; }
  .missing-item .loc a { color: var(--link); cursor: pointer; text-decoration: none; }
  .missing-item .loc a:hover { text-decoration: underline; }

  .plain-file { font-size: 11px; margin-bottom: 4px; }
  .plain-file .fname { font-weight: 600; opacity: .8; }
  .chip-wrap { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
  .chip { background: var(--badge-bg); color: var(--badge-fg); border-radius: 10px; padding: 1px 8px; font-size: 11px; display: flex; align-items: center; gap: 4px; }
  .chip button { width: auto; padding: 0 3px; font-size: 10px; background: none; color: var(--link); }
  .chip button:hover { background: none; text-decoration: underline; }

  .code-block { background: var(--input-bg); border-radius: 3px; padding: 6px 8px; font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; word-break: break-all; white-space: pre-wrap; }

  /* Add i18n Key form */
  .locale-row { display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px; }
  .locale-row label { font-size: 11px; font-weight: 600; opacity: .75; display: flex; align-items: center; gap: 6px; }
  .locale-flag { font-size: 13px; }
  .locale-input-wrap { display: flex; gap: 4px; }
  .locale-input-wrap input { flex: 1; }
  .translate-btn { white-space: nowrap; font-size: 10px; padding: 2px 7px; width: auto; display: flex; align-items: center; gap: 4px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .translate-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .translate-btn.loading { opacity: .6; pointer-events: none; }
  .source-locale-row label { color: var(--vscode-terminal-ansiCyan); }
  .source-locale-row label::after { content: ' (source)'; font-size: 10px; opacity: .6; }

  .flash { font-size: 11px; color: var(--success); animation: fadeout 2s forwards; }
  @keyframes fadeout { 0%{opacity:1} 70%{opacity:1} 100%{opacity:0} }

  .scan-stats { display: flex; gap: 8px; flex-wrap: wrap; }
  .stat-box { flex: 1; background: var(--input-bg); border-radius: 4px; padding: 6px 10px; text-align: center; }
  .stat-box .num { font-size: 20px; font-weight: 700; color: var(--warn); }
  .stat-box .lbl { font-size: 10px; opacity: .7; }
  .stat-box.ok .num { color: var(--success); }
</style>
</head>
<body>

<!-- ── Section 1: Configuration ── -->
<div class="section" id="s-config">
  <div class="section-header" onclick="toggleSection('s-config')">
    ⚙ Configuration <span class="chevron">▾</span>
  </div>
  <div class="section-body" id="s-config-body">
    <div>
      <label>Locales Path</label>
      <div class="row">
        <input type="text" id="cfgLocalesPath" placeholder="src/assets/i18n" />
        <button class="small" id="saveLocalesPath">✓</button>
      </div>
    </div>
    <div>
      <label>Source Locale</label>
      <div class="row">
        <input type="text" id="cfgSourceLocale" placeholder="es" />
        <button class="small" id="saveSourceLocale">✓</button>
      </div>
    </div>
    <div>
      <label>Severity</label>
      <select id="cfgSeverity">
        <option value="error">Error</option>
        <option value="warning">Warning</option>
        <option value="info">Info</option>
      </select>
    </div>
    <div class="info-row"><span>Structure</span><span id="structureVal">—</span></div>
    <div class="info-row"><span>Locales loaded</span><span id="localesVal">—</span></div>
    <div class="info-row"><span>Keys (source)</span><span id="keysVal">—</span></div>
    <div id="savedFlash" style="display:none" class="flash">Settings saved ✓</div>
    <div id="unsupportedWrap" style="display:none">
      <button class="secondary" id="requestSupportBtn">Request structure support on GitHub</button>
    </div>
  </div>
</div>

<!-- ── Section 2: Project Scan ── -->
<div class="section" id="s-scan">
  <div class="section-header" onclick="toggleSection('s-scan')">
    🔍 Project Scan <span class="chevron">▾</span>
  </div>
  <div class="section-body" id="s-scan-body">
    <div style="display:flex;gap:6px">
      <button id="scanBtn">Scan project</button>
      <button class="secondary small" id="cancelScanBtn" style="display:none">Cancel</button>
      <button class="secondary small" id="clearScanBtn" style="display:none" title="Clear results">✕ Clear</button>
    </div>
    <div class="progress-wrap" id="progressWrap">
      <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
      <div class="progress-text" id="progressText">0 / 0 files</div>
    </div>
    <div id="scanResults" style="display:none">
      <div class="scan-stats" id="scanStats"></div>
      <details id="detMissing" style="margin-top:8px">
        <summary>Missing keys <span class="badge" id="badgeMissing">0</span></summary>
        <ul class="missing-list" id="missingList"></ul>
      </details>
      <details id="detPlain" style="margin-top:6px">
        <summary>Plain text suggestions <span class="badge" id="badgePlain">0</span></summary>
        <div id="plainList" style="margin-top:6px"></div>
      </details>
    </div>
  </div>
</div>

<!-- ── Section 2b: Add i18n Key ── -->
<div class="section" id="s-addkey">
  <div class="section-header" onclick="toggleSection('s-addkey')">
    ✚ Add i18n Key <span class="chevron">▾</span>
  </div>
  <div class="section-body hidden" id="s-addkey-body">
    <div>
      <label>Key <span style="font-size:10px;opacity:.6">(dot notation, e.g. common.save)</span></label>
      <input type="text" id="addKeyName" placeholder="common.save" />
    </div>
    <div id="addKeyLocalesWrap"></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
      <button id="addKeyTranslateAllBtn" class="secondary small">⚡ Translate All</button>
      <button id="addKeyCreateBtn">✓ Create Key</button>
      <button class="secondary small" id="addKeyCancelBtn">Cancel</button>
    </div>
    <div id="addKeyFeedback" style="display:none;margin-top:6px;font-size:11px;color:var(--vscode-terminal-ansiGreen)"></div>
  </div>
</div>

<!-- ── Section 3: Report Issue ── -->
<div class="section" id="s-report">
  <div class="section-header" onclick="toggleSection('s-report')">
    🐛 Report Issue <span class="chevron">▾</span>
  </div>
  <div class="section-body" id="s-report-body">
    <div>
      <label>Type</label>
      <select id="reportType">
        <option value="false-positive">False Positive</option>
        <option value="bug">Bug</option>
        <option value="feature">Feature Request</option>
        <option value="structure">Unsupported Structure</option>
      </select>
    </div>
    <div>
      <label>Description</label>
      <textarea id="reportDesc" maxlength="500" placeholder="Describe the issue or false positive..."></textarea>
    </div>
    <button class="secondary" id="fetchContextBtn">Use active editor context</button>
    <div id="contextWrap" style="display:none">
      <label>Context (auto-filled)</label>
      <div class="code-block" id="contextBlock"></div>
    </div>
    <div id="logsWrap" style="display:none">
      <label>Scan Logs (auto-filled)</label>
      <div class="code-block" id="logsBlock" style="max-height:120px;overflow-y:auto;font-size:10px"></div>
    </div>
    <button id="submitReportBtn">Open GitHub Issue ↗</button>
  </div>
</div>

<script>
(function() {
  const vscode = acquireVsCodeApi();

  // ── Section collapse ──────────────────────────────────────────────────────
  const collapsedSections = {};
  function toggleSection(id) {
    const body = document.getElementById(id + '-body');
    const chevron = document.querySelector('#' + id + ' .chevron');
    collapsedSections[id] = !collapsedSections[id];
    body.classList.toggle('hidden', collapsedSections[id]);
    chevron.textContent = collapsedSections[id] ? '▸' : '▾';
  }
  function openSection(id) {
    const body = document.getElementById(id + '-body');
    const chevron = document.querySelector('#' + id + ' .chevron');
    collapsedSections[id] = false;
    body.classList.remove('hidden');
    if (chevron) chevron.textContent = '▾';
  }
  window.toggleSection = toggleSection;

  // ── Message bus ──────────────────────────────────────────────────────────
  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'state')          applyState(msg);
    if (msg.type === 'scanProgress')   applyProgress(msg);
    if (msg.type === 'scanResult')     { applyResult(msg); document.getElementById('clearScanBtn').style.display = 'inline-flex'; }
    if (msg.type === 'scanError')      { resetScanUI(); alert('Scan error: ' + msg.message); }
    if (msg.type === 'settingsSaved')  flashSaved();
    if (msg.type === 'editorContext')  applyContext(msg);
    if (msg.type === 'openAddKeyForm') { buildAddKeyForm(msg); openSection('s-addkey'); document.getElementById('s-addkey').scrollIntoView({ behavior: 'smooth' }); }
    if (msg.type === 'keyCreated')     {
      const fb = document.getElementById('addKeyFeedback');
      fb.textContent = '✓ Key "' + escHtml(msg.key) + '" created!';
      fb.style.display = 'block';
      setTimeout(() => { fb.style.display = 'none'; }, 3000);
    }
  });

  document.addEventListener('DOMContentLoaded', () => vscode.postMessage({ type: 'ready' }));

  // ── Section 1: Configuration ─────────────────────────────────────────────
  function applyState({ config, localeStructure, locales, keyCount }) {
    document.getElementById('cfgLocalesPath').value = config.localesPath;
    document.getElementById('cfgSourceLocale').value = config.sourceLocale;
    document.getElementById('cfgSeverity').value = config.severity;
    document.getElementById('structureVal').textContent = localeStructure ?? 'not detected';
    document.getElementById('localesVal').textContent = locales.length + ' — ' + locales.join(', ');
    document.getElementById('keysVal').textContent = keyCount;
    const unsupported = !localeStructure;
    document.getElementById('unsupportedWrap').style.display = unsupported ? 'block' : 'none';
  }

  function flashSaved() {
    const el = document.getElementById('savedFlash');
    el.style.display = 'block';
    el.style.animation = 'none';
    setTimeout(() => { el.style.animation = ''; el.style.display = 'none'; setTimeout(() => el.style.display = 'block', 10); }, 10);
    setTimeout(() => el.style.display = 'none', 2200);
  }

  document.getElementById('saveLocalesPath').addEventListener('click', () => {
    vscode.postMessage({ type: 'saveSetting', key: 'localesPath', value: document.getElementById('cfgLocalesPath').value.trim() });
  });
  document.getElementById('saveSourceLocale').addEventListener('click', () => {
    vscode.postMessage({ type: 'saveSetting', key: 'sourceLocale', value: document.getElementById('cfgSourceLocale').value.trim() });
  });
  document.getElementById('cfgSeverity').addEventListener('change', e => {
    vscode.postMessage({ type: 'saveSetting', key: 'severity', value: e.target.value });
  });
  document.getElementById('requestSupportBtn').addEventListener('click', () => {
    const url = 'https://github.com/RamiroRepos/i18n-Studio-Pro-VSExtension/issues/new'
      + '?labels=structure-support&title=' + encodeURIComponent('[Structure] Support request: <describe your structure>');
    vscode.postMessage({ type: 'openGithubIssue', url });
  });

  // ── Section 2: Scan ──────────────────────────────────────────────────────
  function applyProgress({ done, total }) {
    document.getElementById('progressWrap').style.display = 'flex';
    document.getElementById('cancelScanBtn').style.display = 'inline-block';
    document.getElementById('scanBtn').disabled = true;
    document.getElementById('progressFill').style.width = total ? ((done / total) * 100) + '%' : '0%';
    document.getElementById('progressText').textContent = done + ' / ' + total + ' files';
  }

  function resetScanUI() {
    document.getElementById('progressWrap').style.display = 'none';
    document.getElementById('cancelScanBtn').style.display = 'none';
    document.getElementById('scanBtn').disabled = false;
  }

  function applyResult({ missingKeys, plainTextByFile }) {
    resetScanUI();
    document.getElementById('scanResults').style.display = 'block';

    const fileCount = new Set(missingKeys.map(m => m.file)).size;
    const ptCount = Object.keys(plainTextByFile).length;

    const statsEl = document.getElementById('scanStats');
    statsEl.innerHTML = '';
    const addStat = (num, lbl, ok) => {
      const div = document.createElement('div');
      div.className = 'stat-box' + (ok ? ' ok' : '');
      div.innerHTML = '<div class="num">' + num + '</div><div class="lbl">' + lbl + '</div>';
      statsEl.appendChild(div);
    };
    addStat(missingKeys.length, 'missing keys', missingKeys.length === 0);
    addStat(fileCount, 'files affected', fileCount === 0);
    addStat(ptCount, 'untranslated', ptCount === 0);

    document.getElementById('badgeMissing').textContent = missingKeys.length;
    const list = document.getElementById('missingList');
    list.innerHTML = '';
    for (const item of missingKeys) {
      const li = document.createElement('li');
      li.className = 'missing-item';
      li.innerHTML = '<code>' + escHtml(item.key) + '</code>'
        + '<div class="loc"><span>' + escHtml(item.file) + ':' + item.line + '</span>'
        + '<a data-fp="' + escHtml(item.filePath) + '" data-key="' + escHtml(item.key) + '">↗ open</a></div>';
      li.querySelector('a').addEventListener('click', ev => {
        vscode.postMessage({ type: 'openFile', filePath: ev.currentTarget.dataset.fp, key: ev.currentTarget.dataset.key });
      });
      list.appendChild(li);
    }
    if (missingKeys.length > 0) document.getElementById('detMissing').open = true;

    const ptEntries = Object.entries(plainTextByFile);
    document.getElementById('badgePlain').textContent = ptEntries.length;
    const ptList = document.getElementById('plainList');
    ptList.innerHTML = '';
    for (const [file, texts] of ptEntries) {
      const div = document.createElement('div');
      div.className = 'plain-file';
      div.innerHTML = '<div class="fname">' + escHtml(file) + '</div>';
      const chips = document.createElement('div');
      chips.className = 'chip-wrap';
      for (const text of texts.slice(0, 8)) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        const label = document.createElement('span');
        label.textContent = text.length > 30 ? text.slice(0, 30) + '…' : text;
        label.title = text;
        const btn = document.createElement('button');
        btn.textContent = '+ key';
        btn.addEventListener('click', () => {
          vscode.postMessage({ type: 'openAddKeyForm', text });
          // scroll to add-key section
          document.getElementById('s-addkey').scrollIntoView({ behavior: 'smooth' });
          openSection('s-addkey');
        });
        chip.appendChild(label);
        chip.appendChild(btn);
        chips.appendChild(chip);
      }
      div.appendChild(chips);
      ptList.appendChild(div);
    }
  }

  document.getElementById('scanBtn').addEventListener('click', () => {
    document.getElementById('scanResults').style.display = 'none';
    document.getElementById('clearScanBtn').style.display = 'none';
    vscode.postMessage({ type: 'scan' });
  });
  document.getElementById('cancelScanBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'cancelScan' });
    resetScanUI();
  });
  document.getElementById('clearScanBtn').addEventListener('click', () => {
    document.getElementById('scanResults').style.display = 'none';
    document.getElementById('clearScanBtn').style.display = 'none';
    document.getElementById('progressWrap').style.display = 'none';
  });

  // ── Section 2b: Add i18n Key ─────────────────────────────────────────────
  let _addKeyLocales = [];
  let _addKeySource = '';

  function buildAddKeyForm({ text, sourceLocale, locales }) {
    _addKeyLocales = locales;
    _addKeySource = sourceLocale;

    // Auto-suggest key name from text: lowercase, replace spaces with dots
    const suggested = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .replace(/\\s+/g, '.')
      .slice(0, 40);
    document.getElementById('addKeyName').value = suggested;

    const wrap = document.getElementById('addKeyLocalesWrap');
    wrap.innerHTML = '';

    for (const locale of locales) {
      const isSource = locale === sourceLocale;
      const row = document.createElement('div');
      row.className = 'locale-row' + (isSource ? ' source-locale-row' : '');

      const lbl = document.createElement('label');
      lbl.innerHTML = '<span class="locale-flag">' + getLocaleFlag(locale) + '</span> ' + escHtml(locale.toUpperCase());
      row.appendChild(lbl);

      const inputWrap = document.createElement('div');
      inputWrap.className = 'locale-input-wrap';

      const input = document.createElement('input');
      input.type = 'text';
      input.id = 'addkey-locale-' + locale;
      input.placeholder = isSource ? text : 'Translation...';
      if (isSource) input.value = text;
      inputWrap.appendChild(input);

      if (!isSource) {
        const btn = document.createElement('button');
        btn.className = 'translate-btn';
        btn.innerHTML = '⚡ Translate';
        btn.title = 'Auto-translate from ' + sourceLocale;
        btn.addEventListener('click', async () => {
          const srcVal = document.getElementById('addkey-locale-' + sourceLocale)?.value.trim();
          if (!srcVal) { input.placeholder = 'Fill source locale first'; return; }
          btn.classList.add('loading');
          btn.innerHTML = '⏳ ...';
          try {
            const translated = await translateText(srcVal, sourceLocale, locale);
            input.value = translated;
          } catch (e) {
            input.placeholder = 'Translation failed';
          } finally {
            btn.classList.remove('loading');
            btn.innerHTML = '⚡ Translate';
          }
        });
        inputWrap.appendChild(btn);
      }

      row.appendChild(inputWrap);
      wrap.appendChild(row);
    }
    document.getElementById('addKeyFeedback').style.display = 'none';
  }

  async function translateText(text, fromLang, toLang) {
    // Normalize lang codes: 'es' stays 'es', 'pt' → 'pt', 'zh-CN' etc.
    const normFrom = fromLang.split('-')[0];
    const normTo = toLang.split('-')[0];
    const url = 'https://api.mymemory.translated.net/get?q='
      + encodeURIComponent(text)
      + '&langpair=' + normFrom + '|' + normTo;
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.responseStatus !== 200) throw new Error(data.responseDetails);
    return data.responseData.translatedText;
  }

  function getLocaleFlag(locale) {
    const map = { en: '🇺🇸', es: '🇪🇸', fr: '🇫🇷', de: '🇩🇪', pt: '🇧🇷', it: '🇮🇹', nl: '🇳🇱', ja: '🇯🇵', zh: '🇨🇳', ko: '🇰🇷', ru: '🇷🇺', ar: '🇸🇦', pl: '🇵🇱', tr: '🇹🇷', sv: '🇸🇪', da: '🇩🇰', fi: '🇫🇮', nb: '🇳🇴', uk: '🇺🇦', cs: '🇨🇿', hu: '🇭🇺', ro: '🇷🇴' };
    return map[locale.split('-')[0]] || '🌐';
  }

  document.getElementById('addKeyTranslateAllBtn').addEventListener('click', async () => {
    const srcVal = document.getElementById('addkey-locale-' + _addKeySource)?.value.trim();
    if (!srcVal) {
      document.getElementById('addkey-locale-' + _addKeySource)?.focus();
      return;
    }
    const btn = document.getElementById('addKeyTranslateAllBtn');
    btn.classList.add('loading');
    btn.textContent = '⏳ Translating...';
    const nonSource = _addKeyLocales.filter(l => l !== _addKeySource);
    await Promise.allSettled(nonSource.map(async locale => {
      const input = document.getElementById('addkey-locale-' + locale);
      if (!input) return;
      try {
        input.value = await translateText(srcVal, _addKeySource, locale);
      } catch (_) {
        input.placeholder = 'Translation failed';
      }
    }));
    btn.classList.remove('loading');
    btn.innerHTML = '⚡ Translate All';
  });

  document.getElementById('addKeyCreateBtn').addEventListener('click', () => {
    const key = document.getElementById('addKeyName').value.trim();
    if (!key) { document.getElementById('addKeyName').focus(); return; }
    const translations = {};
    for (const locale of _addKeyLocales) {
      translations[locale] = document.getElementById('addkey-locale-' + locale)?.value.trim() || '';
    }
    vscode.postMessage({ type: 'createKeyWithTranslations', key, translations });
  });

  document.getElementById('addKeyCancelBtn').addEventListener('click', () => {
    toggleSection('s-addkey');
  });

  // ── Section 3: Report Issue ──────────────────────────────────────────────
  document.getElementById('fetchContextBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'getEditorContext' });
  });

  let _scanLogs = '';

  function applyContext({ selectedText, file, line, snippet, scanLogs }) {
    const parts = [];
    if (file) parts.push('File: ' + file + (line ? ':' + line : ''));
    if (snippet) parts.push('Line: ' + snippet);
    if (selectedText) parts.push('Selected: ' + selectedText);
    const ctx = parts.join('\\n');
    document.getElementById('contextBlock').textContent = ctx;
    document.getElementById('contextWrap').style.display = 'block';
    _scanLogs = scanLogs || '';
    if (_scanLogs) {
      const logsWrap = document.getElementById('logsWrap');
      if (logsWrap) {
        document.getElementById('logsBlock').textContent = _scanLogs;
        logsWrap.style.display = 'block';
      }
    }
  }

  document.getElementById('submitReportBtn').addEventListener('click', () => {
    const type = document.getElementById('reportType').value;
    const desc = document.getElementById('reportDesc').value.trim();
    const ctx = document.getElementById('contextBlock').textContent;
    const labelMap = { 'false-positive': 'false-positive', 'bug': 'bug', 'feature': 'enhancement', 'structure': 'structure-support' };
    const titleMap = { 'false-positive': '[False Positive] ', 'bug': '[Bug] ', 'feature': '[Feature] ', 'structure': '[Structure] ' };
    let body = desc;
    if (ctx) body += '\\n\\n**Context:**\\n\`\`\`\\n' + ctx + '\\n\`\`\`';
    if (_scanLogs) body += '\\n\\n**Scan Logs:**\\n\`\`\`\\n' + _scanLogs + '\\n\`\`\`';
    const url = 'https://github.com/RamiroRepos/i18n-Studio-Pro-VSExtension/issues/new'
      + '?labels=' + encodeURIComponent(labelMap[type])
      + '&title=' + encodeURIComponent(titleMap[type])
      + '&body=' + encodeURIComponent(body.slice(0, 4000));
    vscode.postMessage({ type: 'openGithubIssue', url });
  });

  function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
})();
</script>
</body>
</html>`;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { activate, deactivate };
