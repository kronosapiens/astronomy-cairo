# `astro` package

`astro` now has a small active surface and an explicit legacy area:

- Active: `astronomy-engine` wrappers and Cairo-v5 parity tooling.
- Legacy: older archive/Chebyshev/parity experiments under `src/legacy/`.

## CLI

Build sign-level oracle corpus (7 planets + ascendant sign):

```bash
npm run build:sign-corpus -- \
  --start 2026-01-01T00:00:00Z \
  --end 2026-01-02T00:00:00Z \
  --step-minutes 60 \
  --quantize-minutes 15 \
  --lat-bins 377 \
  --lon-bins -1224 \
  --out out/2026.sign-corpus.json
```

Evaluate Cairo v5 runner:

```bash
npm run eval:light
npm run eval:heavy
```

Compare generated Cairo v5 tests against oracle signs:

```bash
npm run compare:v5-chart-parity -- \
  --start 2026-01-01T00:00:00Z \
  --end 2026-01-02T00:00:00Z
```

Legacy scripts are still available via `npm run legacy:*`.
