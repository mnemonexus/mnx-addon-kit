/** The library's stylesheet, as text. `installUi()` adds it for you. */
export declare const UI_CSS: string;
/** The id of the <style> element `installUi()` adds. */
export declare const UI_STYLE_ID: 'mnx-addon-ui';
/**
 * Add the library's stylesheet to the page, once. Call it before you draw.
 * It goes first in <head>, so your own styles override it. It does nothing
 * without a document (a preparation job) and nothing the second time.
 */
export declare function installUi(doc?: Document): void;
