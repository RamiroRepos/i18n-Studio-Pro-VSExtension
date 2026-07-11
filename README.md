# i18n Studio Pro

[![Report a Bug](https://img.shields.io/badge/Report%20a%20bug-GitHub%20Issues-red?style=flat-square&logo=github)](https://github.com/RamiroRepos/i18n-Studio-Pro-VSExtension/issues/new?labels=bug&template=bug_report.md&title=[Bug]+)
[![Request Feature](https://img.shields.io/badge/Request%20feature-GitHub%20Issues-blue?style=flat-square&logo=github)](https://github.com/RamiroRepos/i18n-Studio-Pro-VSExtension/issues/new?labels=enhancement&title=[Feature]+)

A full-featured i18n management suite for VS Code. Real-time validation, inline translations, key table, hover across locales, CodeLens, sort keys, and plain-text detection. Supports ngx-translate and similar setups.

Supports two file structures:

- **Namespaced:** `src/assets/i18n/{locale}/{namespace}.json`
- **Flat:** `src/assets/i18n/{locale}.json` (e.g. `en.json`, `es.json` — auto-detected)

**Version: 2.3.1**

**Found a bug or false positive?** [Open an issue on GitHub](https://github.com/RamiroRepos/i18n-Studio-Pro-VSExtension/issues/new) — or use the **🐛 Report Issue** section inside the extension sidebar.

---

## Feature Overview

| Feature | Where | Description |
|---|---|---|
| **Real-time Validation** | HTML / TS | Flags keys missing in the source **or** incomplete in any locale — stays until 100% translated |
| **Inline Decorations** | HTML / TS | Shows the translated value in gray italic next to each key |
| **Smart Hover** | HTML / TS | Hover a key to see all locale translations, file links, and an ✎ _Abrir en formulario_ button |
| **Hover in JSON** | Locale JSON | Hover a key to see its value in every other language, plus the ✎ _Abrir en formulario_ button |
| **Edit key from hover** | Hover | ✎ button opens the sidebar form loaded with the key and all its current translations |
| **Ctrl+Click (HTML/TS)** | HTML / TS | Jump to the source locale JSON at the exact key line |
| **IntelliSense** | HTML / TS | Autocompletes i18n keys inside `\| translate` and `translate.instant()` |
| **Quick Fix** | HTML / TS | 💡 Creates a missing key in all locale files simultaneously |
| **i18n Key Table** | Panel | Full key × locale table with search, missing filter and ↗ file links |
| **Create missing from table** | Table | ✚ button on any missing cell opens the sidebar form prefilled for that key |
| **Refresh table** | Table | ⟳ button reloads keys from disk when JSON is edited outside the extension |
| **Locale navigation in JSON** | Locale JSON | Ctrl+Click on a key cycles to the same key in the next locale (creates it empty if missing) |
| **Table for file** | Toolbar 🌐 | Opens the table filtered to the keys used in the active file |
| **Plain text detection** | Table / Sidebar | Detects untranslated plain text in HTML and suggests creating keys |
| **CodeLens in JSON** | Locale JSON | First-line actions: open table and sort keys A→Z |
| **Sort keys A→Z** | JSON / Table | Sorts keys alphabetically and recursively — one file or all locales |
| **Sidebar panel** | Activity Bar | Configuration UI, full project scan, and GitHub issue reporter |
| **Project Scan** | Sidebar | Scans all HTML/TS files, lists missing keys and untranslated text |
| **Config UI** | Sidebar | Edit `localesPath`, `sourceLocale`, `severity` without touching JSON |
| **Add i18n Key form** | Sidebar | Create a new key with per-locale inputs and auto-translate |
| **Auto-translate** | Sidebar | Fills translations via MyMemory API — one locale or all at once |
| **Report Issue** | Sidebar | Opens a pre-filled GitHub issue with editor context and scan logs |

---

## Features

### Real-time Validation

Detects all i18n keys used in HTML templates and TypeScript files, and keeps them flagged until they are **100% translated across every locale**:

- **Missing key** — the key does not exist in the source locale. Quick Fix: _Crear key en todos los locales_.
- **Incomplete key** — the key exists in the source but is **missing or empty** in one or more other locales. The diagnostic lists exactly which locales are missing (e.g. _missing/empty in: en, fr_) and stays visible until every locale has a non-empty value. Quick Fix: _Completar traducciones_ opens the sidebar form prefilled with the existing translations and focus on the first missing locale.

The marker only disappears once the key is present and non-empty in **all** locales. Automatically updates when locale JSON files are edited.

> 📸 _Screenshot: missing key underlined with diagnostic message_ — proximamente

### Inline Decorations

Shows the translation text in **gray italic** next to each key, directly in the editor. Always visible without hovering. Updates when switching tabs or modifying JSON files.

> 📸 _Screenshot: inline decoration showing translated value next to key_ — proximamente

### Smart Hover — HTML & TypeScript

Hover over any i18n key to see its translations across all available locales. Fixed order: **ES first, EN second**, rest alphabetical. Each locale includes a link that opens the JSON file at the exact key line, and an **✎ Abrir en formulario** button that opens the sidebar form loaded with that key and all its translations.

![Hover with translations across all locales](https://i.imgur.com/tewZzRx.png)
_Hover showing translations for ES, EN and FR with direct links to each locale file_

### Hover in Locale JSON files

When editing a `.json` locale file, hover over any key to see its translations in **all other languages**. Each entry shows a direct link to open that locale at the exact key line, plus an **✎ Abrir en formulario** button to edit all translations from the sidebar. Works for both flat and namespaced structures.

> 📸 _Screenshot: hover on JSON key showing translations in EN, FR_ — proximamente

### Quick Fix — Create key in all locales

When a key is marked as missing, the VS Code 💡 lightbulb appears. The action writes the missing key to **all locale JSON files simultaneously**. Prompts for the source locale value; other locales get a `[LOCALE] value` placeholder.

![Missing key error with Quick Fix](https://i.imgur.com/SvGLN2x.png)
_Missing key with Quick Fix available_

### Ctrl+Click — Go to Source (HTML / TS)

`Ctrl+Click` on any i18n key in an HTML template or TypeScript file opens the source locale JSON at the exact line where the key is defined.

> 📸 _Screenshot: Ctrl+Click navigating to JSON file at key line_ — proximamente

### Autocompletion (IntelliSense)

Suggests all available keys from the source locale when typing inside a `| translate` or `translate.instant()` context. Shows the translation as detail in the suggestion menu. Works in HTML templates and TypeScript files.

> 📸 _Screenshot: IntelliSense dropdown showing key suggestions with translations_ — proximamente

### i18n Key Table — full overview

Opens a **table panel** showing all keys as rows and each locale as a column. Features:

- Filter by key name or translation value in real time
- Toggle **Solo faltantes** to see only keys missing in at least one locale
- Click `↗` on any cell to jump directly to that key in the locale JSON file
- Missing cells show a **✚ crear** button that opens the sidebar **Add i18n Key** form, prefilled with the key, any existing translations, and focus on the missing locale
- Button **⟳ Refrescar** to reload keys from disk — use it when a JSON file was edited outside the extension and the table did not pick up the change
- Button **⇅ Ordenar A→Z** to sort all locale files alphabetically (with confirmation)
- An in-panel toast confirms the result of sort and refresh actions
- Table auto-refreshes when keys are created or locale JSON files change

> 📸 _Screenshot: table panel with key rows, locale columns, missing cells highlighted_ — proximamente

### i18n Table for current file — toolbar button

A **🌐 globe icon** appears in the editor toolbar when viewing an `.html` or `.ts` file. Clicking it opens the table **filtered to the keys used in that file only**. Below the table, a **💡 Textos sin traducir** section detects plain text in the HTML (tag content, `placeholder`, `title`, `aria-label` attributes) that has no `| translate` — each shows a **+ crear key** button.

> 📸 _Screenshot: globe button in editor toolbar, table filtered to file keys_ — proximamente

> 📸 _Screenshot: "Textos sin traducir" section with plain text chips and "+ crear key" buttons_ — proximamente

### Add i18n Key — sidebar form

The **✚ Add i18n Key** section in the sidebar is a full form to create **or edit** a key across all locales:

- **Key field** — dot-notation (e.g. `common.save`). **Locked (read-only) by default** with a 🔒 / ✏️ toggle; click it to rename the key when you really need to. This prevents accidental edits when you opened the form just to complete translations.
- **Per-locale inputs** — one input per detected locale, each labeled with a flag emoji. Existing translations are pre-filled when editing.
- **⚡ Translate** — auto-translates that locale from the source locale using the MyMemory API (no API key required).
- **⚡ Translate All** — translates every non-source locale from the **source locale (`es` by default)** and shows a **before → after diff panel**. Nothing is applied until you press **✓ Confirmar todo**; **✕ Cancelar** discards the proposal so your current values stay untouched.
- **✓ Create Key** — writes the key to all locale JSON files simultaneously (upsert — also used to save edits).

The form opens pre-filled from three places: a plain-text suggestion chip (key + source value), the ✚ crear button on a missing table cell (key + existing translations, focus on the missing locale), and the ✎ _Abrir en formulario_ button in any key hover.

> 📸 _Screenshot: Add i18n Key form with locked key field and Translate All diff panel_ — proximamente

### CodeLens in locale JSON files

On the first line of any locale JSON file, two CodeLens actions appear:

- **`$(table) Ver tabla i18n`** — opens the full key table
- **`$(sort-precedence) Ordenar keys A→Z`** — sorts keys alphabetically with a confirmation dialog

The sort confirmation asks whether to sort **only this file** or **all locale files**. If all files are selected, a second modal lists every file that will be rewritten before proceeding.

> 📸 _Screenshot: CodeLens actions on first line of locale JSON file_ — proximamente

> 📸 _Screenshot: sort confirmation modal asking "Solo este archivo" vs "Todos los locales"_ — proximamente

### Locale navigation from JSON — jump between languages

While editing a locale JSON file you can walk the **same key** across every language without leaving the editor:

- **`Ctrl+Click`** on a key jumps to that same key in the **next locale** file, **cycling** through all locales and wrapping from the last back to the first.
- If the key does **not** exist in the target locale, it is **created empty** and the cursor is placed inside the value string, ready for you to type the translation. The key table refreshes automatically.

Locale order follows the same convention as everywhere else: **ES first, EN second**, the rest alphabetical. Navigation is Ctrl+Click only — there are no per-line CodeLenses, so the text never shifts as the cursor moves.

> 📸 _Screenshot: Ctrl+Click cycling the same key across locale files_ — proximamente

---

## Detected Patterns

| Pattern               | Example                                       |
| --------------------- | --------------------------------------------- |
| Pipe in template      | `'company.tabs.menu' \| translate`            |
| Binding with pipe     | `[attr]="'company.title' \| translate"`       |
| Ternary with pipe     | `(cond ? 'key.one' : 'key.two') \| translate` |
| `translate.instant()` | `this.translate.instant('errors.notFound')`   |
| `translate.get()`     | `this.translate.get('auth.login')`            |
| `translate.stream()`  | `this.translate.stream('profile.title')`      |

---

## File Structure

The extension automatically detects the pattern used — no additional configuration required.

### Namespaced (one file per feature)

```
src/assets/i18n/
├── es/
│   ├── company.json
│   └── reservation.json
├── en/
│   ├── company.json
│   └── reservation.json
└── fr/
    ├── company.json
    └── reservation.json
```

Each file has **a single root namespace**:

```json
{
  "company": {
    "tabs": {
      "menu": "Menu",
      "services": "Services"
    }
  }
}
```

### Flat (one file per locale)

```
src/assets/i18n/
├── es.json
├── en.json
└── fr.json
```

---

## Configuration

Add this to your project's `.vscode/settings.json`:

```json
{
  "i18nKV.localesPath": "src/assets/i18n",
  "i18nKV.sourceLocale": "es",
  "i18nKV.severity": "info"
}
```

| Setting               | Type                                 | Default             | Description                                             |
| --------------------- | ------------------------------------ | ------------------- | ------------------------------------------------------- |
| `i18nKV.localesPath`  | string                               | `"src/assets/i18n"` | Path to the locales folder (relative to workspace root) |
| `i18nKV.sourceLocale` | string                               | `"es"`              | Source locale used to validate keys                     |
| `i18nKV.severity`     | `"error"` \| `"warning"` \| `"info"` | `"info"`            | Diagnostic severity for missing i18n keys               |

---

## Commands

| Command                                     | Description                                                      |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `i18n Studio Pro: Reload locale files`               | Manually reloads all locale JSON files                           |
| `i18n Studio Pro: Open locale file`                  | Opens the locale JSON file at the exact key line (used by hover) |
| `i18n Studio Pro: Create missing key in all locales` | Creates a missing key in all locale JSON files                   |
| `i18n Studio Pro: Show i18n Key Table`               | Opens the full key table across all locales                      |
| `i18n Studio Pro: Show i18n Table for this file`     | Opens the table filtered to the keys of the active file          |
| `i18n Studio Pro: Sort locale file keys A→Z`         | Sorts keys of a locale file alphabetically (with confirmation)   |
| `i18n Studio Pro: Sort ALL locale files keys A→Z`    | Sorts keys of all locale files alphabetically (with confirmation)|

Access from the command palette: `Ctrl+Shift+P` → `i18n Studio Pro: ...`

The **🌐 button** in the editor toolbar (visible on `.html` and `.ts` files) is a shortcut to `Show i18n Table for this file`.

---

## How it works

1. On activation, auto-detects file structure (namespaced vs flat)
2. Reads all locales and flattens nested keys into dot-notation (`company.tabs.menu`)
3. Scans each open `.html` and `.ts` file for `| translate` and `translate.instant/get/stream()` patterns
4. Marks as error/warning/info any key not found in the source locale
5. Shows inline decorations with the translation in gray italic next to each key
6. `Ctrl+Click` in HTML/TS navigates to the source locale JSON at the exact key line; in a locale JSON, it cycles to the same key in the next locale (creating it if missing)
7. Watches locale JSON files for changes and re-validates automatically

---

## Manual Installation

1. Download the `.vsix` file
2. In VS Code: `Ctrl+Shift+P` → **Extensions: Install from VSIX...**
3. Select the `.vsix` file
4. Reload VS Code

---

## License

MIT
