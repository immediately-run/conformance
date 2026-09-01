# immediately.run conformance app (R3-492)

The platform's **app-facing contract, probed live.** A first-party immediately.run
app that runs a table of named platform promises and self-reports PASS / FAIL /
UNDETERMINED per row, with the failure detail inline. Built so the next defect of
the R3-405/R3-408/R3-409 class is found by an instrument driving a real host —
not by a person building an app.

It is an **ordinary app** — built from the `new-project-template` shape, with no
privileged position. It declares the baseline capabilities it needs
(`auth:identity`, `task:invoke`) and gets nothing else until the user consents.

## What it verifies

One row = one platform promise, each carrying its citation (a spec section or an
SDK symbol). Coverage (the item's minimum, plus the platform-truth rows):

| promise | citation |
|---|---|
| a shrinking overwrite reads back exact bytes (no resurrected tail) | `FirestoreFS.touch` honors size — R3-405 |
| N-way recursive mkdir of one fresh path: all succeed | FirestoreFS.mkdir in-flight tolerance — R3-408 |
| N-way create of one fresh path: all succeed | FirestoreFS.createFile in-flight tolerance — R3-408 |
| `openSettings()` identity stable across a space grant | SDK `openSettings` / `SandboxMount.id` |
| `createSpace` then `mountSpace` re-opens with no prompt | SDK `createSpace`/`mountSpace` durable grant |
| a powerbox-granted space re-mounts with no prompt | SDK `requestMount` durable grant |
| `useAuth().user.login` is populated for a signed-in stage app | SDK `AuthState.user.login` |
| a member write is DELIVERED (watch vs poll) | R3-409 — **expected FAIL today** |
| a blob download anchor is present and clickable | iframe-factory `allow-downloads` (R3-417) |
| `invokeTask` resolves to a typed outcome, never hangs | SDK `invokeTask` |
| `describeChatState()` is a well-formed tri-state | SDK `describeChatState` |
| `localStorage` throws `SecurityError` at an opaque origin | iframe-factory (no `allow-same-origin`) |
| `window.confirm` is present | iframe-factory `allow-modals` |
| `crypto.subtle.digest` works | WebCrypto |

## Three outcomes, never two

- **pass** — the promise held, measured.
- **fail** — the promise broke, measured. A definite negative.
- **undetermined** — the probe could not tell "absent" from "could not tell"
  (signed out, consent pending, awaiting a trusted click). It says **why**.

A probe whose host support is genuinely absent reports **undetermined** and the
run stays green; only a definite negative is a fail.

## Machine-readable surface

- `<table data-testid="conformance-results">` — one `<tr data-probe data-status>`
  per row (the host spec asserts this).
- `<script type="application/json" id="conformance-report">` — the full run
  (env, mode, role, per-probe status+detail).
- `<div role="status" data-testid="conformance-done">` — `conformance run complete`.

## Modes

- `?mode=baseline` — one page load. Anonymous rows must PASS; session rows must be
  PASS or UNDETERMINED (never FAIL) without a signed-in session.
- `?mode=after-reload` — the host spec reloads the page; durable-grant rows run on
  the second load.
- `?mode=second-client&role=reader|writer` — the two-page delivery drill (R3-409).

## Notes

- **Deliberately no `store.ts` workaround.** The sample apps carried a padded
  `writeJson` to survive the R3-405 shrink bug; a conformance app that copied it
  would inherit the blindness it exists to remove. All writes here are unpadded,
  through the plain SDK `openFs` surface.
- Writes go to the app's **settings mount** (Firestore-backed) — the same seam an
  app's durable data lives on — so a shrink regression on the real backend fails
  this app's `fs.shrinking-overwrite` row.
