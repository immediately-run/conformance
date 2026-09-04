// The conformance runner (R3-492). Runs the probe table, renders each row as
// PASS / FAIL / UNDETERMINED with its citation + detail, and emits a
// machine-readable JSON report the host spec asserts against.
//
// Machine-readable surfaces:
//   <table data-testid="conformance-results">  — one <tr data-probe data-status>
//   <script type="application/json" id="conformance-report"> — the full run
//   <div role="status" data-testid="conformance-done"> — "conformance run complete"
//
// Modes (URL ?mode=…):
//   baseline      — one page load; anonymous rows must PASS, session rows must be
//                   PASS or UNDETERMINED (never FAIL).
//   after-reload  — the spec reloads the page; durable-grant rows run on the 2nd load.
//   second-client — role=reader|writer; the two-page delivery drill (R3-409).
import { useAuth, type AuthState } from '@immediately-run/sdk';
import { useEffect, useMemo, useState } from 'react';
import pkg from '../../package.json';
import { PROBES } from './probes';
import type { ProbeContext, ProbeResult, RunMode, ClientRole } from './types';

function detectHost(): { host: string; hostname: string } {
  const hostname = typeof location !== 'undefined' ? location.hostname : 'unknown';
  if (hostname === 'immediately.run') return { host: 'prod', hostname };
  if (hostname === 'staging.immediately.run') return { host: 'staging', hostname };
  // The app runs inside the sandbox realm, whose hostname is the sandbox origin
  // (sandbox.local.immediately.run / sandbox-m3… / sandbox.immediately.run), so
  // classify by the realm's parent, not the iframe's own host.
  if (hostname === 'local.immediately.run' || hostname.endsWith('.local.immediately.run')) {
    return { host: 'local', hostname };
  }
  if (hostname === 'sandbox.immediately.run' || hostname.endsWith('.immediately.run')) {
    return { host: 'prod', hostname };
  }
  // `import.meta.env` is a Vite-only inject and is UNDEFINED in the sandbox
  // (the host transpiles the app without Vite's define) — guard before reading
  // `.DEV` so the sandbox never throws on this line.
  const viteEnv = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
  if (viteEnv?.DEV) return { host: 'vite-dev', hostname };
  return { host: 'other', hostname };
}

function readParams(): { mode: RunMode; role: ClientRole } {
  const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  const rawMode = params.get('mode');
  const mode: RunMode = rawMode === 'after-reload' ? 'after-reload' : rawMode === 'second-client' ? 'second-client' : 'baseline';
  const role: ClientRole = params.get('role') === 'writer' ? 'writer' : 'reader';
  return { mode, role };
}

function AuthBanner({ auth }: { auth: AuthState }) {
  return (
    <p className="auth-banner">
      auth status: <strong>{auth.status}</strong>
      {auth.user?.login ? ` — login=${auth.user.login}` : auth.status === 'signed-in' ? ' (user.login null — auth:identity not granted)' : ''}
    </p>
  );
}

export function ConformanceRunner() {
  const auth = useAuth();
  const [results, setResults] = useState<Record<string, ProbeResult>>({});
  const [done, setDone] = useState(false);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [startedAt] = useState(() => Date.now());

  const { mode, role } = useMemo(() => readParams(), []);
  const env: ProbeContext['env'] = useMemo(
    () => ({ ...detectHost(), sdkDependency: pkg.dependencies['@immediately-run/sdk'] }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const ctx: ProbeContext = {
      mode,
      role,
      env,
      authStatus: auth.status,
      authLogin: auth.user?.login ?? null,
      _settings: {},
    };
    (async () => {
      // The download probe holds ITS row open for a trusted click the spec
      // makes AFTER the run otherwise completes — so it runs last, and
      // completion (conformance-done) fires when every OTHER probe has
      // resolved. Its row still flips to pass when the click lands.
      const ordered = [...PROBES.filter((p) => p.id !== 'platform.blob-download'), ...PROBES.filter((p) => p.id === 'platform.blob-download')];
      for (const probe of ordered) {
        if (!probe.modes.includes(mode)) continue;
        if (cancelled) return;
        let result: ProbeResult;
        try {
          result = await probe.run(ctx);
        } catch (e) {
          result = {
            id: probe.id,
            status: 'fail',
            detail: `probe threw: ${String(e)}`,
            durationMs: 0,
          };
        }
        if (cancelled) return;
        setResults((prev) => ({ ...prev, [probe.id]: result }));
        if (probe.id !== 'platform.blob-download') {
          setDone(true);
        }
      }
      if (!cancelled) setEndedAt(Date.now());
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.status, auth.user?.login, mode, role, env]);

  const report = useMemo(() => {
    return {
      app: 'immediately-run-conformance',
      sdkVersion: pkg.version,
      env,
      mode,
      role,
      elapsedMs: endedAt !== null ? endedAt - startedAt : null,
      results: PROBES.filter((p) => p.modes.includes(mode)).map((p) => results[p.id] ?? null).filter(Boolean),
    };
  }, [results, mode, role, env, startedAt, endedAt]);

  return (
    <div className="conformance">
      <header>
        <h1>immediately.run conformance</h1>
        <p className="subtitle">
          The app-facing contract, probed live. One row = one platform promise; a failure names the
          promise (its citation), not a UI symptom.
        </p>
        <p className="env">
          env: {env.host} ({env.hostname}) · mode: {mode}
          {mode === 'second-client' ? ` · role: ${role}` : ''} · sdk: {env.sdkDependency} (pkg {pkg.version})
        </p>
        <AuthBanner auth={auth} />
      </header>

      <table data-testid="conformance-results">
        <thead>
          <tr>
            <th>promise</th>
            <th>citation</th>
            <th>status</th>
            <th>detail</th>
          </tr>
        </thead>
        <tbody>
          {PROBES.filter((p) => p.modes.includes(mode)).map((probe) => {
            const r = results[probe.id];
            return (
              <tr key={probe.id} data-probe={probe.id} data-status={r?.status ?? 'running'}>
                <td className="promise">{probe.promise}</td>
                <td className="citation">{probe.citation}</td>
                <td className={`status status-${r?.status ?? 'running'}`}>{r?.status ?? 'running'}</td>
                <td className="detail">{r ? `${r.detail} (${r.durationMs}ms)` : '…'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {done && (
        <div role="status" data-testid="conformance-done">
          conformance run complete
        </div>
      )}

      <script
        type="application/json"
        id="conformance-report"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(report) }}
      />
    </div>
  );
}

export default ConformanceRunner;
