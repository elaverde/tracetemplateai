# Trace Template AI

Extensión para VSCode que inserta, gestiona y limpia trazas de depuración usando plantillas configurables, con soporte opcional de IA para generar etiquetas descriptivas automáticamente.

## Instalación y uso rápido

1. Instala la extensión en VS Code.
2. Abre un archivo y selecciona líneas de código.
3. Ejecuta `Trace: Insertar trazas` desde la paleta de comandos o clic derecho.
4. Para remover trazas insertadas, usa `Trace: Limpiar trazas`.

Modo recomendado sin IA:

```json
"traceTemplateAI.useAI": false,
"traceTemplateAI.mode": "template"
```

---

## Comandos

| Comando                       | Descripción                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `Trace: Insertar trazas`      | Inserta líneas de traza en el código seleccionado                               |
| `Trace: Limpiar trazas`       | Elimina todas las líneas de traza del archivo actual                            |
| `Trace: Analizar código`      | Analiza la selección y muestra los puntos de traza detectados                   |
| `Trace: Configuración rápida` | Abre selectores para configurar IA/proveedor/prioridad sin editar settings.json |

También disponibles desde el menú contextual (clic derecho en el editor).

---

## Configuración

### General

#### `traceTemplateAI.enabled`

- **Tipo:** `boolean`
- **Por defecto:** `true`
- Activa o desactiva la extensión. Si es `false`, los comandos Trace no insertan ni limpian nada.

#### `traceTemplateAI.mode`

- **Tipo:** `string` — valores: `"template"`
- **Por defecto:** `"template"`
- Modo de generación de trazas. `template` construye cada línea usando reglas locales y las plantillas definidas en `traceTemplateAI.templates`. Este modo funciona con o sin IA.

---

### Inteligencia Artificial

#### `traceTemplateAI.useAI`

- **Tipo:** `boolean`
- **Por defecto:** `false`
- Activa el uso de IA para generar etiquetas más descriptivas. Si es `false`, funciona **sin IA**: no llama a Copilot ni a Anthropic, y la etiqueta se genera localmente con reglas de código.

#### `traceTemplateAI.aiProvider`

- **Tipo:** `string` — valores: `"anthropic"` | `"copilot"`
- **Por defecto:** `"anthropic"`
- Proveedor de IA a usar **solo** cuando `traceTemplateAI.useAI=true` (si `traceTemplateAI.useAI=false`, este valor se ignora):
  - `"anthropic"` — llama a la API de Claude. Requiere `traceTemplateAI.anthropicApiKey`.
  - `"copilot"` — usa el modelo activo de GitHub Copilot dentro de VSCode. Requiere tener Copilot instalado y activo.

#### `traceTemplateAI.anthropicApiKey`

- **Tipo:** `string`
- **Por defecto:** `""`
- Clave de API de Anthropic. Solo se usa cuando `traceTemplateAI.aiProvider="anthropic"`. Obtenerla en [console.anthropic.com](https://console.anthropic.com).

#### `traceTemplateAI.copilotRequireGPT4`

- **Tipo:** `boolean`
- **Por defecto:** `true`
- Solo aplica cuando `traceTemplateAI.aiProvider="copilot"`.
- Si es `true`, exige GPT-4 y, si no existe disponible, pide confirmación antes de continuar con otro modelo.
- Si es `false`, no fuerza GPT-4 y prefiere un modelo no GPT-4 cuando hay uno disponible.

#### `traceTemplateAI.insertMinPriority`

- **Tipo:** `string` — valores: `"all"` | `"low"` | `"medium"` | `"high"`
- **Por defecto:** `"all"`
- Solo aplica cuando `traceTemplateAI.useAI=true`.
- Permite insertar solo trazas estratégicas según prioridad asignada por IA:
  - `"all"`: inserta todas las trazas detectadas.
  - `"low"`: inserta low, medium y high.
  - `"medium"`: inserta medium y high.
  - `"high"`: inserta solo high.

---

### Plantillas y lenguajes

#### `traceTemplateAI.languageProfiles`

- **Tipo:** `object`
- Define qué función de traza se usa por lenguaje. La clave es el ID del lenguaje y el valor es un objeto con `traceFunction`.

**Por defecto:**

```json
{
  "cor": { "traceFunction": "crerror" },
  "typescript": { "traceFunction": "console.log" },
  "python": { "traceFunction": "print" }
}
```

#### `traceTemplateAI.templates`

- **Tipo:** `object`
- Plantillas de traza por lenguaje y tipo de elemento detectado. Cada lenguaje puede tener dos plantillas:
- Plantillas de traza por lenguaje y tipo de elemento detectado. Cada lenguaje puede tener:
  - `"variable"` — para variables y parámetros
  - `"return"` — para valores de retorno
  - `"condition"` — para condiciones (`if/while/elif`)

**Placeholders disponibles:**

| Placeholder | Se reemplaza por                            |
| ----------- | ------------------------------------------- |
| `$label`    | Etiqueta descriptiva (generada o por IA)    |
| `$valor`    | Nombre de la variable o expresión detectada |
| `#file`     | Nombre del archivo actual                   |
| `#line`     | Número de línea                             |

**Por defecto:**

```json
{
  "cor": {
    "variable": "crerror(#file, #line, \"$label\" + ($valor));",
    "return": "crerror(#file, #line, \"RETORNO \" + ($valor));",
    "condition": "crerror(#file, #line, \"$label\" + (($valor) ? \" TRUE\" : \" FALSE\"));"
  },
  "typescript": {
    "variable": "console.log(\"$label\", $valor);",
    "return": "console.log(\"RETURN\", $valor);",
    "condition": "console.log(\"$label\", Boolean($valor));"
  },
  "python": {
    "variable": "print(\"$label\", $valor)",
    "return": "print(\"RETURN\", $valor)",
    "condition": "print(\"$label\", bool($valor))"
  }
}
```

Nota para `.cor`: en las plantillas usa `#file` y `#line` de forma literal. El runtime del lenguaje `.cor` reemplaza esos placeholders; no deben sustituirse manualmente.

---

## Ejemplos de configuración

### Usar Copilot como IA (con aviso si baja de GPT-4)

```json
"traceTemplateAI.useAI": true,
"traceTemplateAI.aiProvider": "copilot",
"traceTemplateAI.copilotRequireGPT4": true,
"traceTemplateAI.insertMinPriority": "medium"
```

### Usar Claude (Anthropic) como IA

```json
"traceTemplateAI.useAI": true,
"traceTemplateAI.aiProvider": "anthropic",
"traceTemplateAI.anthropicApiKey": "sk-ant-...",
"traceTemplateAI.insertMinPriority": "high"
```

### Usar solo plantillas sin IA

```json
"traceTemplateAI.useAI": false
```

En este modo no necesitas configurar `traceTemplateAI.aiProvider` ni claves API.

### Agregar un lenguaje personalizado

```json
"traceTemplateAI.languageProfiles": {
  "java": { "traceFunction": "System.out.println" }
},
"traceTemplateAI.templates": {
  "java": {
    "variable": "System.out.println(\"$label \" + $valor);",
    "return":   "System.out.println(\"RETURN \" + $valor);"
  }
}
```

Compatibilidad: la extensión sigue leyendo temporalmente claves antiguas `trace.*` si existen, pero el prefijo recomendado es `traceTemplateAI.*`.
