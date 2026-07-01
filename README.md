# ngx-translate i18n Validator

Extensión de VS Code que valida en tiempo real las claves de `@ngx-translate/core` en archivos HTML y TypeScript, comparándolas contra los archivos de locale JSON del proyecto.

Soporta dos estructuras de archivos:
- **Namespaced:** `src/assets/i18n/{locale}/{namespace}.json` (ej. puntia-mobile)
- **Flat:** `src/assets/i18n/{locale}.json` (ej. en.json, es.json — detección automática)

**Versión actual: 1.9.0**

---

## Características

### Validación en tiempo real
- Detecta todas las claves i18n usadas en templates HTML y código TypeScript
- Subraya en **rojo** cualquier clave que no exista en el locale fuente
- Se actualiza automáticamente al editar los archivos de locale JSON

### Decoraciones inline
- Muestra el texto de la traducción en **gris itálico** al lado de cada clave, directamente en el editor
- Visible en todo momento sin necesidad de pasar el cursor
- Se actualiza al cambiar de pestaña o al modificar los archivos JSON

### Ctrl+Click — ir al archivo fuente
- `Ctrl+Click` sobre cualquier clave i18n abre directamente el archivo JSON del locale fuente (`es`) en la línea exacta donde está definida

### Hover inteligente
- Pasa el cursor sobre cualquier clave i18n para ver sus traducciones en los **3 idiomas**
- Orden fijo: **ES primero, EN segundo**, resto alfabético
- Cada idioma incluye un link `$(go-to-file)` que abre el archivo JSON en la línea exacta de esa clave
- ✅ Clave encontrada → muestra el texto en cada locale
- ❌ Clave no encontrada → aviso de clave faltante con Quick Fix disponible

### Autocompletado (IntelliSense)
- Al escribir dentro de un contexto `| translate` o `translate.instant()`, sugiere todas las claves disponibles del locale fuente
- Muestra la traducción como `detail` en el menú de sugerencias
- Funciona en templates HTML y archivos TypeScript

### Quick Fix — Crear key en todos los locales
- Cuando una clave está marcada en rojo, aparece el bombillo 💡 de VS Code
- La acción `💡 Crear key en todos los locales` escribe la clave faltante en los 3 archivos JSON simultáneamente (`es/`, `en/`, `fr/`)
- El valor inicial es el último segmento de la clave en mayúsculas (placeholder para traducir)

### Patrones detectados

| Patrón | Ejemplo |
|--------|---------|
| Pipe en template | `'company.tabs.menu' \| translate` |
| Binding con pipe | `[attr]="'company.title' \| translate"` |
| Ternario con pipe | `(cond ? 'key.one' : 'key.two') \| translate` |
| `translate.instant()` | `this.translate.instant('errors.notFound')` |
| `translate.get()` | `this.translate.get('auth.login')` |
| `translate.stream()` | `this.translate.stream('profile.title')` |

---

## Estructura de archivos

La extensión detecta automáticamente el patrón usado — no requiere configuración adicional.

### Namespaced (un archivo por feature)
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

Cada archivo tiene **un único namespace raíz**:

```json
{
  "company": {
    "tabs": {
      "menu": "Menú",
      "services": "Servicios"
    }
  }
}
```

### Flat (un archivo por locale)
```
src/assets/i18n/
├── es.json
├── en.json
└── fr.json
```

---

## Configuración

Agrega esto al `.vscode/settings.json` de tu proyecto:

```json
{
  "ngxI18n.localesPath": "src/assets/i18n",
  "ngxI18n.sourceLocale": "es",
  "ngxI18n.severity": "error"
}
```

| Setting | Tipo | Default | Descripción |
|---------|------|---------|-------------|
| `ngxI18n.localesPath` | string | `"src/assets/i18n"` | Ruta a la carpeta de locales (relativa al workspace) |
| `ngxI18n.sourceLocale` | string | `"es"` | Locale fuente para validar claves |
| `ngxI18n.severity` | `"error"` \| `"warning"` \| `"info"` | `"error"` | Severidad del diagnóstico para claves faltantes |

---

## Comandos

| Comando | Descripción |
|---------|-------------|
| `ngx-i18n: Reload locale files` | Recarga manualmente todos los archivos JSON de locale |
| `ngx-i18n: Open locale file` | Abre el archivo JSON del locale en la línea exacta de la clave (usado por el hover) |
| `ngx-i18n: Create missing key in all locales` | Crea una clave faltante en los 3 archivos JSON (es/en/fr) |

Accede desde la paleta de comandos: `Ctrl+Shift+P` → `ngx-i18n: ...`

---

## Cómo funciona

1. Al activarse (con 1.5s de delay para que el workspace esté listo), detecta automáticamente la estructura de archivos (namespaced vs flat)
2. Lee todos los locales y aplana las claves anidadas en dot-notation (`company.tabs.menu`)
3. Escanea cada archivo `.html` y `.ts` abierto en busca de patrones `| translate` y `translate.instant/get/stream()`
4. Marca como error/warning/info cualquier clave que no esté en el locale fuente
5. Muestra decoraciones inline con la traducción en gris itálico al lado de cada clave
6. `Ctrl+Click` navega al archivo `es` JSON en la línea exacta de la clave
7. Escucha cambios en los JSON de locale y re-valida automáticamente

---

## Instalación manual

1. Descarga el `.vsix`
2. En VS Code: `Ctrl+Shift+P` → **Extensions: Install from VSIX...**
3. Selecciona el archivo `.vsix`
4. Recarga VS Code

### Generar el `.vsix`

```bash
npx @vscode/vsce package --no-dependencies --allow-missing-repository
code --install-extension ngx-i18n-validator-X.X.X.vsix
```

---

## Licencia

MIT
