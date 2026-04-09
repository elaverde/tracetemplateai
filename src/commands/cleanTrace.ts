import * as vscode from 'vscode';
import { resolveLanguage, getLanguageProfile } from '../core/languageResolver';
import { buildTraceLineRegex } from '../utils/regexUtils';

export async function cleanTrace(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const document = editor.document;
  const langKey = resolveLanguage(document);
  const profile = getLanguageProfile(langKey);
  const traceRegex = buildTraceLineRegex(profile.traceFunction);

  // Determine scope: selection or full document
  const selection = editor.selection;
  const startLine = selection.isEmpty ? 0 : selection.start.line;
  const endLine = selection.isEmpty ? document.lineCount - 1 : selection.end.line;

  const linesToDelete: number[] = [];

  for (let i = startLine; i <= endLine; i++) {
    const lineText = document.lineAt(i).text;
    if (traceRegex.test(lineText)) {
      linesToDelete.push(i);
    }
  }

  if (linesToDelete.length === 0) {
    vscode.window.showInformationMessage('Trace: no trace lines found to clean.');
    return;
  }

  await editor.edit((editBuilder) => {
    // Delete in reverse order to preserve line numbers
    for (const lineNum of linesToDelete.reverse()) {
      const line = document.lineAt(lineNum);
      // Delete the entire line including the newline
      const rangeToDelete = line.rangeIncludingLineBreak;
      editBuilder.delete(rangeToDelete);
    }
  });

  vscode.window.showInformationMessage(
    `Trace: removed ${linesToDelete.length} trace line(s).`
  );
}
