# i18n Studio Pro

[![Report a Bug](https://img.shields.io/badge/Report%20a%20bug-GitHub%20Issues-red?style=flat-square&logo=github)](https://github.com/RamiroRepos/i18n-Studio-Pro-VSExtension/issues/new?labels=bug&template=bug_report.md&title=[Bug]+)
[![Request Feature](https://img.shields.io/badge/Request%20feature-GitHub%20Issues-blue?style=flat-square&logo=github)](https://github.com/RamiroRepos/i18n-Studio-Pro-VSExtension/issues/new?labels=enhancement&title=[Feature]+)

A full-featured i18n management suite for VS Code. Real-time validation, inline translations, key table, hover across locales, CodeLens, sort keys, and plain-text detection. Supports ngx-translate and similar setups.

Supports two file structures:

- **Namespaced:** `src/assets/i18n/{locale}/{namespace}.json`
- **Flat:** `src/assets/i18n/{locale}.json` (e.g. `en.json`, `es.json` — auto-detected)

**Version: 2.1.4**

**Found a bug or false positive?** [Open an issue on GitHub](https://github.com/RamiroRepos/i18n-Studio-Pro-VSExtension/issues/new) — or use the **🐛 Report Issue** section inside the extension sidebar.

---

## Feature Overview

| Feature | Where | Description |
|---|---|---|
| **Real-time Validation** | HTML / TS | Underlines keys not found in the source locale |
| **Inline Decorations** | HTML / TS | Shows the translated value in gray italic next to each key |
| **Smart Hover** | HTML / TS | Hover a key to see all locale translations with links to each file |
| **Hover in JSON** | Locale JSON | Hover a key to see its value in every other language |
| **Ctrl+Click** | HTML / TS | Jump to the source locale JSON at the exact key line |
| **IntelliSense** | HTML / TS | Autocompletes i18n keys inside `\| translate` and `translate.instant()` |
| **Quick Fix** | HTML / TS | 💡 Creates a missing key in all locale files simultaneously |
| **i18n Key Table** | Panel | Full key × locale table with search, missing filter and ↗ file links |
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

Detects all i18n keys used in HTML templates and TypeScript files. Underlines any key that does not exist in the source locale. Automatically updates when locale JSON files are edited.

> 📸 _Screenshot: missing key underlined with diagnostic message_ — proximamente

### Inline Decorations

Shows the translation text in **gray italic** next to each key, directly in the editor. Always visible without hovering. Updates when switching tabs or modifying JSON files.

> 📸 _Screenshot: inline decoration showing translated value next to key_ — proximamente

### Smart Hover — HTML & TypeScript

Hover over any i18n key to see its translations across all available locales. Fixed order: **ES first, EN second**, rest alphabetical. Each locale includes a link that opens the JSON file at the exact key line.

![Hover with translations across all locales](https://i.imgur.com/tewZzRx.png)
_Hover showing translations for ES, EN and FR with direct links to each locale file_

### Hover in Locale JSON files

When editing a `.json` locale file, hover over any key to see its translations in **all other languages**. Each entry shows a direct link to open that locale at the exact key line. Works for both flat and namespaced structures.

> 📸 _Screenshot: hover on JSON key showing translations in EN, FR_ — proximamente

### Quick Fix — Create key in all locales

When a key is marked as missing, the VS Code 💡 lightbulb appears. The action writes the missing key to **all locale JSON files simultaneously**. Prompts for the source locale value; other locales get a `[LOCALE] value` placeholder.

![Missing key error with Quick Fix](https://i.imgur.com/SvGLN2x.png)
_Missing key with Quick Fix available_

### Ctrl+Click — Go to Source

`Ctrl+Click` on any i18n key opens the source locale JSON file at the exact line where the key is defined.

> 📸 _Screenshot: Ctrl+Click navigating to JSON file at key line_ — proximamente

### Autocompletion (IntelliSense)

Suggests all available keys from the source locale when typing inside a `| translate` or `translate.instant()` context. Shows the translation as detail in the suggestion menu. Works in HTML templates and TypeScript files.

> 📸 _Screenshot: IntelliSense dropdown showing key suggestions with translations_ — proximamente

### i18n Key Table — full overview

Opens a **table panel** showing all keys as rows and each locale as a column. Features:

- Filter by key name or translation value in real time
- Toggle **Solo faltantes** to see only keys missing in at least one locale
- Click `↗` on any cell to jump directly to that key in the locale JSON file
- Button **⇅ Ordenar A→Z** to sort all locale files alphabetically (with confirmation)
- Table auto-refreshes when locale JSON files change

> 📸 _Screenshot: table panel with key rows, locale columns, missing cells highlighted_ — proximamente

### i18n Table for current file — toolbar button

A **🌐 globe icon** appears in the editor toolbar when viewing an `.html` or `.ts` file. Clicking it opens the table **filtered to the keys used in that file only**. Below the table, a **💡 Textos sin traducir** section detects plain text in the HTML (tag content, `placeholder`, `title`, `aria-label` attributes) that has no `| translate` — each shows a **+ crear key** button.

> 📸 _Screenshot: globe button in editor toolbar, table filtered to file keys_ — proximamente

> 📸 _Screenshot: "Textos sin traducir" section with plain text chips and "+ crear key" buttons_ — proximamente

### Add i18n Key — sidebar form

The **✚ Add i18n Key** section in the sidebar provides a full form to create a new key across all locales:

- **Key field** — dot-notation (e.g. `common.save`). Auto-suggested when opening from a plain-text chip.
- **Per-locale inputs** — one input per detected locale, each labeled with a flag emoji.
- **⚡ Translate** — auto-translates that locale from the source locale using the MyMemory API (no API key required).
- **⚡ Translate All** — fills all non-source locales in parallel with one click.
- **✓ Create Key** — writes the key to all locale JSON files simultaneously.

Opening from a plain-text suggestion chip pre-fills the key name and source value automatically.

> 📸 _Screenshot: Add i18n Key form in sidebar with locale inputs and translate buttons_ — proximamente

### CodeLens in locale JSON files

On the first line of any locale JSON file, two CodeLens actions appear:

- **`$(table) Ver tabla i18n`** — opens the full key table
- **`$(sort-precedence) Ordenar keys A→Z`** — sorts keys alphabetically with a confirmation dialog

The sort confirmation asks whether to sort **only this file** or **all locale files**. If all files are selected, a second modal lists every file that will be rewritten before proceeding.

> 📸 _Screenshot: CodeLens actions on first line of locale JSON file_ — proximamente

> 📸 _Screenshot: sort confirmation modal asking "Solo este archivo" vs "Todos los locales"_ — proximamente

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
6. `Ctrl+Click` navigates to the source locale JSON at the exact key line
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
