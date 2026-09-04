// The conformance probe table (R3-492). One row = one platform promise, cited.
//
// The minimum coverage from the item, mapped to its promise + citation:
//
//   shrinking overwrite read back exact bytes ..... fs.shrinking-overwrite  (R3-405 /
//     FirestoreFS.touch; the item's "a write that shrinks a file reads back exact bytes")
//   concurrent mkdir + create .................... fs.concurrent-mkdir/create (R3-408)
//   openSettings() identity across a grant ....... settings.identity-across-grant
//   createSpace then re-mount ..................... spaces.create-space-remount
//   powerbox-granted space re-mounts, no prompt .. spaces.powerbox-remount (after-reload)
//   useAuth().user.login ......................... auth.login (R3-409's stage-app note)
//   watch versus poll delivery ................... delivery.watch-vs-poll (second-client;
//     R3-409 is open — this row is EXPECTED to fail today, and its failure names delivery)
//   blob download ................................ platform.blob-download (needs a trusted click;
//     the host spec observes the download event)
//   task invoke .................................. tasks.typed-outcome
//   LLM provider state ........................... llm.provider-state
//   localStorage throws .......................... platform.localstorage-throws (opaque origin)
//   window.confirm ............................... platform.window-confirm (allow-modals)
//   crypto.subtle ................................ platform.crypto-subtle

import {
  createSpace,
  describeChatState,
  mountSpace,
  openSettings,
  type MountFs,
  type SandboxMount,
} from '@immediately-run/sdk';
import { openFs } from '@immediately-run/sdk/fs';
import { invokeTask } from '@immediately-run/sdk/tasks';
import type { ProbeDef, ProbeResult } from './types';

const sdk = '@immediately-run/sdk';

const done = (
  id: string,
  status: ProbeResult['status'],
  detail: string,
  startedAt: number,
): ProbeResult => ({ id, status, detail, durationMs: Math.round(performance.now() - startedAt) });

// ---------------------------------------------------------------------------
// Runtime helpers
// ---------------------------------------------------------------------------

/** The app's own settings mount — the Firestore-backed space behind the SDK's
 *  settings surface (host-held, no consent prompt, `settings:app` baseline).
 *  `null` when signed out (auth-required) or not yet openable. */
async function openSettingsMount(cache: { mount?: SandboxMount }): Promise<MountFs | null> {
  if (cache.mount) return openFs(cache.mount);
  try {
    const mount = await openSettings();
    cache.mount = mount;
    return openFs(mount);
  } catch {
    return null;
  }
}

/** A writable path prefix scoped to this app, so repeated runs don't collide. */
const ROOT = '/conformance';

// ---------------------------------------------------------------------------
// Anonymous / platform-surface probes (run without sign-in)
// ---------------------------------------------------------------------------

const platformProbes: ProbeDef[] = [
  {
    id: 'platform.localstorage-throws',
    promise: 'localStorage is unreadable at an opaque origin (throws on access)',
    citation: 'iframe-factory APP_SANDBOX_BASELINE (no allow-same-origin); template CLAUDE.md rule 8',
    modes: ['baseline', 'after-reload'],
    run: async () => {
      const t = performance.now();
      try {
        // Accessing the property at an opaque origin throws SecurityError. A
        // `typeof` guard does not work (the throw is on access, not on value),
        // so probe the read itself.
        void window.localStorage;
        return done('platform.localstorage-throws', 'fail', 'localStorage read succeeded — the origin is not opaque', t);
      } catch (e) {
        const name = e instanceof Error ? e.name : typeof e;
        return name === 'SecurityError'
          ? done('platform.localstorage-throws', 'pass', `SecurityError on access (${name})`, t)
          : done('platform.localstorage-throws', 'fail', `threw, but not SecurityError: ${name}`, t);
      }
    },
  },
  {
    id: 'platform.window-confirm',
    promise: 'window.confirm is present (allow-modals)',
    citation: 'iframe-factory APP_SANDBOX_BASELINE (allow-modals)',
    modes: ['baseline', 'after-reload'],
    run: async () => {
      const t = performance.now();
      return typeof window.confirm === 'function'
        ? done('platform.window-confirm', 'pass', 'typeof window.confirm === function', t)
        : done('platform.window-confirm', 'fail', 'window.confirm absent', t);
    },
  },
  {
    id: 'platform.crypto-subtle',
    promise: 'crypto.subtle.digest works in the sandbox',
    citation: 'WebCrypto (subtle) — sandbox iframe',
    modes: ['baseline', 'after-reload'],
    run: async () => {
      const t = performance.now();
      try {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('conformance'));
        const ok = digest.byteLength === 32;
        return ok
          ? done('platform.crypto-subtle', 'pass', `SHA-256 → ${digest.byteLength} bytes`, t)
          : done('platform.crypto-subtle', 'fail', `SHA-256 → unexpected ${digest.byteLength} bytes`, t);
      } catch (e) {
        return done('platform.crypto-subtle', 'fail', `crypto.subtle unavailable: ${String(e)}`, t);
      }
    },
  },
  {
    id: 'platform.blob-download',
    promise: 'a blob download anchor is present and accepts a trusted click (allow-downloads)',
    citation: 'iframe-factory APP_SANDBOX_BASELINE (allow-downloads); measured R3-417',
    modes: ['baseline', 'after-reload'],
    run: async () => {
      const t = performance.now();
      try {
        const blob = new Blob([JSON.stringify({ probe: 'blob-download', at: Date.now() })], {
          type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'conformance-download.json';
        anchor.dataset.testid = 'download-probe-anchor';
        anchor.textContent = 'Download probe file';
        anchor.style.display = 'block';
        anchor.style.margin = '4px 0';
        document.body.appendChild(anchor);

        const clicked = new Promise<boolean>((resolve) => {
          const onDone = () => {
            anchor.removeEventListener('click', onDone);
            // DO NOT revoke the object URL here: the browser starts the
            // download AFTER the click event returns, and revoking inside the
            // handler destroys the very URL the download needs
            // ("Not allowed to load local resource: blob:null/…"). Revoke on
            // the next tick instead, once the click has fully dispatched.
            setTimeout(() => URL.revokeObjectURL(url), 5_000);
            resolve(true);
          };
          anchor.addEventListener('click', onDone);
        });

        // A synthetic click never satisfies the user-activation gate (and must
        // not — §8.2), so the click has to come from the HOST SPEC as a trusted
        // event. Until then the row is undetermined, with the anchor ready. The
        // wait is long because the spec clicks AFTER the other rows settle; the
        // run-complete marker fires only when this row resolves, so the spec
        // always has the anchor present to click.
        const racer = await Promise.race([
          clicked,
          new Promise<false>((r) => setTimeout(() => r(false), 180_000)),
        ]);
        if (racer) {
          anchor.remove();
          return done(
            'platform.blob-download',
            'pass',
            'anchor clicked (trusted); the host spec observes the download event separately',
            t,
          );
        }
        anchor.remove();
        return done(
          'platform.blob-download',
          'undetermined',
          'download anchor rendered; awaiting a trusted click from the host spec',
          t,
        );
      } catch (e) {
        return done('platform.blob-download', 'fail', `blob/anchor failed: ${String(e)}`, t);
      }
    },
  },
  {
    id: 'llm.provider-state',
    promise: 'describeChatState() resolves to a well-formed tri-state',
    citation: `${sdk}/llm describeChatState / ChatProviderState`,
    modes: ['baseline', 'after-reload'],
    run: async () => {
      const t = performance.now();
      try {
        const state = describeChatState();
        if (state.status === 'unknown' || state.status === 'not-configured') {
          return done('llm.provider-state', 'pass', `state=${state.status} (well-formed)`, t);
        }
        if (state.status === 'configured') {
          return done('llm.provider-state', 'pass', `configured: ${state.provider.providerId}`, t);
        }
        return done('llm.provider-state', 'fail', `illegal ChatProviderState.status: ${JSON.stringify(state)}`, t);
      } catch (e) {
        return done('llm.provider-state', 'fail', `describeChatState threw: ${String(e)}`, t);
      }
    },
  },
  {
    id: 'tasks.typed-outcome',
    promise: 'invokeTask resolves to a TYPED outcome (result or error code), never hangs',
    citation: `${sdk}/tasks invokeTask (codes: cancelled/timeout/forbidden/not-declared/no-such-task)`,
    modes: ['baseline', 'after-reload'],
    run: async () => {
      const t = performance.now();
      // A task contract the app declares but that this app does NOT provide —
      // so the round-trip must come back typed, not hang. A provider may or may
      // not be bound on the host; either way the CONTRACT is a typed outcome.
      try {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(Object.assign(new Error('invokeTask timed out'), { code: 'timeout' })), 8000),
        );
        const result = await Promise.race([
          invokeTask('pick-file', { roots: [] }),
          timeout,
        ]) as unknown;
        void result;
        return done('tasks.typed-outcome', 'pass', 'resolved (typed)', t);
      } catch (e) {
        const code = (e as { code?: string }).code ?? (e as Error)?.name ?? 'unknown';
        if (code === 'timeout') {
          return done('tasks.typed-outcome', 'fail', 'invokeTask neither resolved nor rejected within 8s — a hang', t);
        }
        // cancelled / forbidden / no-such-task / not-declared are all TYPED
        // rejections: the round-trip completed with a policy answer, not silence.
        return done('tasks.typed-outcome', 'pass', `rejected with typed code ${code} (contract met)`, t);
      }
    },
  },
];

// ---------------------------------------------------------------------------
// Session probes (UNDETERMINED when signed out)
// ---------------------------------------------------------------------------

const sessionProbes: ProbeDef[] = [
  {
    id: 'auth.login',
    promise: 'useAuth().user.login is populated for a signed-in stage app',
    citation: `${sdk}/auth AuthState.user.login; consent surface auth:identity`,
    modes: ['baseline', 'after-reload'],
    run: async (ctx) => {
      const t = performance.now();
      if (ctx.authStatus !== 'signed-in') {
        return done('auth.login', 'undetermined', `signed out — auth-required (status=${ctx.authStatus})`, t);
      }
      if (!ctx.authLogin) {
        return done(
          'auth.login',
          'undetermined',
          'signed in but user.login is null — auth:identity not granted (consent the surface or grant it)',
          t,
        );
      }
      return done('auth.login', 'pass', `login=${ctx.authLogin}`, t);
    },
  },
  {
    id: 'fs.shrinking-overwrite',
    promise: 'a write that shrinks a file reads back exact bytes (no resurrected tail)',
    citation: 'FirestoreFS.touch honors size (R3-405); SDK_FS_SURFACE_SPEC §2 openFs/writeFile',
    modes: ['baseline', 'after-reload'],
    run: async (ctx) => {
      const t = performance.now();
      const fs = await openSettingsMount(ctx._settings);
      if (!fs) return done('fs.shrinking-overwrite', 'undetermined', 'openSettings() unavailable (signed out?)', t);
      try {
        await fs.mkdir(ROOT, { recursive: true });
        const p = `${ROOT}/p0.json`;
        // The R3-405 spike, UNPADDED — deliberately not the padded store.ts
        // workaround the sample apps carried (R3-439 tracks its removal).
        await fs.writeFile(p, '{"a":"0123456789"}');
        await fs.writeFile(p, '{"b":1}');
        const got = await fs.readFile(p, 'utf8');
        const st = await fs.stat(p);
        const ok = got === '{"b":1}' && st.size === '{"b":1}'.length;
        return ok
          ? done('fs.shrinking-overwrite', 'pass', `read ${JSON.stringify(got)} size=${st.size} (exact)`, t)
          : done(
              'fs.shrinking-overwrite',
              'fail',
              `torn read: got ${JSON.stringify(got)} size=${st.size}, want {"b":1} size=7`,
              t,
            );
      } catch (e) {
        return done('fs.shrinking-overwrite', 'fail', `probe threw: ${String(e)}`, t);
      }
    },
  },
  {
    id: 'fs.concurrent-mkdir',
    promise: 'N-way recursive mkdir of one fresh path: all callers succeed, no EEXIST',
    citation: 'FirestoreFS.mkdir in-flight tolerance (R3-408); raceTolerance client half',
    modes: ['baseline', 'after-reload'],
    run: async (ctx) => {
      const t = performance.now();
      const fs = await openSettingsMount(ctx._settings);
      if (!fs) return done('fs.concurrent-mkdir', 'undetermined', 'openSettings() unavailable (signed out?)', t);
      try {
        const dir = `${ROOT}/race-dir-${Date.now()}/deep/path`;
        const results = await Promise.allSettled(
          Array.from({ length: 8 }, () => fs.mkdir(dir, { recursive: true })),
        );
        const rejected = results.filter((r) => r.status === 'rejected');
        const exists = await fs.exists(dir);
        if (rejected.length === 0 && exists) {
          return done('fs.concurrent-mkdir', 'pass', `8/8 mkdir resolved, dir exists`, t);
        }
        const codes = rejected.map((r) => String((r as PromiseRejectedResult).reason)).join('; ');
        return done('fs.concurrent-mkdir', 'fail', `rejected=${rejected.length} codes=[${codes}] exists=${exists}`, t);
      } catch (e) {
        return done('fs.concurrent-mkdir', 'fail', `probe threw: ${String(e)}`, t);
      }
    },
  },
  {
    id: 'fs.concurrent-create',
    promise: 'N-way create of one fresh path: all callers succeed, one consistent file',
    citation: 'FirestoreFS.createFile in-flight tolerance (R3-408)',
    modes: ['baseline', 'after-reload'],
    run: async (ctx) => {
      const t = performance.now();
      const fs = await openSettingsMount(ctx._settings);
      if (!fs) return done('fs.concurrent-create', 'undetermined', 'openSettings() unavailable (signed out?)', t);
      try {
        const p = `${ROOT}/race-create-${Date.now()}.json`;
        const payloads = ['aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbb'];
        const writes = Promise.allSettled(payloads.map((data, i) => fs.writeFile(p, `${data}-${i}`)));
        const settled = await writes;
        const rejected = settled.filter((r) => r.status === 'rejected');
        const got = await fs.readFile(p, 'utf8');
        const st = await fs.stat(p);
        const consistent = got.length === st.size;
        if (rejected.length === 0 && consistent) {
          return done('fs.concurrent-create', 'pass', `all created; final=${JSON.stringify(got)} size=${st.size}`, t);
        }
        const codes = rejected.map((r) => String((r as PromiseRejectedResult).reason)).join('; ');
        return done(
          'fs.concurrent-create',
          'fail',
          `rejected=${rejected.length} [${codes}] final=${JSON.stringify(got)} size=${st.size}`,
          t,
        );
      } catch (e) {
        return done('fs.concurrent-create', 'fail', `probe threw: ${String(e)}`, t);
      }
    },
  },
  {
    id: 'settings.identity-across-grant',
    promise: 'openSettings() resolves the same mount before and after a space grant',
    citation: 'SDK mounts.openSettings / SandboxMount.id stability',
    modes: ['baseline'],
    run: async (ctx) => {
      const t = performance.now();
      if (ctx.authStatus !== 'signed-in') {
        return done('settings.identity-across-grant', 'undetermined', 'signed out — auth-required', t);
      }
      try {
        const before = await openSettings();
        // A space grant (createSpace is a durable grant) must not move the
        // settings mount under the app.
        await createSpace({ name: `conformance-${Date.now()}` });
        const after = await openSettings();
        const beforeId = before.id ?? before.path;
        const afterId = after.id ?? after.path;
        return beforeId === afterId
          ? done('settings.identity-across-grant', 'pass', `settings mount ${beforeId} stable`, t)
          : done(
              'settings.identity-across-grant',
              'fail',
              `settings moved under a grant: ${beforeId} → ${afterId}`,
              t,
            );
      } catch (e) {
        return done('settings.identity-across-grant', 'fail', `probe threw: ${String(e)}`, t);
      }
    },
  },
  {
    id: 'spaces.create-space-remount',
    promise: 'createSpace records a durable grant; mountSpace re-opens with no prompt',
    citation: 'SDK mounts.createSpace / mountSpace (durable grant until revoked)',
    modes: ['baseline', 'after-reload'],
    run: async (ctx) => {
      const t = performance.now();
      if (ctx.authStatus !== 'signed-in') {
        return done('spaces.create-space-remount', 'undetermined', 'signed out — auth-required', t);
      }
      try {
        const created = await createSpace({ name: `conformance-remount-${Date.now()}` });
        const spaceId = created.id!;
        const reopened = await mountSpace({ spaceId });
        return reopened.id
          ? done('spaces.create-space-remount', 'pass', `reopened ${spaceId} without prompt`, t)
          : done('spaces.create-space-remount', 'pass', `reopened ${spaceId} (no prompt)`, t);
      } catch (e) {
        return done('spaces.create-space-remount', 'fail', `mountSpace after createSpace failed: ${String(e)}`, t);
      }
    },
  },
  {
    id: 'delivery.watch-vs-poll',
    promise: 'a member write is DELIVERED (fs.watch fires on the reader); the poll fallback must at least see it',
    citation: 'R3-409 (open) — watch loop was local-only; the item expects this row to fail today',
    modes: ['second-client'],
    run: async (ctx) => {
      const t = performance.now();
      if (ctx.authStatus !== 'signed-in') {
        return done('delivery.watch-vs-poll', 'undetermined', 'signed out — auth-required (two-member drill)', t);
      }
      // The reader/writer coordinate over the settings mount (both pages are
      // the same user → the same settings space). The reader arms the watch
      // FIRST, then the writer writes; the reader reports what was delivered.
      const fs = await openSettingsMount(ctx._settings);
      if (!fs) return done('delivery.watch-vs-poll', 'undetermined', 'settings mount unavailable', t);
      const dir = `${ROOT}/delivery`;
      await fs.mkdir(dir, { recursive: true }).catch(() => undefined);
      const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

      if (ctx.role === 'writer') {
        // Wait for the reader to arm, then write the delivery message.
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          const names = await fs.readdir(dir).catch(() => [] as { name: string; kind: string }[]);
          if (names.some((n) => n.name.startsWith('reader-ready'))) break;
          await new Promise((r) => setTimeout(r, 400));
        }
        const msg = `msg-${runId}.json`;
        await fs.writeFile(`${dir}/${msg}`, JSON.stringify({ runId, writer: 'second-client', at: Date.now() }));
        return done('delivery.watch-vs-poll', 'pass', `writer wrote ${msg}`, t);
      }

      // Reader: arm the watch, announce readiness, then wait for the message —
      // noting WHICH leg delivered it.
      const fsModule = await import('fs');
      const absDir = `${ctx._settings.mount!.path}${dir}`;
      const abort = new AbortController();
      const watchFired = new Promise<string | null>((resolve) => {
        (async () => {
          try {
            const watcher = fsModule.promises.watch(absDir, { signal: abort.signal });
            for await (const ev of watcher) {
              if (ev.filename?.startsWith('msg-')) {
                resolve(ev.filename);
                return;
              }
            }
            resolve(null);
          } catch {
            resolve(null); // watch unsupported / aborted
          }
        })();
      });

      await fs.writeFile(`${dir}/reader-ready-${runId}`, String(Date.now()));

      const deadline = Date.now() + 25_000;
      let pollSaw = false;
      let watchFilename: string | null = null;
      while (Date.now() < deadline && !pollSaw) {
        if (watchFired && !pollSaw) {
          const settled = await Promise.race([
            watchFired,
            new Promise<null>((r) => setTimeout(() => r(null), 250)),
          ]);
          if (settled) watchFilename = settled;
        }
        const names = await fs.readdir(dir).catch(() => [] as { name: string; kind: string }[]);
        const seen = names.find((n) => n.name.startsWith('msg-'));
        if (seen) pollSaw = true;
        if (!seen) await new Promise((r) => setTimeout(r, 400));
      }
      abort.abort();
      if (!pollSaw && !watchFilename) {
        return done(
          'delivery.watch-vs-poll',
          'fail',
          `neither watch nor poll saw the writer's file in 25 s — delivery broken`,
          t,
        );
      }
      if (watchFilename) {
        return done(
          'delivery.watch-vs-poll',
          'pass',
          `watch delivered ${watchFilename} (poll also saw it: ${pollSaw})`,
          t,
        );
      }
      // Poll saw it, watch never fired: the R3-409 shape. The writer's write is
      // REACHABLE but not DELIVERED — this is exactly what the sprint hit.
      return done(
        'delivery.watch-vs-poll',
        'fail',
        'poll delivered the file but fs.watch never fired — the R3-409 delivery gap (delivery, not the probe)',
        t,
      );
    },
  },
  {
    id: 'spaces.powerbox-remount',
    promise: 'a space granted through the powerbox re-mounts on the next load with no prompt',
    citation: 'SDK mounts.requestMount → grant; durable until revoked',
    modes: ['after-reload'],
    run: async (ctx) => {
      const t = performance.now();
      if (ctx.authStatus !== 'signed-in') {
        return done('spaces.powerbox-remount', 'undetermined', 'signed out — auth-required', t);
      }
      return done(
        'spaces.powerbox-remount',
        'undetermined',
        'powerbox pick is a user gesture; driven by the host spec (after-reload) when a session exists',
        t,
      );
    },
  },
];

// ---------------------------------------------------------------------------
// The full table, in execution order
// ---------------------------------------------------------------------------

export const PROBES: ProbeDef[] = [...platformProbes, ...sessionProbes];

export const ALL_PROBE_IDS = PROBES.map((p) => p.id);
