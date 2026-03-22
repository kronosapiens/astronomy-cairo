# Cairo Astronomy Engine

Deterministic onchain ephemeris computing ecliptic longitudes for seven classical bodies plus the ascendant.
Validated at >99.999% sign-level parity against [astronomy-engine](https://github.com/cosinekitty/astronomy) across 4,000 years.

## Repository Layout

- `cairo/crates/` — deployable Starknet contract crates (v6-based, optimized for contract size limits)
- `cairo/research/` — research workspace with engine versions v1–v6, API, and eval runner
- `astro/` — JavaScript oracle, evaluation tooling, and test results
- `spec/` — design specs and domain reference

## Key Docs

- [RESEARCH.md](./RESEARCH.md) — development arc from v1 through v6
- [spec/CHART.md](./spec/CHART.md) — chart construction spec
- [spec/EVALS.md](./spec/EVALS.md) — evaluation framework
- [astro/README.md](./astro/README.md) — eval CLI usage

## Verification

From `cairo/research/`:

```bash
scarb test
```

From `astro/`:

```bash
npm test
```
