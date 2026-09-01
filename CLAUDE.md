# Working in this repo

This is the **immediately.run conformance app** (roadmap R3-492) — a first-party
app that probes the platform's app-facing contract and self-reports PASS/FAIL/
UNDETERMINED. It follows the `new-project-template` rules (see that repo's
CLAUDE.md), with the differences below.

## What makes this repo different from an ordinary example app

- **The probe table is the product.** `src/conformance/probes.ts` holds it; each
  probe cites its spec section or SDK symbol. A failure must name the promise, not
  a UI symptom.
- **Three outcomes, never two** (`src/conformance/types.ts`): `pass` / `fail` /
  `undetermined`. A probe that cannot tell "absent" from "could not tell" returns
  `undetermined` with a reason, and the run stays green.
- **No `store.ts` workaround — this is load-bearing.** The sample apps carried a
  padded `writeJson` to survive the R3-405 shrink bug; copying that here would
  inherit the blindness this app exists to remove. All writes are unpadded,
  through the plain SDK `openFs` surface.
- **Modes** are read from the URL (`?mode=baseline|after-reload|second-client`,
  `&role=reader|writer`) — see README.

## Hard rules (from the template, restated)

1. `src/App.tsx` default export is the entry point. `src/main.tsx` is local-only.
2. Global CSS is imported from `App.tsx`.
3. A file exporting a component exports **only** components (Fast Refresh).
4. **`localStorage` throws at an opaque origin** — the `platform.localstorage-throws`
   probe depends on it; never touch it at module scope.
5. `import ... from 'fs'` is the sandbox's async-only filesystem — `fs.promises`
   surface only; the ambient types come from
   `/// <reference types="@immediately-run/sdk/ambient" />` (`src/ambient.d.ts`).
6. **A synthetic click never triggers a download** (`isTrusted:false` cannot satisfy
   a user-activation gate). The `platform.blob-download` probe renders a clickable
   anchor and waits for the host spec to click it as a trusted event.

## The host spec

The Playwright spec that drives this app on the host lives in
`immediately-run-site-main/conformance/` (R3-492) and asserts the reported table.
The app only renders the truth; the spec is where "is this the expected verdict"
is decided.
