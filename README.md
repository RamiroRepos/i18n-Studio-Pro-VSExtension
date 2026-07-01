# i18n Key Validator

A VS Code extension that validates i18n translation keys in real time across HTML and TypeScript files, comparing them against your locale JSON files.

Supports two file structures:

- **Namespaced:** `src/assets/i18n/{locale}/{namespace}.json`
- **Flat:** `src/assets/i18n/{locale}.json` (e.g. `en.json`, `es.json` — auto-detected)

**Version: 2.0.1**

---

## Screenshots

![Hover with translations across all locales](https://i.imgur.com/tewZzRx.png)
_Hover showing translations for ES, EN and FR with direct links to each locale file_

![Missing key error with Quick Fix](https://i.imgur.com/SvGLN2x.png)
_Missing key underlined in red with diagnostic message and Quick Fix available_

---

## Features

### Real-time Validation

- Detects all i18n keys used in HTML templates and TypeScript files
- Underlines in **red** any key that does not exist in the source locale
- Automatically updates when locale JSON files are edited

### Inline Decorations

- Shows the translation text in **gray italic** next to each key, directly in the editor
- Always visible without hovering
- Updates when switching tabs or modifying JSON files

### Ctrl+Click — Go to Source

- `Ctrl+Click` on any i18n key opens the source locale JSON file at the exact line where the key is defined

### Smart Hover

- Hover over any i18n key to see its translations across all available locales
- Fixed order: **ES first, EN second**, rest alphabetical
- Each locale includes a `$(go-to-file)` link that opens the JSON file at the exact key line
- ✅ Key found → shows the translated text per locale
- ❌ Key missing → shows a missing key warning with Quick Fix available

### Autocompletion (IntelliSense)

- Suggests all available keys from the source locale when typing inside a `| translate` or `translate.instant()` context
- Shows the translation as `detail` in the suggestion menu
- Works in HTML templates and TypeScript files

### Quick Fix — Create key in all locales

- When a key is marked in red, the VS Code 💡 lightbulb appears
- The action `💡 Create key in all locales` writes the missing key to all locale JSON files simultaneously
- The initial value is the last key segment in uppercase (as a placeholder to translate)

### Detected Patterns

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
  "i18nKV.severity": "error"
}
```

| Setting               | Type                                 | Default             | Description                                             |
| --------------------- | ------------------------------------ | ------------------- | ------------------------------------------------------- |
| `i18nKV.localesPath`  | string                               | `"src/assets/i18n"` | Path to the locales folder (relative to workspace root) |
| `i18nKV.sourceLocale` | string                               | `"es"`              | Source locale used to validate keys                     |
| `i18nKV.severity`     | `"error"` \| `"warning"` \| `"info"` | `"error"`           | Diagnostic severity for missing i18n keys               |

---

## Commands

| Command                                     | Description                                                      |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `i18nKV: Reload locale files`               | Manually reloads all locale JSON files                           |
| `i18nKV: Open locale file`                  | Opens the locale JSON file at the exact key line (used by hover) |
| `i18nKV: Create missing key in all locales` | Creates a missing key in all locale JSON files                   |

Access from the command palette: `Ctrl+Shift+P` → `i18nKV: ...`

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
