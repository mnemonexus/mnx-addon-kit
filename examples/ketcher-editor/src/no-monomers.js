// Stands in for Ketcher's 4 MB monomer library (package.json, "browser"). Only
// the macromolecules editor reads it, and this add-on turns that editor off.
export default JSON.stringify({ root: { templates: [], nodes: [], connections: [] } });
