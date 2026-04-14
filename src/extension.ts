import * as vscode from 'vscode';
import { insertTrace } from './commands/insertTrace';
import { cleanTrace } from './commands/cleanTrace';
import { analyzeCode } from './commands/analyze';
import { configureTrace } from './commands/configureTrace';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('trace.insert', insertTrace),
    vscode.commands.registerCommand('trace.clean', cleanTrace),
    vscode.commands.registerCommand('trace.analyze', analyzeCode),
    vscode.commands.registerCommand('trace.configure', configureTrace)
  );
}

export function deactivate(): void {
  // nothing to clean up
}
