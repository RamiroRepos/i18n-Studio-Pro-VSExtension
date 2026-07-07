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
            if (e.affectsConfiguration('i18nKV')) { loadLocaleKeys(); revalidateAll(); refreshAllDecorations(); }
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

    // ── Providers ─────────────────────────────────────────────────────────────

    const langs = [{ language: 'html' }, { language: 'typescript' }];

    context.subscriptions.push(
        vscode.languages.registerHoverProvider(langs, { provideHover }),
        vscode.languages.registerCompletionItemProvider(langs, { provideCompletionItems }, "'", '"', '.'),
        vscode.languages.registerCodeActionsProvider(langs, { provideCodeActions }, {
            providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
        }),
        vscode.languages.registerDefinitionProvider(langs, { provideDefinition }),
        vscode.languages.registerHoverProvider({ language: 'json' }, { provideHover: provideLocaleJsonHover })
    );
}

function deactivate() {}

// ─── Config ───────────────────────────────────────────────────────────────────

function getConfig() {
    const cfg = vscode.workspace.getConfiguration('i18nKV');
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
</script>
</body>
</html>`;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { activate, deactivate };
