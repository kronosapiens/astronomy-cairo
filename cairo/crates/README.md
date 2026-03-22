# Deployable Contract Crates

Reserved for Starknet contract crates to be generated from the finalized research engine.

The deployment architecture splits the engine across four contract classes to fit within Starknet's 4 MB declaration limit.
See `cairo/research/crates/astronomy_engine_v6/README.md` for the size optimization analysis and split design.
