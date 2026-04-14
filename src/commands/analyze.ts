import * as vscode from 'vscode';
import { resolveLanguage } from '../core/languageResolver';
import { getTraceSetting } from '../core/config';
import { reviewCleanCode } from '../providers/aiProvider';

export async function analyzeCode(): Promise<void> {
  const useAI = getTraceSetting<boolean>('useAI', false);

  if (!useAI) {
    vscode.window.showWarningMessage(
      'Trace: IA no activa. Activa la opción "traceTemplateAI.useAI" en la configuración para usar el análisis de código.'
    );
    return;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showWarningMessage('Trace: selecciona un fragmento de código para analizar.');
    return;
  }

  const langKey = resolveLanguage(editor.document);
  const selectedText = editor.document.getText(selection);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Trace: analizando código...',
      cancellable: false,
    },
    async () => {
      const result = await reviewCleanCode(selectedText, langKey);

      if (!result) {
        return;
      }

      const channel = vscode.window.createOutputChannel('Trace - Análisis de Código');
      channel.clear();
      channel.appendLine(`=== Análisis de Código [${langKey}] ===`);
      channel.appendLine(`Líneas analizadas: ${selection.start.line + 1}–${selection.end.line + 1}`);
      channel.appendLine('');
      channel.appendLine(result);
      channel.show();
    }
  );
}
