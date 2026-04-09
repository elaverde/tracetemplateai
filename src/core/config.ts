import * as vscode from 'vscode';

const NEW_CONFIG_SECTION = 'traceTemplateAI';
const LEGACY_CONFIG_SECTION = 'trace';

/**
 * Reads a setting from the new prefix first and falls back to legacy `trace.*`.
 */
export function getTraceSetting<T>(key: string, defaultValue: T): T {
  const newConfig = vscode.workspace.getConfiguration(NEW_CONFIG_SECTION);
  const newValue = newConfig.get<T>(key);
  if (newValue !== undefined) {
    return newValue;
  }

  const legacyConfig = vscode.workspace.getConfiguration(LEGACY_CONFIG_SECTION);
  const legacyValue = legacyConfig.get<T>(key);
  if (legacyValue !== undefined) {
    return legacyValue;
  }

  return defaultValue;
}
