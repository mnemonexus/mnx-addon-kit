/** Item-based flashcards styled with the MnemoNexus Tailwind preset. */
import { getExperienceHost } from '@mnemonexus/addon-sdk';
import './styles.css';

const mnx = getExperienceHost();
const startedAt = Date.now();
const cards = mnx.props.items.map(item => ({ lineageId: item.lineageId, front: item.conceptTitle || 'Untitled', back: item.text }));
const known = new Set<string>();
let index = 0;
let flipped = false;

// Shared class lists. Tailwind finds class names anywhere in the source.
const BUTTON = 'inline-flex items-center justify-center min-h-10 px-4 rounded-mnx-button font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mnx-focus';
const PRIMARY = `${BUTTON} bg-mnx-accent text-mnx-accent-text hover:bg-mnx-accent-strong`;
const SECONDARY = `${BUTTON} bg-mnx-surface-2 text-mnx-text border border-mnx-border-inner hover:bg-mnx-surface`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text; // item text is untrusted: never innerHTML
  return node;
}
function button(label: string, className: string, action: string, onClick: () => void) {
  const node = el('button', className, label);
  node.type = 'button';
  node.dataset.action = action;
  node.addEventListener('click', onClick);
  return node;
}

function finish() {
  const itemCoverage = Object.fromEntries(cards.map(card => [card.lineageId, known.has(card.lineageId) ? 1 : 0.5]));
  mnx.complete({ completed: true, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000), itemCoverage });
}

function draw() {
  const page = el('main', 'mx-auto flex max-w-xl flex-col gap-4 px-4 py-6 font-mnx text-mnx-text');
  const header = el('header', 'flex flex-col gap-1');
  header.append(el('h1', 'font-mnx-heading text-2xl font-semibold', 'Flashcards'),
    el('p', 'text-sm text-mnx-text-muted', 'Think of the answer, then turn the card over.'));
  page.append(header);

  if (!cards.length) {
    const empty = el('div', 'flex flex-col items-center gap-2 rounded-mnx-surface border border-dashed border-mnx-border-inner px-4 py-8 text-center');
    empty.append(el('p', 'font-mnx-heading text-lg font-semibold', 'No cards yet'),
      el('p', 'text-sm text-mnx-text-muted', 'Open this from a set of knowledge items with descriptions.'),
      button('Close', SECONDARY, 'leave', () => mnx.exit()));
    page.append(empty);
    mnx.root.replaceChildren(page);
    return;
  }

  const card = cards[index];
  const box = el('section', 'flex flex-col gap-4 rounded-mnx-surface border-mnx bg-mnx-surface p-5 shadow-mnx');
  const top = el('div', 'flex items-center justify-between');
  top.append(el('span', 'rounded-mnx-chip border border-mnx-border-inner bg-mnx-surface-2 px-2 py-0.5 text-xs font-semibold', `Card ${index + 1} of ${cards.length}`),
    el('span', 'text-sm text-mnx-text-muted', `${known.size} known`));
  box.append(top, el('p', 'font-mnx-heading text-xl font-semibold', card.front));
  if (flipped) box.append(el('p', 'rounded-mnx-field bg-mnx-surface-2 p-3 leading-relaxed', card.back));
  const actions = el('div', 'flex flex-wrap gap-2');
  if (!flipped) {
    actions.append(button('Turn over', PRIMARY, 'flip', () => { flipped = true; draw(); }));
  } else {
    const next = (knewIt: boolean) => () => {
      if (knewIt) known.add(card.lineageId);
      flipped = false;
      if (++index >= cards.length) return finish();
      draw();
    };
    actions.append(button('I knew it', PRIMARY, 'knew', next(true)), button('Not yet', SECONDARY, 'not-yet', next(false)));
  }
  box.append(actions);
  const progress = el('div', 'h-2 overflow-hidden rounded-mnx-chip bg-mnx-surface-2');
  const fill = el('div', 'h-full bg-mnx-accent transition-[width]');
  fill.style.width = `${Math.round((index / cards.length) * 100)}%`;
  progress.append(fill);
  page.append(box, progress);
  mnx.root.replaceChildren(page);
  actions.querySelector('button')?.focus();
}

draw();
