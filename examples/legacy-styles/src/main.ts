/**
 * Review example using a Tailwind 3 config, legacy opacity utilities and a Sass
 * CSS module. Its fixed light surface is independent of the host theme.
 */
import { getExperienceHost } from '@mnemonexus/addon-sdk';
import './index.css';
import badge from './Badge.module.scss';

const mnx = getExperienceHost();
const startedAt = Date.now();
const items = mnx.props.items.map(item => ({ lineageId: item.lineageId, title: item.conceptTitle || 'Untitled', text: item.text }));
const reviewed = new Set<string>();

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
  const itemCoverage = Object.fromEntries(items.map(item => [item.lineageId, reviewed.has(item.lineageId) ? 1 : 0]));
  mnx.complete({ completed: true, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000), itemCoverage });
}

function draw() {
  const page = el('main', 'mx-auto max-w-xl p-4');
  const card = el('section', 'overflow-hidden rounded-lg border border-brand-600 border-opacity-50 bg-white text-gray-900 shadow');
  const header = el('header', 'flex items-center gap-3 bg-brand-600 bg-opacity-10 px-4 py-3');
  const count = el('span', 'flex-shrink-0 rounded-full bg-brand-600 px-2 py-0.5 text-sm font-semibold text-white', `${reviewed.size}/${items.length}`);
  header.append(el('h1', 'card-title text-lg', 'Review your items'), count);
  card.append(header);

  if (!items.length) {
    const empty = el('div', 'px-4 py-8 text-center');
    empty.append(el('p', 'card-title', 'Nothing to review'), el('p', 'mt-1 text-sm text-gray-700', 'Open this from a set of knowledge items.'),
      button('Close', 'btn mt-4 bg-gray-100 text-gray-900', 'leave', () => mnx.exit()));
    card.append(empty);
  } else {
    const list = el('ul', 'divide-y divide-gray-200');
    for (const item of items) {
      const done = reviewed.has(item.lineageId);
      const row = el('li', 'flex items-start gap-3 px-4 py-3');
      const body = el('div', 'min-w-0 flex-grow');
      body.append(el('p', 'font-medium', item.title), el('p', 'mt-0.5 text-sm text-gray-700', item.text));
      const status = el('span', `${badge.badge}${done ? ` ${badge.done}` : ''} flex-shrink-0`, done ? 'Reviewed' : 'To review');
      row.append(body, status);
      if (!done) row.append(button('Mark reviewed', 'btn flex-shrink-0 bg-brand-600 text-white hover:bg-brand-800', `review-${item.lineageId}`, () => { reviewed.add(item.lineageId); draw(); }));
      list.append(row);
    }
    const footer = el('footer', 'flex justify-end bg-gray-50 px-4 py-3');
    footer.append(button('Finish', 'btn bg-brand-600 text-white hover:bg-brand-800', 'finish', finish));
    card.append(list, footer);
  }
  page.append(card);
  mnx.root.replaceChildren(page);
}

draw();
