/** Quick Check: reviewed study tasks, timed recall and item-based standalone
 * questions. Surface-specific results follow HOST_CONTRACT.md section 6. */
import { getExperienceHost, type ExperienceResult } from '@mnemonexus/addon-sdk';
import { installUi } from '@mnemonexus/addon-ui';
import { exerciseKey, loadTasks, questionsFromItems, type Exercise, type Question } from './exercise';

// Must match surfaces.recall.maxSeconds in manifest.json. The host does not
// pass it in props, so the add-on keeps its own copy.
const RECALL_SECONDS = 60;
const RECALL_QUESTIONS = 3;

// Unsupported protocol or study capabilities fail the launch.
const mnx = getExperienceHost();
const { props } = mnx;
const can = (permission: string) => props.permissions.includes(permission as never);

// Settings may change mid-run without rebuilding the exercise.
let showHints = props.settings?.showHints !== false;
mnx.onUpdate(next => {
  showHints = next.settings?.showHints !== false;
  document.querySelectorAll<HTMLButtonElement>('[data-action=hint]').forEach(hint => { hint.hidden = !showHints; });
});

// Use theme-aware components and keep the frame background transparent.
installUi();

/** Everything a draft needs to resume: where we are and what we have counted. */
interface Progress { index: number; solved: string[]; firstTry: string[]; attempts: number; hintsUsed: number; elapsed: number }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  // Render item text and model replies as text, not HTML.
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(label: string, variant: 'primary' | 'secondary' | 'ghost', action: string): HTMLButtonElement {
  const node = el('button', `mnx-button mnx-button--${variant}`, label);
  node.type = 'button';
  node.dataset.action = action;
  return node;
}

// Study drafts persist per subsection and task; other drafts last for the session.
// Storage is optional, and a failure must not interrupt the exercise.
function draftStore(key: string) {
  const enabled = can('storage:local');
  return {
    async load(): Promise<Progress | null> {
      if (!enabled) return null;
      try {
        const raw = await mnx.storage.get(key);
        return raw ? JSON.parse(raw) as Progress : null;
      } catch { return null; }
    },
    async save(progress: Progress) {
      if (enabled) await mnx.storage.set(key, JSON.stringify(progress)).catch(() => undefined);
    },
    async clear() {
      if (enabled) await mnx.storage.delete(key).catch(() => undefined);
    },
  };
}

// Create blob URLs for pack images; CSP allows only data: and blob: sources.
async function assetUrl(path: string, type: string): Promise<string | null> {
  try {
    return URL.createObjectURL(new Blob([await mnx.asset(path)], { type }));
  } catch {
    return null; // decorative: carry on without it
  }
}

// Model hints require ai:generate. Use the built-in hint if the call fails.
async function hintFor(question: Question): Promise<{ text: string; fromModel: boolean }> {
  if (!can('ai:generate')) return { text: question.hint, fromModel: false };
  try {
    const reply = await mnx.generate({
      system: 'You are a tutor. Give a one-sentence hint. Do not give the answer.',
      prompt: `Hint for: ${question.prompt}\nOptions: ${question.choices.map(c => c.label).join('; ')}`,
    });
    const text = String(reply).trim();
    return text ? { text, fromModel: true } : { text: question.hint, fromModel: false };
  } catch {
    return { text: question.hint, fromModel: false };
  }
}

// ── Choosing the exercise ──────────────────────────────────────────────────
async function chooseExercise(): Promise<Exercise | null> {
  const tasks = await loadTasks(mnx.asset);
  if (props.surface === 'study') {
    // Study tasks use reviewed pack content selected by task ID.
    return tasks.tasks[props.study!.taskId] ?? null;
  }
  const fromItems = questionsFromItems(props.items);
  const questions = fromItems.length ? fromItems : tasks.sample.questions;
  return {
    title: fromItems.length ? 'Quick Check' : tasks.sample.title,
    intro: fromItems.length ? 'Which concept does each description belong to?' : tasks.sample.intro,
    questions: props.surface === 'recall' ? questions.slice(0, RECALL_QUESTIONS) : questions,
  };
}

// ── The run ────────────────────────────────────────────────────────────────
async function main() {
  const exercise = await chooseExercise();
  if (!exercise || !exercise.questions.length) {
    return showMessage('Nothing to practise here', 'This add-on has no questions for this launch.');
  }
  const questions = exercise.questions;
  const drafts = draftStore(`draft:${props.surface}:${exerciseKey(questions)}`);
  const resumed = await drafts.load();
  const progress: Progress = resumed ?? { index: 0, solved: [], firstTry: [], attempts: 0, hintsUsed: 0, elapsed: 0 };
  const sessionStart = Date.now();
  const elapsedSeconds = () => Math.min(86400, progress.elapsed + Math.round((Date.now() - sessionStart) / 1000));
  const save = () => drafts.save({ ...progress, elapsed: elapsedSeconds() });

  const illustration = await assetUrl('assets/illustration.svg', 'image/svg+xml');

  // Section content is optional; check study-section-v1 before using it.
  const section = mnx.capabilities?.includes('study-section-v1') ? props.study?.section : undefined;

  const root = el('main', 'mnx-column');
  root.dataset.view = 'check';
  mnx.root.replaceChildren(root);

  const hero = el('header', 'mnx-row');
  if (illustration) {
    const img = el('img');
    img.src = illustration;
    img.alt = '';
    img.width = img.height = 56;
    hero.append(img);
  }
  const heading = el('div', 'mnx-stack');
  heading.style.gap = '0.25rem';
  heading.append(el('h1', 'mnx-title', exercise.title), el('p', 'mnx-muted', exercise.intro));
  hero.append(heading);
  root.append(hero);
  if (section?.objective) root.append(el('p', 'mnx-muted', `This section: ${section.objective}`));
  if (resumed) root.append(el('p', 'mnx-muted', 'Welcome back. You are where you left off.'));

  const progressBar = el('div', 'mnx-progress');
  progressBar.setAttribute('role', 'progressbar');
  progressBar.setAttribute('aria-label', 'Questions answered');
  progressBar.setAttribute('aria-valuemin', '0');
  progressBar.setAttribute('aria-valuemax', String(questions.length));
  const fill = el('div', 'mnx-progress__fill');
  progressBar.append(fill);
  const card = el('section', 'mnx-card');
  const cardHeader = el('div', 'mnx-card__header');
  const cardBody = el('div', 'mnx-card__body');
  card.append(cardHeader, cardBody);
  const timer = el('p', 'mnx-muted');
  root.append(progressBar, card, timer);

  // 1 for right first time, 0.5 for right after a miss, 0 for not reached.
  function coverage(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const q of questions) {
      if (q.lineageId) result[q.lineageId] = progress.firstTry.includes(q.id) ? 1 : progress.solved.includes(q.id) ? 0.5 : 0;
    }
    return result;
  }

  let finished = false;
  async function finish() {
    if (finished) return;
    finished = true;
    clearInterval(clock);
    await drafts.clear();
    const total = questions.length;
    const quality = Math.round((progress.firstTry.length / total) * 5);
    const result: ExperienceResult = props.surface === 'study'
      ? {
        completed: true,
        elapsedSeconds: elapsedSeconds(),
        // The host checks every field here against props.study, and keeps
        // only this, completed and elapsedSeconds. It records practice only.
        studyEvidence: {
          runId: props.study!.runId,
          taskId: props.study!.taskId,
          contextFingerprint: props.study!.contextFingerprint,
          solvedStepIds: progress.solved.slice(0, 128),
          attempts: progress.attempts,
          hintsUsed: progress.hintsUsed,
        },
      }
      // quality is required on recall and harmless elsewhere. itemCoverage is
      // keyed by each item's lineageId (not itemId), from 0 to 1.
      : { completed: progress.solved.length === total, elapsedSeconds: elapsedSeconds(), quality, completedStages: ['quick-check'],
        ...(questions.some(q => q.lineageId) ? { itemCoverage: coverage() } : {}) };
    mnx.complete(result);
    showMessage('Done', `You answered ${progress.firstTry.length} of ${total} on the first try.`);
  }

  // Recall is timed: when time runs out, hand back what we have.
  const deadline = Date.now() + Math.max(0, RECALL_SECONDS - progress.elapsed) * 1000;
  const clock = props.surface !== 'recall' ? undefined : setInterval(() => {
    const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    timer.textContent = `${left} s left`;
    if (left === 0) void finish();
  }, 500);

  function render() {
    const total = questions.length;
    fill.style.width = `${Math.round((progress.solved.length / total) * 100)}%`;
    progressBar.setAttribute('aria-valuenow', String(progress.solved.length));
    if (progress.index >= total) return renderSummary();
    const question = questions[progress.index];
    cardHeader.replaceChildren(el('span', 'mnx-badge', `Question ${progress.index + 1} of ${total}`));
    const feedback = el('p', 'mnx-feedback');
    feedback.setAttribute('role', 'status'); // read out by screen readers
    const choices = el('div', 'mnx-choices');
    choices.setAttribute('role', 'group');
    choices.setAttribute('aria-label', 'Answers');
    question.choices.forEach((choice, i) => {
      const option = el('button', 'mnx-choice');
      option.type = 'button';
      option.dataset.action = 'choose';
      option.dataset.choice = choice.id;
      option.append(el('span', 'mnx-choice__key', String(i + 1)), el('span', 'mnx-choice__text', choice.label));
      option.addEventListener('click', () => choose(choice.id, option, feedback));
      choices.append(option);
    });
    const hint = button('Hint (H)', 'ghost', 'hint');
    hint.hidden = !showHints;
    hint.addEventListener('click', async () => {
      hint.disabled = true;
      feedback.className = 'mnx-feedback';
      feedback.textContent = 'Thinking…';
      const { text, fromModel } = await hintFor(question);
      progress.hintsUsed++;
      feedback.className = 'mnx-feedback mnx-feedback--hint';
      feedback.textContent = fromModel ? text : `Hint: ${text}`;
      void save();
    });
    const leave = button('Leave', 'ghost', 'leave');
    // exit() ends the run without a result. The draft stays, so the user can resume.
    leave.addEventListener('click', async () => { await save(); mnx.exit(); });
    const actions = el('div', 'mnx-row');
    actions.dataset.role = 'actions';
    actions.append(hint, leave);
    cardBody.replaceChildren(el('p', 'mnx-text', question.prompt), choices, feedback, actions);
    (choices.firstElementChild as HTMLElement | null)?.focus();
  }

  let triedThisQuestion = false;
  function choose(choiceId: string, option: HTMLButtonElement, feedback: HTMLElement) {
    const question = questions[progress.index];
    if (choiceId !== question.answer) {
      progress.attempts++;
      triedThisQuestion = true;
      option.disabled = true;
      option.dataset.state = 'incorrect';
      feedback.className = 'mnx-feedback mnx-feedback--incorrect';
      feedback.textContent = 'Not quite. Try another.';
      void save();
      return;
    }
    if (!progress.solved.includes(question.id)) progress.solved.push(question.id);
    if (!triedThisQuestion && !progress.firstTry.includes(question.id)) progress.firstTry.push(question.id);
    triedThisQuestion = false;
    progress.index++;
    void save();
    option.dataset.state = 'correct';
    feedback.className = 'mnx-feedback mnx-feedback--correct';
    feedback.textContent = 'Correct.';
    const next = button(progress.index >= questions.length ? 'See results' : 'Next', 'primary', 'next');
    next.addEventListener('click', render);
    cardBody.querySelectorAll<HTMLButtonElement>('[data-action=choose]').forEach(b => { b.disabled = true; });
    cardBody.querySelector('[data-role=actions]')!.prepend(next);
    next.focus();
  }

  function renderSummary() {
    cardHeader.replaceChildren(el('span', 'mnx-badge mnx-badge--success', 'All done'));
    const done = button('Finish', 'primary', 'finish');
    done.addEventListener('click', () => void finish());
    const actions = el('div', 'mnx-row');
    actions.append(done);
    cardBody.replaceChildren(
      el('p', 'mnx-text', `${progress.firstTry.length} of ${questions.length} right on the first try. ${progress.hintsUsed} hint(s) used.`),
      actions);
    done.focus();
  }

  // Keyboard: 1-4 pick a choice, H asks for a hint. Buttons handle Enter and Space.
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const choices = cardBody.querySelectorAll<HTMLButtonElement>('[data-action=choose]');
    const n = Number(event.key);
    if (n >= 1 && n <= choices.length && !choices[n - 1].disabled) choices[n - 1].click();
    if (event.key.toLowerCase() === 'h') cardBody.querySelector<HTMLButtonElement>('[data-action=hint]:not(:disabled):not([hidden])')?.click();
  });

  render();
}

function showMessage(title: string, text: string, tone: 'empty' | 'error' = 'empty') {
  const box = el('main', 'mnx-column');
  const card = el('div', tone === 'error' ? 'mnx-error' : 'mnx-empty');
  if (tone === 'error') card.setAttribute('role', 'alert');
  card.append(el('h1', `mnx-${tone}__title`, title), el('p', `mnx-${tone}__text`, text));
  const leave = button('Close', 'secondary', 'leave');
  leave.addEventListener('click', () => mnx.exit());
  const actions = el('div', 'mnx-row');
  actions.append(leave);
  card.append(actions);
  box.append(card);
  mnx.root.replaceChildren(box);
}

// Show recoverable errors and let the user exit. Uncaught errors fail the run.
main().catch(error => {
  showMessage('Something went wrong', error instanceof Error ? error.message : String(error), 'error');
});
