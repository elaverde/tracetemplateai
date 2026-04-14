import * as vscode from 'vscode';
import Anthropic from '@anthropic-ai/sdk';
import { DetectedItem } from '../core/analyzer';
import { getTraceSetting } from '../core/config';

export type TracePriority = 'low' | 'medium' | 'high';

export interface AIEnrichedItem extends DetectedItem {
  aiLabel: string;
  priority: TracePriority;
}

function inferPriorityFromItem(item: DetectedItem): TracePriority {
  if (item.type === 'return') {
    return 'high';
  }

  if (item.type === 'condition') {
    return 'medium';
  }

  // Variables muy temporales suelen aportar poco valor en trazas estratégicas.
  if (/^(i|j|k|idx|index|tmp|temp|aux)$/i.test(item.value.trim())) {
    return 'low';
  }

  return 'medium';
}

function priorityRank(priority: TracePriority): number {
  if (priority === 'high') return 3;
  if (priority === 'medium') return 2;
  return 1;
}

function rankToPriority(rank: number): TracePriority {
  if (rank >= 3) return 'high';
  if (rank === 2) return 'medium';
  return 'low';
}

function priorityScore(priority: TracePriority): number {
  if (priority === 'high') return 3;
  if (priority === 'medium') return 2;
  return 1;
}

function reconcilePriority(item: DetectedItem, aiPriority?: TracePriority): TracePriority {
  const heuristic = inferPriorityFromItem(item);
  if (!aiPriority) {
    return heuristic;
  }

  // Reconciliación conservadora para evitar que "low" termine convertido en "medium"
  // cuando la IA responde de forma genérica.
  if (aiPriority === 'high') {
    return heuristic === 'high' ? 'high' : 'medium';
  }

  if (aiPriority === 'medium') {
    return heuristic === 'low' ? 'low' : 'medium';
  }

  // aiPriority === 'low'
  return heuristic === 'high' ? 'medium' : 'low';
}

function baseItemScore(item: DetectedItem): number {
  if (item.type === 'return') return 100;
  if (item.type === 'condition') return 75;

  const value = item.value.trim();
  if (/^(i|j|k|idx|index|tmp|temp|aux)$/i.test(value)) {
    return 15;
  }

  // Variables normales
  return 50;
}

function stratifyPriorities(items: AIEnrichedItem[]): AIEnrichedItem[] {
  const n = items.length;
  if (n <= 2) {
    return ensureAtLeastOneHigh(items);
  }

  const scored = items.map((item, idx) => {
    const score = baseItemScore(item) + priorityScore(item.priority) * 10;
    return { idx, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Estratificación objetivo para diferenciar niveles de forma estable.
  const highCount = Math.max(1, Math.ceil(n * 0.2));
  const mediumCount = Math.max(1, Math.ceil(n * 0.4));

  const priorityByIndex: TracePriority[] = new Array(n).fill('low');

  for (let i = 0; i < scored.length; i++) {
    const originalIndex = scored[i].idx;
    if (i < highCount) {
      priorityByIndex[originalIndex] = 'high';
    } else if (i < highCount + mediumCount) {
      priorityByIndex[originalIndex] = 'medium';
    } else {
      priorityByIndex[originalIndex] = 'low';
    }
  }

  const stratified = items.map((item, idx) => ({
    ...item,
    priority: priorityByIndex[idx],
  }));

  return ensureAtLeastOneHigh(stratified);
}

function ensureAtLeastOneHigh(items: AIEnrichedItem[]): AIEnrichedItem[] {
  if (items.length === 0) {
    return items;
  }

  if (items.some((it) => it.priority === 'high')) {
    return items;
  }

  // Promover un candidato representativo para que el nivel "high" siempre sea util.
  const pickIndex =
    items.findIndex((it) => it.type === 'return') >= 0
      ? items.findIndex((it) => it.type === 'return')
      : items.findIndex((it) => it.type === 'condition') >= 0
      ? items.findIndex((it) => it.type === 'condition')
      : 0;

  return items.map((it, idx) => (idx === pickIndex ? { ...it, priority: 'high' } : it));
}

export async function enrichWithAI(
  items: DetectedItem[],
  codeContext: string,
  funcName?: string
): Promise<AIEnrichedItem[]> {
  const provider = getTraceSetting<string>('aiProvider', 'anthropic');

  if (provider === 'copilot') {
    return enrichWithCopilot(items, codeContext, funcName);
  }
  return enrichWithAnthropic(items, codeContext, funcName);
}

// ─── Anthropic ────────────────────────────────────────────────────────────────

async function enrichWithAnthropic(
  items: DetectedItem[],
  codeContext: string,
  funcName?: string
): Promise<AIEnrichedItem[]> {
  const apiKey = getTraceSetting<string>('anthropicApiKey', '');

  if (!apiKey) {
    vscode.window.showWarningMessage(
      'Trace: aiProvider=anthropic pero falta traceTemplateAI.anthropicApiKey en settings.'
    );
    return fallback(items);
  }

  const client = new Anthropic({ apiKey });
  const prompt = buildPrompt(items, codeContext, funcName);

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');

    return parseAIResponse(text, items);
  } catch (err) {
    vscode.window.showErrorMessage(`Trace AI (Anthropic) error: ${String(err)}`);
    return fallback(items);
  }
}

// ─── Copilot (vscode.lm) ──────────────────────────────────────────────────────

const GPT4_FAMILIES = ['gpt-4o', 'gpt-4', 'gpt-4-turbo', 'o1', 'o3'];

function isGPT4Model(model: vscode.LanguageModelChat): boolean {
  return GPT4_FAMILIES.some((f) => model.family?.toLowerCase().startsWith(f));
}

async function enrichWithCopilot(
  items: DetectedItem[],
  codeContext: string,
  funcName?: string
): Promise<AIEnrichedItem[]> {
  const requireGPT4 = getTraceSetting<boolean>('copilotRequireGPT4', true);
  const prompt = buildPrompt(items, codeContext, funcName);

  try {
    const allModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (!allModels.length) {
      vscode.window.showWarningMessage(
        'Trace: no se encontró un modelo Copilot activo. Instala GitHub Copilot y vuelve a intentarlo.'
      );
      return fallback(items);
    }

    // Mostrar modelos disponibles en consola para diagnóstico
    const modelNames = allModels.map((m) => `${m.name} (${m.family})`).join(', ');
    console.log(`[Trace AI] Modelos Copilot disponibles: ${modelNames}`);

    // Clasificar modelos por familia GPT-4
    const gpt4Models = allModels.filter(isGPT4Model);
    const nonGpt4Models = allModels.filter((m) => !isGPT4Model(m));

    let model: vscode.LanguageModelChat;

    if (requireGPT4) {
      // Modo estricto: priorizar GPT-4; si no existe, confirmar fallback.
      model = gpt4Models.length > 0 ? gpt4Models[0] : allModels[0];
      const modelLabel = `${model.name} (${model.family})`;

      // Si se requiere GPT-4 y no hay ninguno, pedir confirmación para continuar.
      if (gpt4Models.length === 0) {
        const action = await vscode.window.showWarningMessage(
          `Trace AI: No hay modelo GPT-4 disponible en Copilot. Modelo activo: ${modelLabel}. ¿Continuar igualmente con este modelo?`,
          'Continuar',
          'Cancelar'
        );
        if (action !== 'Continuar') {
          return fallback(items);
        }
      }
    } else {
      // Modo flexible: no forzar GPT-4; preferir uno no GPT-4 si existe.
      model = nonGpt4Models.length > 0 ? nonGpt4Models[0] : allModels[0];
    }

    const modelLabel = `${model.name} (${model.family})`;

    if (!requireGPT4 && gpt4Models.length > 0 && nonGpt4Models.length === 0) {
      const action = await vscode.window.showWarningMessage(
        `Trace AI: copilotRequireGPT4=false, pero solo hay modelos GPT-4 disponibles. Se usará: ${modelLabel}.`,
        'Continuar',
        'Cancelar'
      );
      if (action !== 'Continuar') {
        return fallback(items);
      }
    } else {
      vscode.window.showInformationMessage(`Trace AI usando: ${modelLabel}`);
    }

    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const response = await model.sendRequest(messages, {});

    let text = '';
    for await (const chunk of response.text) {
      text += chunk;
    }

    return parseAIResponse(text, items);
  } catch (err) {
    vscode.window.showErrorMessage(`Trace AI (Copilot) error: ${String(err)}`);
    return fallback(items);
  }
}

// ─── Shared ───────────────────────────────────────────────────────────────────

function buildPrompt(items: DetectedItem[], code: string, funcName?: string): string {
  const itemList = items
    .map((it, i) => `${i + 1}. type=${it.type}, value="${it.value}"`)
    .join('\n');

  return `You are a senior debugging assistant.

Task:
- Analyze the code context.
- Treat the detected points as trace insertion candidates.
- Identify which candidates represent KEY debugging moments (state changes, branch decisions, and return values).
- Generate one concise label for every candidate, but make labels for key moments more explicit and diagnostic.

What to prioritize as key moments:
- Variables that change critical state or business outcome.
- Conditions that split control flow (if/while/elif).
- Return expressions that determine final output.

Label requirements:
- Pattern: [DEBUG][FunctionName] Focus
- Short, specific, and useful for production debugging.
- Prefer intent-focused wording (for example: "decision", "computed", "final return", "input normalized").
- Avoid generic labels like "value" or "temp" unless there is no better option.

Priority requirements:
- Assign a priority to each candidate using only: high, medium, low.
- high: key business state changes, control-flow decisions, final returns.
- medium: useful supporting traces.
- low: noisy or redundant traces.

Code context:
\`\`\`
${code}
\`\`\`
${funcName ? `Enclosing function: ${funcName}` : ''}

Detected trace points:
${itemList}

Respond ONLY with a JSON array of objects with "index" (1-based), "label", and "priority" fields. Example:
[{"index":1,"label":"[DEBUG][CalcularLTV] decision incluye Partenon","priority":"high"},{"index":2,"label":"[DEBUG][CalcularLTV] valor normalizado","priority":"medium"}]`;
}

function parseAIResponse(text: string, items: DetectedItem[]): AIEnrichedItem[] {
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array in response');
    const parsed: Array<{ index: number; label: string; priority?: string }> = JSON.parse(jsonMatch[0]);
    const parsedMap = new Map(parsed.map((p) => [p.index, p]));

    const enriched = items.map((item, i) => {
      const ai = parsedMap.get(i + 1);
      const priority = reconcilePriority(item, normalizePriority(ai?.priority));
      return {
        ...item,
        aiLabel: ai?.label ?? item.label,
        priority,
      };
    });

    // Si la IA marcó todo al mismo nivel (p.ej., todo high), aplicar heurística por tipo
    // para recuperar diferencia real entre low/medium/high.
    const unique = new Set(enriched.map((e) => e.priority));
    if (unique.size === 1) {
      const rebalanced = enriched.map((e) => ({ ...e, priority: inferPriorityFromItem(e) }));
      return stratifyPriorities(rebalanced);
    }

    return stratifyPriorities(enriched);
  } catch {
    return fallback(items);
  }
}

function normalizePriority(priority?: string): TracePriority | undefined {
  const p = priority?.toLowerCase();
  if (p === 'high' || p === 'medium' || p === 'low') {
    return p;
  }
  return undefined;
}

function fallback(items: DetectedItem[]): AIEnrichedItem[] {
  const enriched = items.map((item) => ({
    ...item,
    aiLabel: item.label,
    priority: reconcilePriority(item),
  }));
  return stratifyPriorities(enriched);
}

// ─── Clean Code Review ────────────────────────────────────────────────────────

function buildCleanCodePrompt(code: string, langKey: string): string {
  return `Eres un experto en clean code y seguridad de software. Analiza el siguiente fragmento de código (${langKey}) y genera comentarios específicos sobre los problemas encontrados.

Criterios a evaluar:
1. Nombres claros y significativos: variables, funciones y clases deben tener nombres descriptivos.
2. Funciones con único propósito: cada función debe hacer una sola cosa.
3. Comentarios innecesarios: identifica comentarios que explican lo obvio.
4. Código muerto o redundante: código que no se usa o repite lógica innecesariamente.
5. Simplicidad: el código debe ser lo más simple posible.
6. Legibilidad sobre concisión: preferir código claro aunque sea más largo.
7. Exceso de if/else: condiciones anidadas o encadenadas que dificultan la lectura.
8. Números mágicos: valores literales sin constante nombrada que explique su significado.
9. No repetir código (DRY): lógica repetida que debería extraerse en funciones.
10. Protecciones y seguridad: validaciones de entrada, manejo de errores y posibles vulnerabilidades.

Instrucciones:
- Por cada problema encontrado indica el fragmento o línea aproximada, el tipo de problema y una sugerencia concreta.
- Si un aspecto está bien, menciónalo brevemente.
- Responde en español.
- Sé directo y específico, evita respuestas genéricas.

Código a analizar:
\`\`\`${langKey}
${code}
\`\`\``;
}

export async function reviewCleanCode(code: string, langKey: string): Promise<string> {
  const provider = getTraceSetting<string>('aiProvider', 'anthropic');

  if (provider === 'copilot') {
    return reviewCleanCodeWithCopilot(code, langKey);
  }
  return reviewCleanCodeWithAnthropic(code, langKey);
}

async function reviewCleanCodeWithAnthropic(code: string, langKey: string): Promise<string> {
  const apiKey = getTraceSetting<string>('anthropicApiKey', '');

  if (!apiKey) {
    vscode.window.showWarningMessage(
      'Trace: aiProvider=anthropic pero falta traceTemplateAI.anthropicApiKey en settings.'
    );
    return '';
  }

  const client = new Anthropic({ apiKey });
  const prompt = buildCleanCodePrompt(code, langKey);

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    return message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');
  } catch (err) {
    vscode.window.showErrorMessage(`Trace AI (Anthropic) error: ${String(err)}`);
    return '';
  }
}

async function reviewCleanCodeWithCopilot(code: string, langKey: string): Promise<string> {
  const requireGPT4 = getTraceSetting<boolean>('copilotRequireGPT4', true);
  const prompt = buildCleanCodePrompt(code, langKey);

  try {
    const allModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (!allModels.length) {
      vscode.window.showWarningMessage(
        'Trace: no se encontró un modelo Copilot activo. Instala GitHub Copilot y vuelve a intentarlo.'
      );
      return '';
    }

    const gpt4Models = allModels.filter(isGPT4Model);
    let model: vscode.LanguageModelChat;

    if (requireGPT4) {
      model = gpt4Models.length > 0 ? gpt4Models[0] : allModels[0];
      if (gpt4Models.length === 0) {
        const modelLabel = `${model.name} (${model.family})`;
        const action = await vscode.window.showWarningMessage(
          `Trace AI: No hay modelo GPT-4 disponible. Modelo activo: ${modelLabel}. ¿Continuar igualmente?`,
          'Continuar',
          'Cancelar'
        );
        if (action !== 'Continuar') {
          return '';
        }
      }
    } else {
      const nonGpt4Models = allModels.filter((m) => !isGPT4Model(m));
      model = nonGpt4Models.length > 0 ? nonGpt4Models[0] : allModels[0];
    }

    const modelLabel = `${model.name} (${model.family})`;
    vscode.window.showInformationMessage(`Trace AI usando: ${modelLabel}`);

    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const response = await model.sendRequest(messages, {});

    let text = '';
    for await (const chunk of response.text) {
      text += chunk;
    }
    return text;
  } catch (err) {
    vscode.window.showErrorMessage(`Trace AI (Copilot) error: ${String(err)}`);
    return '';
  }
}
