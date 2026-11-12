# PrimeBrush Rust workspace

This workspace provides optional native acceleration for the Python
`solaire.primebrush` package. The current PyO3 extension formats the 200-point
2D curve path; Python continues to parse and evaluate expressions and render
the rest of the SVG.

## Build

From this directory, build the locked workspace in release mode:

```bash
cargo build --locked --workspace --release
```

With the portable Windows GNU toolchain in this non-ASCII workspace path,
point `CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER` to the toolchain's
`lib/rustlib/x86_64-pc-windows-gnu/bin/rust-lld.exe` and set
`RUSTFLAGS="-C linker-flavor=ld.lld -C link-self-contained=yes"`.

On Windows, Cargo emits `primebrush_rs.dll` in the release output directory.
For a local run, copy it as `primebrush_rs.pyd` into a temporary directory on
`PYTHONPATH`; a global install is not needed.

## Fallback behavior

The Python renderer uses `primebrush_rs.plot2d_path` when that function is
available. Without the extension, or with an older extension that lacks this
function, it uses the equivalent Python path formatter. This extension exports
`HAS_FULL_RENDER = False` because its module-level `render` is still a stub;
the public API skips that stub before serializing a model. Older external
extensions without the marker retain the existing `render` call behavior.

## Crates

| Crate | Purpose |
|---|---|
| `primebrush-core` | Shared Rust types and plugin trait scaffold |
| `primebrush-pyo3` | Optional `primebrush_rs` Python extension |
| `primebrush-wasm` | Browser WASM scaffold |
