import * as vscode from 'vscode';
import { Templates } from './templateEngine';
import { getTraceSetting } from './config';

export interface LanguageProfile {
  id: string;
  traceFunction: string;
  templates: Templates;
}

/** Maps VSCode languageId and file extensions to our profile keys */
const LANGUAGE_MAP: Record<string, string> = {
  typescript: 'typescript',
  typescriptreact: 'typescript',
  python: 'python',
  cor: 'cor',
  plaintext: 'cor', // fallback for .cor files opened as plaintext
};

/** Extension-based override (when VSCode can't detect the language) */
const EXTENSION_MAP: Record<string, string> = {
  '.cor': 'cor',
  '.ts': 'typescript',
  '.py': 'python',
};

export function resolveLanguage(document: vscode.TextDocument): string {
  const byLang = LANGUAGE_MAP[document.languageId];
  if (byLang) {
    return byLang;
  }

  const ext = document.fileName.slice(document.fileName.lastIndexOf('.'));
  const byExt = EXTENSION_MAP[ext.toLowerCase()];
  if (byExt) {
    return byExt;
  }

  return document.languageId;
}

export function getLanguageProfile(langKey: string): LanguageProfile {
  const profiles = getTraceSetting<Record<string, { traceFunction: string }>>('languageProfiles', {});
  const templates = getTraceSetting<Record<string, Templates>>('templates', {});

  const profile = profiles[langKey];
  const tmpl = templates[langKey] ?? {};

  return {
    id: langKey,
    traceFunction: profile?.traceFunction ?? 'console.log',
    templates: tmpl,
  };
}
