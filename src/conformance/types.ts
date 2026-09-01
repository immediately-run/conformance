// Conformance probe vocabulary (R3-492).
//
// A probe asserts ONE platform promise. Every probe carries a citation — the
// spec section or SDK symbol that makes the promise — so a failure is a
// citation and not a symptom. Every probe returns exactly one of three
// outcomes; there is never a fourth:
//
//   pass          — the promise held, measured.
//   fail          — the promise broke, measured. A definite negative.
//   undetermined  — the probe could not tell "absent" from "could not tell"
//                   (signed out, consent pending, awaiting a trusted click,
//                   a provider it does not hold). Says WHY.
//
// A suite that cannot tell "absent" from "could not tell" reports absence and
// is believed (item R3-492 deliverable). A probe whose host support is
// genuinely absent MUST report undetermined, and the run stays green.

import type { SandboxMount } from '@immediately-run/sdk';

export type ProbeStatus = 'pass' | 'fail' | 'undetermined';

export interface ProbeResult {
  id: string;
  status: ProbeStatus;
  detail: string;
  durationMs: number;
}

export type RunMode = 'baseline' | 'after-reload' | 'second-client';
export type ClientRole = 'reader' | 'writer';

/** The environment column — which host this run reached (ways_of_working §4). */
export interface RunEnvironment {
  /** `prod` | `staging` | `local` | `vite-dev` | `other`. */
  host: string;
  /** The hostname the app actually loaded from. */
  hostname: string;
  /** The app's declared SDK dependency (exact pin — what the run is against). */
  sdkDependency: string;
}

/** Per-run facts the probes read. */
export interface ProbeContext {
  mode: RunMode;
  role: ClientRole;
  env: RunEnvironment;
  /** auth status resolved from the SDK channel; `user.login` may still be
   *  absent without the `auth:identity` grant. */
  authStatus: 'unknown' | 'signed-in' | 'signed-out';
  authLogin: string | null;
  /** Lazy cache the probes share (the opened settings mount). */
  _settings: { mount?: SandboxMount };
}

export interface ProbeDef {
  id: string;
  /** The platform promise being asserted, in one sentence. */
  promise: string;
  /** Spec section or SDK symbol that makes the promise. */
  citation: string;
  modes: RunMode[];
  run: (ctx: ProbeContext) => Promise<ProbeResult>;
}

/** A probe whose outcome the host spec must complete (trusted click / picker /
 *  powerbox) reports undetermined with this helper until then. */
export function undetermined(detail: string): Omit<ProbeResult, 'id' | 'durationMs'> {
  return { status: 'undetermined', detail };
}
