/**
 * Disable Indigo-dependent operations: the sandbox blocks its server and WASM.
 * Drawing, editing, undo, templates and KET/Molfile/SMILES remain available.
 */

/** Ketcher's buttons for what needs Indigo. main.tsx hides them. */
export const INDIGO_BUTTONS = ['layout', 'clean', 'arom', 'dearom', 'cip', 'check', 'analyse', 'recognize'];
const unavailable = () => Promise.reject(new Error('This needs Indigo, which the add-on sandbox cannot run.'));

const service = {
  addKetcherId() {},
  info: async () => ({ indigoVersion: '', imagoVersions: [], isAvailable: false }),
  convert: unavailable, layout: unavailable, clean: unavailable, aromatize: unavailable, dearomatize: unavailable,
  calculateCip: unavailable, automap: unavailable, check: unavailable, calculate: unavailable, recognize: unavailable,
  getInChIKey: unavailable, generateImageAsBase64: unavailable, toggleExplicitHydrogens: unavailable,
  calculateMacromoleculeProperties: unavailable, expandAbbreviations: unavailable,
};

export const offlineStructService = {
  mode: 'standalone' as const,
  createStructService: () => service,
};
