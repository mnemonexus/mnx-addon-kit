/** Source-based ordering exercise. defineAddon dispatches preparation,
 * selected activities and standalone sequence-item launches. */
import type { ExperienceHost, ExperienceResult, KnowledgeItem } from '@mnemonexus/addon-sdk';
import { defineAddon, type LearningContribution } from '@mnemonexus/addon-sdk/learning';
import { installUi } from '@mnemonexus/addon-ui';
import manifest from '../manifest.json';
import { extractSequences, offerSequences } from './prepare';

// The declaration lives in manifest.json, so the pack and the code never disagree.
const learning = manifest.learning as unknown as LearningContribution;

// Install styles on first render; preparation jobs may run without a DOM.
const ensureStyle = () => installUi();

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  // Source steps are untrusted text: always textContent.
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text: string, action: string, handler: () => void, variant: 'primary' | 'secondary' | 'ghost' = 'secondary') {
  const node = element('button', text, `mnx-button mnx-button--${variant}`);
  node.type = 'button';
  node.dataset.action = action;
  node.addEventListener('click', handler);
  return node;
}

interface Progress { selected: number[]; attempts: number; hintsUsed: number }

/**
 * The ordering exercise. Progress is saved after every change and restored on
 * relaunch; a draft that doesn't fit these steps is ignored.
 */
async function orderExercise(host: ExperienceHost, options: {
  steps: string[]; draftKey: string; intro: string; finish(progress: Progress, elapsedSeconds: number): void;
}) {
  const { steps } = options;
  const startedAt = Date.now();
  let progress: Progress = { selected: [], attempts: 0, hintsUsed: 0 };
  let status = '';
  const canSave = host.props.permissions.includes('storage:local');
  if (canSave) {
    try {
      const draft = JSON.parse(await host.storage.get(options.draftKey) ?? 'null');
      if (draft && Array.isArray(draft.selected) && draft.selected.every((index: unknown) => Number.isInteger(index) && (index as number) >= 0 && (index as number) < steps.length) &&
          new Set(draft.selected).size === draft.selected.length && Number.isInteger(draft.attempts) && draft.attempts >= 0 &&
          Number.isInteger(draft.hintsUsed) && draft.hintsUsed >= 0) {
        progress = { selected: draft.selected, attempts: draft.attempts, hintsUsed: draft.hintsUsed };
      }
    } catch { status = 'Saved progress could not be read.'; }
  }
  async function save() {
    if (!canSave) return;
    try { await host.storage.set(options.draftKey, JSON.stringify(progress)); } catch { status = 'Progress could not be saved.'; }
  }
  // What the last action said, and how: a hint, a wrong order, or a plain note.
  let tone: 'hint' | 'incorrect' | '' = '';
  function draw() {
    ensureStyle();
    const root = element('main', undefined, 'mnx-column');
    const header = element('header', undefined, 'mnx-stack');
    header.append(element('h2', 'Order the process', 'mnx-title'), element('p', options.intro, 'mnx-muted'));
    const card = element('section', undefined, 'mnx-card');
    const cardHeader = element('div', undefined, 'mnx-card__header');
    cardHeader.append(element('span', `${progress.selected.length} of ${steps.length} placed`, 'mnx-badge'));
    const body = element('div', undefined, 'mnx-card__body');
    const chosen = element('ol', undefined, 'mnx-text');
    chosen.setAttribute('aria-label', 'Your order so far');
    for (const index of progress.selected) chosen.append(element('li', steps[index]));
    if (progress.selected.length) body.append(chosen);
    const choices = element('div', undefined, 'mnx-choices');
    choices.setAttribute('role', 'group');
    choices.setAttribute('aria-label', 'Choose the next step');
    // A stable rotation that always differs from the source order and survives relaunch.
    const shuffled = [...steps.keys()].slice(1).reverse().concat(0);
    for (const index of shuffled) {
      if (progress.selected.includes(index)) continue;
      const choice = element('button', undefined, 'mnx-choice');
      choice.type = 'button';
      choice.dataset.action = 'choose';
      choice.dataset.step = String(index);
      choice.append(element('span', steps[index], 'mnx-choice__text'));
      choice.addEventListener('click', async () => { progress.selected.push(index); status = ''; tone = ''; await save(); draw(); });
      choices.append(choice);
    }
    if (choices.childElementCount) body.append(choices);
    const feedback = element('p', status, `mnx-feedback${tone ? ` mnx-feedback--${tone}` : ''}`);
    feedback.setAttribute('role', 'status');
    body.append(feedback);
    const actions = element('div', undefined, 'mnx-row');
    if (progress.selected.length === steps.length) {
      actions.append(button('Check order', 'check', async () => {
        progress.attempts++;
        await save();
        if (progress.selected.some((value, index) => value !== index)) { status = 'Some steps are out of order. Try again.'; tone = 'incorrect'; draw(); return; }
        if (canSave) await host.storage.delete(options.draftKey).catch(() => undefined);
        options.finish(progress, Math.round((Date.now() - startedAt) / 1000));
      }, 'primary'));
    } else {
      actions.append(button('Hint', 'hint', async () => {
        progress.hintsUsed++;
        status = `Step ${progress.selected.length + 1}: ${steps[progress.selected.length]}`;
        tone = 'hint';
        await save();
        draw();
      }, 'ghost'));
    }
    if (progress.selected.length) actions.append(button('Start again', 'restart', async () => { progress.selected = []; status = ''; tone = ''; await save(); draw(); }));
    actions.append(button('Return', 'return', () => host.exit(), 'ghost'));
    body.append(actions);
    card.append(cardHeader, body);
    root.append(header, card);
    host.root.replaceChildren(root);
    (choices.querySelector('button') ?? actions.querySelector('button'))?.focus();
  }
  draw();
}

/** A launched offer: the steps come from the source, as prepared. */
async function renderActivity(host: ExperienceHost) {
  const { offer } = host.props.learningActivity!;
  const { steps } = offer.payload as { steps: string[] };
  await orderExercise(host, {
    steps, draftKey: `process-draft:${offer.id}`, intro: 'Choose the next step. The order comes directly from your source.',
    finish(progress, elapsedSeconds) {
      const study = host.props.study;
      const result: ExperienceResult = {
        completed: true, elapsedSeconds,
        ...(study ? { studyEvidence: { runId: study.runId, taskId: study.taskId, contextFingerprint: study.contextFingerprint,
          solvedStepIds: steps.map((_, index) => `step-${index + 1}`), attempts: progress.attempts, hintsUsed: progress.hintsUsed } } : {}),
      };
      host.complete(result);
    },
  });
}

/** Opened directly: use a knowledge item that states an order, if there is one. */
async function renderStandalone(host: ExperienceHost) {
  const item: KnowledgeItem | undefined = host.props.items.find(entry => entry.descriptorStructure === 'sequence' &&
    entry.structuredItems.length >= 3 && entry.structuredItems.length <= 12 && entry.structuredItems.every(step => step.trim()));
  if (item) {
    await orderExercise(host, {
      steps: [...item.structuredItems], draftKey: `process-draft:item:${item.lineageId}`, intro: `${item.conceptTitle}: put the steps in order.`,
      finish(progress, elapsedSeconds) {
        // itemCoverage is keyed by lineageId: right first time counts fully.
        host.complete({ completed: true, elapsedSeconds, itemCoverage: { [item.lineageId]: progress.attempts === 1 ? 1 : 0.5 } });
      },
    });
    return;
  }
  ensureStyle();
  const root = element('main', undefined, 'mnx-column');
  const message = element('div', undefined, 'mnx-empty');
  const actions = element('div', undefined, 'mnx-row');
  actions.append(button('Return', 'return', () => host.exit()));
  message.append(element('h2', 'Process Builder', 'mnx-empty__title'),
    element('p', 'Open a study session containing an ordered process. This experience uses explicit source sequences rather than inventing an order.', 'mnx-empty__text'),
    actions);
  root.append(message);
  host.root.replaceChildren(root);
}

void defineAddon({ learning, extract: extractSequences, offerActivities: offerSequences, renderActivity, renderStandalone });
