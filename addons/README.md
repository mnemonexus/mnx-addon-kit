# Add-ons

Real add-ons live here, one folder each. Start a new one with:

```sh
bun run new <id>
```

That copies [`templates/experience`](../templates/experience/) to `addons/<id>`
with your id and label. Every add-on here must pass `bun run check --all` in CI.
