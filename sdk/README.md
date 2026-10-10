# MnemoNexus public add-on SDK (local preview)

This package can be distributed without the MnemoNexus application repository.
It contains the existing protocol-1 Experience bridge types and an independent
`.mnxpack` authoring tool. No private source imports, app aliases, or app services.

```ts
import { getExperienceHost } from '@mnemonexus/addon-sdk';
const host = getExperienceHost();
// Mount your bundled UI in host.root using host.props.items.
// Send an outcome using host.complete(result), or leave with host.exit().
```

Entry points:

| Import | What |
|---|---|
| `@mnemonexus/addon-sdk` | Protocol types and `getExperienceHost()`. |
| `@mnemonexus/addon-sdk/pack` | `buildPack()`, `PACK_LIMITS`, `manifestContentHash()`. The builder also validates an optional `manifest.learning` contribution. |
| `@mnemonexus/addon-sdk/learning` | `defineAddon()`, `validateLearningContribution()` and `validatePreparation()` for learning add-ons (`addon-learning-v1`, section 9). |
| `@mnemonexus/addon-sdk/validate` | `validateManifest()` (section 7, with settings and learning), `validateResult()` (section 6, and preparation jobs), `evaluateCompatRule()`, `selectItems()` and `resolveSettings()` (section 12). |
| `@mnemonexus/addon-sdk/sign` | PREVIEW: `signPack()`, `verifyPack()` and key helpers for the proposed P2 signatures. The app does not check signatures yet. |
| `@mnemonexus/addon-sdk/shims` | Opt-in, for ported projects: an in-memory `localStorage` and `sessionStorage` where the sandbox blocks them, and the `process` and `global` older libraries expect. Import it first. |

Use `@mnemonexus/addon-sdk/pack` in a build script to package a single bundled
browser script plus declared assets. Bundle dependencies in an IIFE. The current
sandbox supplies window.mnx, not a CommonJS require table; the `.cjs` filename is
a container convention. Put CSS in the script or declared assets accessed through
host.asset(). No eval, parent DOM access, local filesystem, or private app imports.

Permissions are enforced by the application. Storage uses host.storage (requires
storage:local). Negotiated study runs have acknowledged durable storage scoped by
host-owned addon/workspace/run/context identity. Other launch surfaces retain the
existing transient storage behavior. API credentials remain in
the host. Compatibility is declared as
data in the manifest, not arbitrary code executed in the host. Pack hashes detect
changes; they are not publisher signatures or proof of trust.

The builder verifies the container, paths, size caps, and hashes. `validateManifest`
ports the host's manifest schema and rules as the contract states them; where the
contract is silent it warns rather than guesses (see docs/HOST_GAPS.md). The host
still validates independently on installation.

Run `bun install` and `bun test` here for the standalone authoring tests. These
require no MnemoNexus source. They cover pack bytes and identity, missing
assets and stale hashes, study capability negotiation, every manifest rule
(passing and failing), the study, recall and preparation result checks,
settings, learning schemas, forged references, invalid payloads, preparation
dispatch, and signing.

Supported launch surfaces: standalone, recall, transferal, calendar, and study
when the host advertises both `study-examples-v1` and `study-storage-v1`.
`getExperienceHost()` refuses a study launch without that capability handshake.
Declare reviewed example tasks in `surfaces.study` (version 1), including task ID,
label, schema, matching phrases and maximum duration. The host supplies a scoped
`props.study` context. Return matching `studyEvidence` through `host.complete()`;
the host validates it and records practice evidence without granting target mastery.
With `study-section-v1`, `props.study.section` holds the current subsection's
objective and text, and `props.items` its compatible knowledge items.

Source-specific tasks use the `addon-learning-v1` capability and the
`@mnemonexus/addon-sdk/learning` entry point. `defineAddon()` dispatches
preparation jobs, selected activities and standalone launches. The public
`validateLearningContribution()` and `validatePreparation()` functions reject
unsupported schemas, malformed tasks and references outside the supplied source.
Exact recall-target credit remains host-owned and requires an explicit target
mapping. Study completion records practice. See `addons/process-builder` and
GUIDE.md section 15.

Theme v1 (`mnx.theme`, `mnx.onTheme`) and settings v1 (`props.settings`) are
typed in `index.d.ts`. It also brings `assets.d.ts`, which types the imports
the kit's build turns into code: CSS modules (`*.module.css`, `.scss`,
`.sass`) and images and fonts (as `data:` URLs).

Version 0.1.0 is an unpublished local preview, not a registry release. Host engine
`mnxSdk: '1.0.0'` names the existing wire API; this package's preview version is
separate. Before publishing, add release and version policies. The mock host and checker
live in this repository's `mock-host/` and `tools/`. Third-party authors should
eventually need only this package and an installed application binary.
