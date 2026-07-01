# RamiroCR98 — VS Code Extension Publishing Standard

Template y guia para publicar extensiones en el VS Code Marketplace bajo el publisher **RamiroCR98**.

---

## 1. Estructura de archivos minima

```
my-extension/
├── extension.js          ← Logica principal
├── package.json          ← Manifest de la extension
├── icon.png              ← Icono 128x128px (generado con generate-icon.js)
├── README.md             ← Documentacion publica (aparece en el Marketplace)
├── generate-icon.js      ← Script para generar icon.png
└── .vscodeignore         ← Excluir archivos del .vsix
```

---

## 2. package.json — Template

```json
{
  "name": "my-extension-id",
  "displayName": "My Extension Name",
  "description": "Short description visible in the Marketplace.",
  "publisher": "RamiroCR98",
  "version": "1.0.0",
  "icon": "icon.png",
  "engines": {
    "vscode": "^1.74.0"
  },
  "categories": ["Linters"],
  "activationEvents": [],
  "main": "./extension.js",
  "contributes": {
    "configuration": {
      "title": "My Extension Name",
      "properties": {
        "myExt.settingOne": {
          "type": "string",
          "default": "defaultValue",
          "description": "Description of setting."
        }
      }
    },
    "commands": [
      {
        "command": "myExt.reload",
        "title": "myExt: Reload"
      }
    ]
  }
}
```

**Convenciones de naming:**
- `name`: kebab-case, unico en el Marketplace
- `publisher`: siempre `RamiroCR98`
- Prefijo de comandos y settings: abreviatura de la extension en camelCase (ej. `i18nKV`, `myExt`)
- Comandos visibles con formato: `prefijo: Accion`

---

## 3. Generar el icono — generate-icon.js

El icono sigue el estilo **liquid glass rojo oscuro** con el nombre del publisher arriba y el identificador de la extension en el centro.

```js
/**
 * Generates icon.png for a VS Code extension.
 * Run: node generate-icon.js
 * Requires: npm install canvas
 */
const { createCanvas } = require('canvas');
const fs = require('fs');

const size = 128;
const canvas = createCanvas(size, size);
const ctx = canvas.getContext('2d');

// ── Personalizar estos valores ──────────────────────────────
const PUBLISHER_LABEL = 'Ramiro';       // Texto arriba
const EXTENSION_LABEL = 'myExt';        // Texto central (identificador)
// ────────────────────────────────────────────────────────────

// Background — liquid glass dark red
const grad = ctx.createLinearGradient(0, 0, size, size);
grad.addColorStop(0, '#1a0008');
grad.addColorStop(0.4, '#2d0010');
grad.addColorStop(1, '#4a0018');
ctx.fillStyle = grad;
ctx.beginPath();
ctx.roundRect(0, 0, size, size, 18);
ctx.fill();

// Glass shimmer
const shimmer = ctx.createLinearGradient(0, 0, size * 0.6, size * 0.6);
shimmer.addColorStop(0, 'rgba(255,255,255,0.07)');
shimmer.addColorStop(0.5, 'rgba(255,255,255,0.02)');
shimmer.addColorStop(1, 'rgba(255,255,255,0)');
ctx.fillStyle = shimmer;
ctx.beginPath();
ctx.roundRect(0, 0, size, size, 18);
ctx.fill();

// Glass border
ctx.strokeStyle = 'rgba(255,255,255,0.12)';
ctx.lineWidth = 1.5;
ctx.beginPath();
ctx.roundRect(1, 1, size - 2, size - 2, 17);
ctx.stroke();

// Publisher label — top
ctx.fillStyle = '#ffffff';
ctx.font = 'bold 13px "Courier New", monospace';
ctx.textAlign = 'center';
ctx.textBaseline = 'alphabetic';
ctx.fillText(PUBLISHER_LABEL, size / 2, 22);

// Separator line
ctx.strokeStyle = 'rgba(100, 200, 240, 0.25)';
ctx.lineWidth = 1;
ctx.beginPath();
ctx.moveTo(14, 29);
ctx.lineTo(size - 14, 29);
ctx.stroke();

// Extension label — center with cyan glow
ctx.shadowColor = '#00e5ff';
ctx.shadowBlur = 12;
ctx.fillStyle = '#ffffff';
ctx.font = 'bold 40px "Courier New", monospace';
ctx.textBaseline = 'middle';
ctx.fillText(EXTENSION_LABEL, size / 2, 80);
ctx.shadowBlur = 0;

const buffer = canvas.toBuffer('image/png');
fs.writeFileSync('icon.png', buffer);
console.log('icon.png generated ✓');
```

**Para generar:**
```bash
npm install canvas
node generate-icon.js
```

---

## 4. .vscodeignore — Template

```
node_modules/**
generate-icon.js
generate-profile-icon.js
*.vsix
EXTENSION-STANDARD.md
```

---

## 5. README.md — Estructura recomendada

```markdown
# Extension Name

One line description.

**Version: X.X.X**

---

## Screenshots

![Feature 1](https://i.imgur.com/xxxxx.png)
_Caption_

![Feature 2](https://i.imgur.com/xxxxx.png)
_Caption_

---

## Features

### Feature Name
- Bullet points

---

## Configuration

\`\`\`json
{
  "myExt.setting": "value"
}
\`\`\`

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| ...     | ...  | ...     | ...         |

---

## Commands

| Command | Description |
|---------|-------------|
| `myExt: Reload` | ... |

Access from: `Ctrl+Shift+P` → `myExt: ...`

---

## How it works

1. Step one
2. Step two

---

## Manual Installation

1. Download the `.vsix` file
2. In VS Code: `Ctrl+Shift+P` → **Extensions: Install from VSIX...**
3. Select the `.vsix` file
4. Reload VS Code

---

## License

MIT
```

---

## 6. Proceso de publicacion

### Primera vez

1. Crear publisher en [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage)
2. Instalar vsce: `npm install -g @vscode/vsce`
3. Empaquetar: `vsce package --allow-missing-repository`
4. Subir el `.vsix` manualmente en el Marketplace manager

### Update

1. Incrementar version en `package.json` (y en README si aplica)
2. `vsce package --allow-missing-repository`
3. Subir el nuevo `.vsix` en el Marketplace manager — se detecta como update automaticamente

### Versionado

Seguir semver:
- `X.0.0` — cambio mayor (rename, breaking change)
- `X.Y.0` — nueva funcionalidad
- `X.Y.Z` — fix o ajuste menor

---

## 7. Checklist antes de publicar

- [ ] `publisher` es `RamiroCR98` en `package.json`
- [ ] `"license": "MIT"` en `package.json`
- [ ] Archivo `LICENSE` en la raiz del proyecto
- [ ] `version` incrementada respecto a la anterior
- [ ] `icon.png` generado y actualizado (128x128px)
- [ ] `README.md` en ingles con screenshots en imgur
- [ ] Comandos y settings con prefijo correcto
- [ ] `.vscodeignore` excluye archivos innecesarios
- [ ] `vsce package` sin errores
