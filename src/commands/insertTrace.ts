import * as vscode from 'vscode';
import { analyzeLines, inferFunctionName } from '../core/analyzer';
import { renderTemplate } from '../core/templateEngine';
import { resolveLanguage, getLanguageProfile } from '../core/languageResolver';
import { getTraceSetting } from '../core/config';
import { enrichWithAI, TracePriority } from '../providers/aiProvider';

type InsertMinPriority = 'all' | TracePriority;

function priorityRank(priority: TracePriority): number {
  if (priority === 'high') return 3;
  if (priority === 'medium') return 2;
  return 1;
}

function filterByPriority<T extends { priority?: TracePriority }>(
  items: T[],
  minPriority: InsertMinPriority,
  useAI: boolean
): T[] {
  // Priority filtering is only meaningful when AI is active.
  if (!useAI || minPriority === 'all') {
    return items;
  }

  const threshold = priorityRank(minPriority);
  return items.filter((item) => priorityRank(item.priority ?? 'medium') >= threshold);
}

function normalizeInsertMinPriority(value: string | undefined): InsertMinPriority {
  const normalized = value?.toLowerCase();
  if (normalized === 'all' || normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized;
  }
  return 'all';
}

export async function insertTrace(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  if (!getTraceSetting<boolean>('enabled', true)) {
    vscode.window.showInformationMessage('Trace: disabled. Enable via traceTemplateAI.enabled setting.');
    return;
  }

  const document = editor.document;
  const selection = editor.selection;

  if (selection.isEmpty) {
    vscode.window.showWarningMessage('Trace: select code lines first.');
    return;
  }

  const langKey = resolveLanguage(document);
  const profile = getLanguageProfile(langKey);

  if (!profile.templates.variable && !profile.templates.return && !profile.templates.condition) {
    vscode.window.showWarningMessage(
      `Trace: no templates configured for language "${langKey}". Add them in traceTemplateAI.templates.`
    );
    return;
  }

  const selectedText = document.getText(selection);
  const lines = selectedText.split('\n');

  // Grab surrounding context to infer function name
  const startLine = Math.max(0, selection.start.line - 30);
  const surroundingRange = new vscode.Range(startLine, 0, selection.start.line, 0);
  const surroundingText = document.getText(surroundingRange);
  const funcName = inferFunctionName(surroundingText);

  let items = analyzeLines(lines, funcName);

  if (items.length === 0) {
    vscode.window.showInformationMessage('Trace: no traceable patterns found in selection.');
    return;
  }

  // Optionally enrich with AI
  const useAI = getTraceSetting<boolean>('useAI', false);
  const configuredMinPriority = getTraceSetting<string>('insertMinPriority', 'all');
  const minPriority = normalizeInsertMinPriority(configuredMinPriority);
  const enriched = useAI
    ? await enrichWithAI(items, selectedText, funcName)
    : items.map((it) => ({ ...it, aiLabel: it.label as string, priority: 'medium' as TracePriority }));

  const selectedForInsert = filterByPriority(enriched, minPriority, useAI);

  if (selectedForInsert.length === 0) {
    vscode.window.showInformationMessage(
      `Trace: no trace(s) met minimum priority "${minPriority}".`
    );
    return;
  }

  await editor.edit((editBuilder) => {
    // Build a new version of selected lines with trace calls inserted above each detected line
    const insertions: Array<{ lineNum: number; trace: string; after: boolean }> = [];

    for (const item of selectedForInsert) {
      const template = profile.templates[item.type] ?? profile.templates.variable;
      if (!template) {
        continue;
      }

      const traceLabel = item.aiLabel;
      const absoluteLine = selection.start.line + item.lineIndex;
      const traceLine = renderTemplate(template, {
        label: traceLabel,
        value: item.value,
      });

      const after = item.type === 'variable'; // variables: después; return/condition: antes
      insertions.push({ lineNum: absoluteLine, trace: traceLine, after });
    }

    // Ordenar en reversa para no desplazar líneas al editar
    insertions.sort((a, b) => b.lineNum - a.lineNum || (b.after ? 1 : -1));

    for (const { lineNum, trace, after } of insertions) {
      const lineObj = document.lineAt(lineNum);
      const indent = lineObj.text.match(/^(\s*)/)?.[1] ?? '';
      const insertion = `${indent}${trace}\n`;

      if (after) {
        // Insertar al inicio de la SIGUIENTE línea
        const insertPos = new vscode.Position(lineNum + 1, 0);
        editBuilder.insert(insertPos, insertion);
      } else {
        // Insertar al inicio de la línea actual
        const insertPos = new vscode.Position(lineNum, 0);
        editBuilder.insert(insertPos, insertion);
      }
    }
  });

  vscode.window.showInformationMessage(
    (() => {
      if (!useAI) {
        return `Trace: inserted ${selectedForInsert.length} trace(s) for ${langKey}.`;
      }

      const highCount = enriched.filter((it) => it.priority === 'high').length;
      const mediumCount = enriched.filter((it) => it.priority === 'medium').length;
      const lowCount = enriched.filter((it) => it.priority === 'low').length;

      return `Trace: inserted ${selectedForInsert.length}/${enriched.length} trace(s) for ${langKey} (min=${minPriority}, high=${highCount}, medium=${mediumCount}, low=${lowCount}).`;
    })()
  );
}
