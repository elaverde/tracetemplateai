import * as vscode from 'vscode';

type TraceProvider = 'anthropic' | 'copilot';
type MinPriority = 'all' | 'low' | 'medium' | 'high';

export async function configureTrace(): Promise<void> {
  const config = vscode.workspace.getConfiguration('traceTemplateAI');

  const useAIOption = await vscode.window.showQuickPick(
    [
      { label: 'Sin IA', description: 'Usar reglas por codigo y plantillas locales', value: false },
      { label: 'Con IA', description: 'Usar Copilot o Anthropic para enriquecer trazas', value: true },
    ],
    {
      placeHolder: 'Trace: modo de generacion',
      ignoreFocusOut: true,
    }
  );

  if (!useAIOption) {
    return;
  }

  await config.update('useAI', useAIOption.value, vscode.ConfigurationTarget.Global);

  if (!useAIOption.value) {
    vscode.window.showInformationMessage(
      'Trace configurado: modo sin IA (traceTemplateAI.useAI=false).'
    );
    return;
  }

  const providerOption = await vscode.window.showQuickPick(
    [
      { label: 'Copilot', description: 'Modelo activo de GitHub Copilot', value: 'copilot' as TraceProvider },
      { label: 'Anthropic', description: 'Claude via API key', value: 'anthropic' as TraceProvider },
    ],
    {
      placeHolder: 'Trace: proveedor de IA',
      ignoreFocusOut: true,
    }
  );

  if (!providerOption) {
    return;
  }

  await config.update('aiProvider', providerOption.value, vscode.ConfigurationTarget.Global);

  if (providerOption.value === 'copilot') {
    const gpt4Option = await vscode.window.showQuickPick(
      [
        {
          label: 'Exigir GPT-4',
          description: 'Si no hay GPT-4, pedir confirmacion antes de usar otro modelo',
          value: true,
        },
        {
          label: 'No exigir GPT-4',
          description: 'Permitir modelo no GPT-4 para mayor disponibilidad',
          value: false,
        },
      ],
      {
        placeHolder: 'Trace: politica de modelo Copilot',
        ignoreFocusOut: true,
      }
    );

    if (!gpt4Option) {
      return;
    }

    await config.update('copilotRequireGPT4', gpt4Option.value, vscode.ConfigurationTarget.Global);
  }

  const priorityOption = await vscode.window.showQuickPick(
    [
      { label: 'Todas', description: 'Inserta todas las trazas detectadas', value: 'all' as MinPriority },
      { label: 'Baja o superior', description: 'Inserta low, medium y high', value: 'low' as MinPriority },
      { label: 'Media o superior', description: 'Inserta medium y high', value: 'medium' as MinPriority },
      { label: 'Solo alta', description: 'Inserta solo trazas estrategicas', value: 'high' as MinPriority },
    ],
    {
      placeHolder: 'Trace: prioridad minima de insercion',
      ignoreFocusOut: true,
    }
  );

  if (!priorityOption) {
    return;
  }

  await config.update('insertMinPriority', priorityOption.value, vscode.ConfigurationTarget.Global);

  vscode.window.showInformationMessage(
    `Trace configurado: IA=${providerOption.value}, prioridad minima=${priorityOption.value}.`
  );
}
