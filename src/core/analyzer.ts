export type DetectionType = 'variable' | 'return' | 'condition';

export interface DetectedItem {
  type: DetectionType;
  value: string;
  label: string;
  /** 0-based line index within the selected text */
  lineIndex: number;
}

const PATTERNS: Array<{ type: DetectionType; regex: RegExp; valueGroup: number }> = [
  // variable assignment: LTV_REAL_NM = ... or let x = ...
  // Filtro base; luego se aplican reglas adicionales para evitar literales multilínea.
  { type: 'variable', regex: /^\s*(?:let\s+|var\s+|const\s+)?(\w+)\s*=(?!=)/, valueGroup: 1 },
  // return statement — solo si NO empieza un bloque/array (return { / return [)
  { type: 'return', regex: /^\s*return\s+(?![{[])(.+?)[\s;]*$/, valueGroup: 1 },
];

function extractConditionExpression(line: string): string | undefined {
  const startMatch = /^\s*(?:if|while|elif)\s*\(/.exec(line);
  if (!startMatch) {
    return undefined;
  }

  const openIdx = line.indexOf('(', startMatch[0].length - 1);
  if (openIdx < 0) {
    return undefined;
  }

  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = openIdx; i < line.length; i++) {
    const ch = line[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (!inDouble && ch === '\'') {
      inSingle = !inSingle;
      continue;
    }

    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      continue;
    }

    if (inSingle || inDouble) {
      continue;
    }

    if (ch === '(') {
      depth++;
      continue;
    }

    if (ch === ')') {
      depth--;
      if (depth === 0) {
        const expr = line.slice(openIdx + 1, i).trim();
        return expr.length > 0 ? expr : undefined;
      }
    }
  }

  return undefined;
}

function startsBlockLikeAssignment(line: string): boolean {
  const eqIdx = line.indexOf('=');
  if (eqIdx < 0) {
    return false;
  }

  const rhs = line.slice(eqIdx + 1).trim();
  if (!rhs) {
    return false;
  }

  // Casos típicos que abren literales/estructuras y no deben trazar justo ahí:
  // var x = @{case
  // var x = {
  // var x = [
  if (rhs.startsWith('@{') || rhs.startsWith('{') || rhs.startsWith('[')) {
    return true;
  }

  // También cubrir when termina en apertura de bloque sin cerrar en la línea.
  if (/[{[]\s*$/.test(rhs) && !/[}\]]\s*;?\s*$/.test(rhs)) {
    return true;
  }

  return false;
}

/**
 * Analyzes selected code lines and returns detected trace candidates.
 * @param lines      Array of code lines from selection
 * @param funcName   Optional enclosing function name for label generation
 */
export function analyzeLines(lines: string[], funcName?: string): DetectedItem[] {
  const results: DetectedItem[] = [];
  const prefix = funcName ? `[DEBUG][${funcName}]` : '[DEBUG]';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const conditionExpr = extractConditionExpression(line);
    if (conditionExpr) {
      results.push({
        type: 'condition',
        value: conditionExpr,
        label: `${prefix} condition`,
        lineIndex: i,
      });
      continue;
    }

    for (const { type, regex, valueGroup } of PATTERNS) {
      const match = regex.exec(line);
      if (match) {
        if (type === 'variable' && startsBlockLikeAssignment(line)) {
          break;
        }

        const value = match[valueGroup].trim();
        results.push({
          type,
          value,
          label: `${prefix} ${value}`,
          lineIndex: i,
        });
        break; // only first matching pattern per line
      }
    }
  }

  return results;
}

/**
 * Tries to infer the enclosing function name from text above/around the selection.
 * Works for common patterns in .cor, JS, TS, Python.
 */
export function inferFunctionName(surroundingText: string): string | undefined {
  const patterns = [
    // JS/TS: function foo(  |  foo(  async foo(
    /(?:function\s+|async\s+function\s+)(\w+)\s*\(/,
    // JS/TS arrow / method: foo = ( | foo(
    /(\w+)\s*[:=]\s*(?:async\s*)?\(/,
    // Python: def foo(
    /def\s+(\w+)\s*\(/,
    // .cor / generic: PROCEDURE foo
    /(?:PROCEDURE|FUNCTION|SUB)\s+(\w+)/i,
  ];
  for (const p of patterns) {
    const m = p.exec(surroundingText);
    if (m) {
      return m[1];
    }
  }
  return undefined;
}
