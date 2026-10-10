/** Asset and stylesheet module declarations included by the SDK types. */

/** A CSS module: each class name, mapped to the unique name the build gave it. */
declare module '*.module.css' { const classes: { readonly [name: string]: string }; export default classes; }
declare module '*.module.scss' { const classes: { readonly [name: string]: string }; export default classes; }
declare module '*.module.sass' { const classes: { readonly [name: string]: string }; export default classes; }

/** Images and fonts: a data: URL, the only kind the sandbox loads. */
declare module '*.png' { const url: string; export default url; }
declare module '*.jpg' { const url: string; export default url; }
declare module '*.jpeg' { const url: string; export default url; }
declare module '*.gif' { const url: string; export default url; }
declare module '*.webp' { const url: string; export default url; }
declare module '*.avif' { const url: string; export default url; }
declare module '*.svg' { const url: string; export default url; }
declare module '*.ico' { const url: string; export default url; }
declare module '*.bmp' { const url: string; export default url; }
declare module '*.woff' { const url: string; export default url; }
declare module '*.woff2' { const url: string; export default url; }
declare module '*.ttf' { const url: string; export default url; }
declare module '*.otf' { const url: string; export default url; }
