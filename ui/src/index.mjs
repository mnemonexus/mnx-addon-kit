/**
 * @mnemonexus/addon-ui: components that look like part of MnemoNexus.
 * See README.md and GUIDE.md section 10.
 */
import { UI_CSS } from './css.mjs';

export { UI_CSS };

export const UI_STYLE_ID = 'mnx-addon-ui';

/**
 * Install the stylesheet once, first in head so add-on styles can override it.
 * Does nothing without a document, including preparation jobs.
 */
export function installUi(doc = globalThis.document) {
  if (!doc || !doc.head || doc.getElementById(UI_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = UI_STYLE_ID;
  style.textContent = UI_CSS;
  doc.head.insertBefore(style, doc.head.firstChild);
}
