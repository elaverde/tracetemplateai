import * as vscode from 'vscode';
import { analyzeLines, inferFunctionName } from '../core/analyzer';
import { resolveLanguage } from '../core/languageResolver';
import { getTraceSetting } from '../core/config';
import { enrichWithAI } from '../providers/aiProvider';

export async function analyzeCode(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const document = editor.document;
  const selection = editor.selection;

  if (selection.isEmpty) {
    vscode.window.showWarningMessage('Trace: select code lines to analyze.');
    return;
  }

  const langKey = resolveLanguage(document);
  const selectedText = document.getText(selection);
  const lines = selectedText.split('\n');

  const startLine = Math.max(0, selection.start.line - 30);
  const surroundingText = document.getText(
    new vscode.Range(startLine, 0, selection.start.line, 0)
  );
  const funcName = inferFunctionName(surroundingText);

  const items = analyzeLines(lines, funcName);

  if (items.length === 0) {
    vscode.window.showInformationMessage(`Trace [${langKey}]: no patterns detected.`);
    return;
  }

  const useAI = getTraceSetting<boolean>('useAI', false);
  const enriched = useAI
    ? await enrichWithAI(items, selectedText, funcName)
    : items.map((it) => ({ ...it, aiLabel: it.label as string }));

  // Show results in output channel
  const channel = vscode.window.createOutputChannel('Trace Analysis');
  channel.clear();
  channel.appendLine(`=== Trace Analysis [${langKey}] ===`);
  if (funcName) {
    channel.appendLine(`Function: ${funcName}`);
  }
  channel.appendLine('');

  for (const item of enriched) {
    const label = item.aiLabel;
    channel.appendLine(`Line ${item.lineIndex + 1} [${item.type}]`);
    channel.appendLine(`  value : ${item.value}`);
    channel.appendLine(`  label : ${label}`);
    channel.appendLine('');
  }

  channel.show();
}
