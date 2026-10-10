/**
 * The UI gallery: every component of @mnemonexus/addon-ui, in the current
 * theme. It uses the library's classes and nothing else, so what you see here
 * is what an add-on gets.
 */
import { getExperienceHost } from '@mnemonexus/addon-sdk';
import { installUi } from '@mnemonexus/addon-ui';

const mnx = getExperienceHost();
const startedAt = Date.now();
installUi();

type Child = Node | string;
/** Build an element. Text always goes in as text, never as HTML. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'class') node.className = value;
    else node.setAttribute(name, value);
  }
  node.append(...children);
  return node;
}
function button(label: string, classes = '', attrs: Record<string, string> = {}) {
  return el('button', { type: 'button', class: `mnx-button ${classes}`.trim(), ...attrs }, label);
}
function section(id: string, title: string, intro: string, ...body: Child[]) {
  return el('section', { class: 'mnx-card', 'data-section': id, 'aria-labelledby': `h-${id}` },
    el('div', { class: 'mnx-card__header' }, el('h2', { class: 'mnx-subtitle', id: `h-${id}` }, title)),
    el('div', { class: 'mnx-card__body' }, el('p', { class: 'mnx-muted' }, intro), ...body));
}

// ── Buttons ────────────────────────────────────────────────────────────────
const buttons = section('buttons', 'Buttons', 'Primary, secondary, ghost and danger, in two sizes.',
  el('div', { class: 'mnx-row' },
    button('Primary', 'mnx-button--primary'), button('Secondary', 'mnx-button--secondary'),
    button('Ghost', 'mnx-button--ghost'), button('Danger', 'mnx-button--danger')),
  el('div', { class: 'mnx-row' },
    button('Small primary', 'mnx-button--primary mnx-button--sm'), button('Small secondary', 'mnx-button--secondary mnx-button--sm'),
    button('Small ghost', 'mnx-button--ghost mnx-button--sm'), button('Small danger', 'mnx-button--danger mnx-button--sm')),
  el('div', { class: 'mnx-row' },
    el('button', { type: 'button', class: 'mnx-button mnx-button--primary', disabled: '' }, 'Disabled'),
    el('span', { class: 'mnx-muted' }, 'Keys: ', el('kbd', { class: 'mnx-kbd' }, 'Enter'), ' or ', el('kbd', { class: 'mnx-kbd' }, 'Space'), '.')));

// ── Surfaces and cards ─────────────────────────────────────────────────────
const surfaces = section('surfaces', 'Surfaces and cards', 'Their edges are the theme\'s: lines, shadows, both or none.',
  el('div', { class: 'mnx-surface' },
    el('p', { class: 'mnx-text' }, 'A surface. '), el('div', { class: 'mnx-surface mnx-surface--inset' }, el('p', { class: 'mnx-text' }, 'An inset surface inside it.'))),
  el('article', { class: 'mnx-card' },
    el('div', { class: 'mnx-card__header' }, el('h3', { class: 'mnx-subtitle' }, 'A card'), el('span', { class: 'mnx-badge mnx-badge--accent' }, 'New')),
    el('div', { class: 'mnx-card__body' }, el('p', { class: 'mnx-text' }, 'Header, body and footer. Dividers inside a card use the inner border colour.')),
    el('div', { class: 'mnx-card__footer' }, button('Cancel', 'mnx-button--ghost mnx-button--sm'), button('Save', 'mnx-button--primary mnx-button--sm'))));

// ── Choice list ────────────────────────────────────────────────────────────
const single = el('div', { class: 'mnx-choices', role: 'group', 'aria-label': 'Single choice' });
for (const [id, text] of [['a', 'Mitochondrion'], ['b', 'Ribosome'], ['c', 'Golgi apparatus']] as const) {
  const choice = el('button', { type: 'button', class: 'mnx-choice', 'aria-pressed': 'false', 'data-choice': id },
    el('span', { class: 'mnx-choice__key' }, String('abc'.indexOf(id) + 1)), el('span', { class: 'mnx-choice__text' }, text));
  choice.addEventListener('click', () => {
    for (const other of single.querySelectorAll('[data-choice]')) other.setAttribute('aria-pressed', String(other === choice));
  });
  single.append(choice);
}
const answered = el('div', { class: 'mnx-choices', role: 'group', 'aria-label': 'After an answer' },
  el('button', { type: 'button', class: 'mnx-choice', 'data-state': 'incorrect', disabled: '' }, el('span', { class: 'mnx-choice__key' }, '1'), el('span', { class: 'mnx-choice__text' }, 'Lysosome')),
  el('button', { type: 'button', class: 'mnx-choice', 'data-state': 'correct', disabled: '' }, el('span', { class: 'mnx-choice__key' }, '2'), el('span', { class: 'mnx-choice__text' }, 'Mitochondrion')),
  el('button', { type: 'button', class: 'mnx-choice', disabled: '' }, el('span', { class: 'mnx-choice__key' }, '3'), el('span', { class: 'mnx-choice__text' }, 'Nucleus (out of play)')));
const radios = el('fieldset', { class: 'mnx-choices' }, el('legend', { class: 'mnx-label' }, 'Native radios: arrow keys move between them'),
  ...['Core', 'Standard', 'Deep'].map((label, i) => el('label', { class: 'mnx-choice' },
    el('input', { type: 'radio', name: 'depth', value: label.toLowerCase(), ...(i === 1 ? { checked: '' } : {}) }), el('span', { class: 'mnx-choice__text' }, label))));
const checks = el('fieldset', { class: 'mnx-choices' }, el('legend', { class: 'mnx-label' }, 'Multiple choice: Space toggles'),
  ...[['storage', 'Saves drafts with mnx.storage'], ['text', 'Puts text in with textContent'], ['eval', 'Uses eval']].map(([id, label]) =>
    el('label', { class: 'mnx-choice' }, el('input', { type: 'checkbox', 'data-check': id }), el('span', { class: 'mnx-choice__text' }, label))));
const choices = section('choices', 'Choice list', 'Single and multiple choice, from buttons or native inputs, with keyboard focus, selected, correct and incorrect states.',
  single, answered, radios, checks);

// ── Fields ─────────────────────────────────────────────────────────────────
const nameInput = el('input', { class: 'mnx-input', id: 'gallery-name', placeholder: 'Your name', autocomplete: 'off' });
const nameFeedback = el('p', { class: 'mnx-feedback', role: 'status', 'data-feedback': 'name' });
const checkName = button('Say hello', 'mnx-button--secondary mnx-button--sm', { 'data-action': 'check-name' });
checkName.addEventListener('click', () => {
  const name = nameInput.value.trim();
  nameInput.setAttribute('aria-invalid', String(!name));
  nameFeedback.className = `mnx-feedback ${name ? 'mnx-feedback--correct' : 'mnx-feedback--incorrect'}`;
  nameFeedback.textContent = name ? `Hello, ${name}.` : 'Type a name first.';
});
const fields = section('fields', 'Fields', 'Text fields, a select and a text area, with help and error text.',
  el('div', { class: 'mnx-field' }, el('label', { class: 'mnx-label', for: 'gallery-name' }, 'Name'), nameInput,
    el('p', { class: 'mnx-help' }, 'Help text sits under the field.')),
  el('div', { class: 'mnx-row' }, checkName), nameFeedback,
  el('div', { class: 'mnx-field' }, el('label', { class: 'mnx-label', for: 'gallery-depth' }, 'Reading depth'),
    el('select', { class: 'mnx-select', id: 'gallery-depth' }, el('option', {}, 'Core'), el('option', {}, 'Standard'), el('option', {}, 'Deep'))),
  el('div', { class: 'mnx-field' }, el('label', { class: 'mnx-label', for: 'gallery-notes' }, 'Notes'),
    el('textarea', { class: 'mnx-textarea', id: 'gallery-notes', placeholder: 'Anything to remember?' })),
  el('div', { class: 'mnx-field' }, el('label', { class: 'mnx-label', for: 'gallery-bad' }, 'With an error'),
    el('input', { class: 'mnx-input', id: 'gallery-bad', value: '12 apples', 'aria-invalid': 'true', 'aria-describedby': 'gallery-bad-help' }),
    el('p', { class: 'mnx-help mnx-help--error', id: 'gallery-bad-help' }, 'Enter a whole number.')),
  el('div', { class: 'mnx-field' }, el('label', { class: 'mnx-label', for: 'gallery-off' }, 'Disabled'),
    el('input', { class: 'mnx-input', id: 'gallery-off', value: 'Not editable', disabled: '' })));

// ── Badges and chips ───────────────────────────────────────────────────────
const chipRow = el('div', { class: 'mnx-row', role: 'group', 'aria-label': 'Data colours' });
for (let n = 1; n <= 10; n++) {
  const chip = el('button', { type: 'button', class: 'mnx-chip', 'data-color': String(n), 'data-chip': String(n), 'aria-pressed': 'false' },
    el('span', { class: 'mnx-chip__dot' }), `Series ${n}`);
  chip.addEventListener('click', () => chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true')));
  chipRow.append(chip);
}
const badges = section('badges', 'Badges and chips', 'Status lives in the border and tint; text stays the text colour. Chips take the data palette, which follows "More colours".',
  el('div', { class: 'mnx-row' },
    el('span', { class: 'mnx-badge' }, 'Default'), el('span', { class: 'mnx-badge mnx-badge--accent' }, 'Accent'),
    el('span', { class: 'mnx-badge mnx-badge--success' }, 'Success'), el('span', { class: 'mnx-badge mnx-badge--warning' }, 'Warning'),
    el('span', { class: 'mnx-badge mnx-badge--danger' }, 'Danger'), el('span', { class: 'mnx-badge mnx-badge--neutral' }, 'Neutral')),
  el('div', { class: 'mnx-row' },
    el('span', { class: 'mnx-chip' }, 'A plain chip'), el('span', { class: 'mnx-chip' }, el('span', { class: 'mnx-chip__dot' }), 'With a dot'),
    el('button', { type: 'button', class: 'mnx-chip', 'aria-pressed': 'true' }, 'Selected')),
  chipRow);

// ── Progress ───────────────────────────────────────────────────────────────
const progress = section('progress', 'Progress', 'A bar, and steps.',
  el('div', { class: 'mnx-stack' },
    el('div', { class: 'mnx-row mnx-row--between' }, el('span', { class: 'mnx-label' }, 'Questions answered'), el('span', { class: 'mnx-muted' }, '2 of 5')),
    el('div', { class: 'mnx-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '5', 'aria-valuenow': '2', 'aria-label': 'Questions answered' },
      el('div', { class: 'mnx-progress__fill', style: 'width: 40%' }))),
  el('ol', { class: 'mnx-steps', 'aria-label': 'Steps' },
    el('li', { class: 'mnx-step', 'data-state': 'done' }, 'Read'), el('li', { class: 'mnx-step', 'data-state': 'done' }, 'Recall'),
    el('li', { class: 'mnx-step', 'data-state': 'current', 'aria-current': 'step' }, 'Practise'), el('li', { class: 'mnx-step', 'data-state': 'todo' }, 'Review')));

// ── Feedback ───────────────────────────────────────────────────────────────
const feedback = section('feedback', 'Feedback', 'After an answer, a hint, nothing yet, or an error.',
  el('p', { class: 'mnx-feedback mnx-feedback--correct', role: 'status' }, 'Correct. The mitochondrion makes most of the cell\'s ATP.'),
  el('p', { class: 'mnx-feedback mnx-feedback--incorrect' }, 'Not quite. Try another.'),
  el('p', { class: 'mnx-feedback mnx-feedback--hint' }, 'Hint: think about which organelle uses oxygen.'),
  el('p', { class: 'mnx-feedback' }, el('span', {}, el('strong', { class: 'mnx-feedback__title' }, 'Plain'), 'A neutral note, with a title.')),
  el('div', { class: 'mnx-empty' }, el('p', { class: 'mnx-empty__title' }, 'Nothing to practise here'), el('p', { class: 'mnx-empty__text' }, 'Open a study session with an ordered process.')),
  el('div', { class: 'mnx-error', role: 'alert' }, el('p', { class: 'mnx-error__title' }, 'Something went wrong'),
    el('p', { class: 'mnx-error__text' }, 'The tasks could not be read. Leave and try again.'),
    el('div', { class: 'mnx-row' }, button('Leave', 'mnx-button--secondary mnx-button--sm'))));

// ── Text and layout ────────────────────────────────────────────────────────
const text = section('text', 'Text and layout', 'Everything here sits in a centred column (mnx-column), with stacks and rows inside.',
  el('p', { class: 'mnx-title' }, 'A title'), el('p', { class: 'mnx-subtitle' }, 'A subtitle'),
  el('p', { class: 'mnx-text' }, 'Body text in the theme\'s font and colour.'),
  el('p', { class: 'mnx-muted' }, 'Muted text, for less important details.'),
  el('hr', { class: 'mnx-divider' }),
  el('p', { class: 'mnx-text' }, 'A key: ', el('kbd', { class: 'mnx-kbd' }, 'H'), ' asks for a hint.'));

// ── Page ───────────────────────────────────────────────────────────────────
const finish = button('Finish', 'mnx-button--primary', { 'data-action': 'finish' });
finish.addEventListener('click', () => mnx.complete({ completed: true, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000) }));
const leave = button('Leave', 'mnx-button--ghost', { 'data-action': 'leave' });
leave.addEventListener('click', () => mnx.exit());

mnx.root.replaceChildren(el('main', { class: 'mnx-column mnx-column--wide' },
  el('header', { class: 'mnx-stack' }, el('h1', { class: 'mnx-title' }, 'UI gallery'),
    el('p', { class: 'mnx-muted' }, 'Every component of @mnemonexus/addon-ui, in the current theme. Change the Appearance panel to see them follow it.')),
  buttons, surfaces, choices, fields, badges, progress, feedback, text,
  el('div', { class: 'mnx-row mnx-row--end' }, leave, finish)));
