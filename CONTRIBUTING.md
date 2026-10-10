# Contributing

Use Bun 1.4.2 or later and Node.js 18 or later. Install dependencies with
`bun install --frozen-lockfile`.

The public API and sandbox rules are defined in
[the host contract](docs/HOST_CONTRACT.md). Reference files under `reference/`
are snapshots from the app; changes to them must match the host.

## Development

- Keep each add-on in its own folder. Start from `templates/experience/` or,
  for source-based activities, `addons/process-builder/`.
- Keep dependencies in the package that imports them. Ported projects retain
  their own `package.json`; use its `browser` field for replacements.
- Render untrusted text with `textContent`. Use the host APIs for assets,
  storage and model calls, subject to the manifest's permissions.
- Use `@mnemonexus/addon-ui` or theme tokens for styling. Check light and dark
  themes, keyboard interaction and live settings changes.
- Learning activities must reference the supplied source. Return no offer
  when the source does not support the task.
- Keep keys, credentials and local configuration out of commits.

## Validation

Run `bun test` and `bun run check --all --screenshots`. The latter builds
all installed examples and drives their scenarios in Chromium. CI requires
the browser run; `--no-browser` is only a local build and scan.

Each supported surface needs a scenario whose drive script reaches completion.
Cover empty input, permission refusal and settings updates where applicable.
Learning add-ons also need preparation scenarios, including unsupported input
that yields zero offers.

The browser runner uses Node on Windows. Install Chromium with
`bunx playwright install chromium`, or set `MNX_CHROMIUM` to an existing binary.
For the Ketcher example, install its dependencies with
`npm ci --prefix examples/ketcher-editor --no-audit --no-fund`.

Describe the behavior changed and the validation performed in pull requests.
Report any host behavior that the contract does not define with a small
reproduction. See [compatibility notes](docs/HOST_GAPS.md) for the mock's limits.
