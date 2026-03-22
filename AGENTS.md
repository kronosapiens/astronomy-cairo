# AGENTS

## Astronomy Engine Policy

- Primary objective: preserve or improve fidelity to the upstream `astronomy-engine` computational pipeline.
- Prefer algorithmic parity work (time scales, transforms, precession/nutation chain, light-time path, periodic terms) over dataset-specific tuning.
- Do not use empirical spot-corrections as the main accuracy strategy.
- If any temporary correction is introduced for debugging, it must be clearly marked and removed before finalizing.
- Evaluation windows are for measurement only, not targets for hand-tuned fixes.

## Engine Versions

- `v1`–`v4`: research iterations (table ingress → Chebyshev → VSOP → full 7-body pipeline).
Archived in `cairo/crates/research/`.
See per-crate READMEs for details.
- `v5`: production engine.
>99.999% sign-level parity (100% on structured eval, 1 irreducible cusp case per ~96k random points).
- `v6`: deployment-optimized v5 with reduced trig tables (76% fewer entries).
Fits within Starknet's 4 MB contract class size limit.

See [cairo/crates/research/RESEARCH.md](cairo/crates/research/RESEARCH.md) for the full development arc.
