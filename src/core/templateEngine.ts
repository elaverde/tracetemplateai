export interface TemplateContext {
  label: string;
  value: string;
  file?: string;
  line?: number;
}

export interface Templates {
  variable?: string;
  return?: string;
  condition?: string;
  [key: string]: string | undefined;
}

function escapeForDoubleQuotedString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

/**
 * Renders a template string by replacing placeholders with context values.
 *
 * Placeholders:
 *   $label  → context.label
 *   $valor  → context.value
 *   #file   → context.file (kept as-is if not provided)
 *   #line   → context.line (kept as-is if not provided)
 */
export function renderTemplate(template: string, ctx: TemplateContext): string {
  let result = template;
  result = result.replace(/\$label/g, escapeForDoubleQuotedString(ctx.label));
  result = result.replace(/\$valor/g, ctx.value);
  if (ctx.file !== undefined) {
    result = result.replace(/#file/g, ctx.file);
  }
  if (ctx.line !== undefined) {
    result = result.replace(/#line/g, String(ctx.line));
  }
  return result;
}
