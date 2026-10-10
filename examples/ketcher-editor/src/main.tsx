/**
 * Ketcher Editor: EPAM's open-source chemical structure editor (Apache-2.0)
 * as a MnemoNexus add-on. README.md says what porting it took.
 */
// First, so it runs before Ketcher's libraries: an in-memory localStorage and
// the `process` global they expect.
import '@mnemonexus/addon-sdk/shims';
import { getExperienceHost } from '@mnemonexus/addon-sdk';
import { installUi } from '@mnemonexus/addon-ui';
import { ElementColor, type Ketcher } from 'ketcher-core';
import { Editor } from 'ketcher-react';
import { createRoot } from 'react-dom/client';
import 'ketcher-react/dist/index.css';
import './layout.css';
import { makeReadable } from './readable';
import { INDIGO_BUTTONS, offlineStructService } from './struct-service';

const mnx = getExperienceHost();
const startedAt = Date.now();
installUi();
makeReadable(ElementColor as Record<string, string>);

let ketcher: Ketcher | undefined;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(label: string, className: string, action: string, onClick: () => void) {
  const node = el('button', className, label);
  node.type = 'button';
  node.dataset.action = action;
  node.addEventListener('click', onClick);
  return node;
}

/** Atoms in a KET document: its molecules are the top-level entries of type "molecule". */
function countAtoms(ket: Record<string, any>): number {
  return Object.values(ket).reduce((sum, entry) => sum + (entry?.type === 'molecule' ? entry.atoms?.length ?? 0 : 0), 0);
}

const status = el('p', 'mnx-muted', 'Draw a structure, then press Done.');
status.setAttribute('role', 'status');

async function finish() {
  if (!ketcher) return;
  const atoms = countAtoms(JSON.parse(await ketcher.getKet()));
  if (!atoms) {
    status.textContent = 'Nothing drawn yet. Add a structure first.';
    return;
  }
  mnx.complete({ completed: true, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000) });
}

const page = el('main', 'ketcher-page');
const bar = el('header', 'ketcher-bar');
const heading = el('div', 'mnx-stack');
heading.append(el('h1', 'mnx-title', 'Structure editor'), status);
const actions = el('div', 'mnx-row');
actions.append(button('Leave', 'mnx-button mnx-button--ghost', 'leave', () => mnx.exit()), button('Done', 'mnx-button mnx-button--primary', 'done', finish));
bar.append(heading, actions);
const host = el('div', 'ketcher-host');
page.append(bar, host);
mnx.root.replaceChildren(page);

createRoot(host).render(
  <Editor
    staticResourcesUrl=""
    structServiceProvider={offlineStructService as any}
    disableMacromoleculesEditor
    // Hidden: what needs Indigo, and the 3D viewer, which package.json leaves out.
    buttons={Object.fromEntries([...INDIGO_BUTTONS, 'miew'].map(name => [name, { hidden: true }]))}
    errorHandler={(message: string) => { status.textContent = message; }}
    onInit={(instance: Ketcher) => { ketcher = instance; }}
  />,
);
