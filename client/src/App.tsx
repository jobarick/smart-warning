import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AlertMessage,
  AlertType,
  AllClearMessage,
  LogEntry,
  RespondingMessage,
  Severity,
  SirenTone,
  SystemStatusLevel,
  WireMessage,
  WorkerInfo,
} from './types';
import { ALERT_META, severityWants } from './types';
import { loadSettings, saveSettings, makeOperatorId } from './lib/settings';
import { startVibration, stopVibration } from './lib/haptics';
import { useAlertSocket } from './hooks/useAlertSocket';
import { useAlarmState } from './hooks/useAlarmState';
import { useSiren } from './hooks/useSiren';
import { useSelfTelemetry } from './hooks/useSelfTelemetry';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { AlertOverlay } from './components/AlertOverlay';
import { OperatorStatus } from './components/OperatorStatus';
import { SosPanel } from './components/SosPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { ConnectionStatus, type AppView } from './components/ConnectionStatus';
import { AlertLog } from './components/AlertLog';
import { SystemStatusBar } from './components/SystemStatusBar';
import { SystemFooter } from './components/SystemFooter';
import { Icon } from './components/Icon';
import { Logo } from './components/Logo';
import { getProfile, alertLabel } from './lib/profiles';
import { useIncidentHistory } from './hooks/useIncidentHistory';
import { AuthGate } from './components/AuthGate';
import { ConsentGate } from './components/ConsentGate';
import { hasAcceptedCurrentTerms, saveConsent } from './lib/consent';
import { TERMS_VERSION } from './lib/terms';
import { PushToggle } from './components/PushToggle';
import { EmergencyCallPocket } from './components/EmergencyCallPocket';
import { SafeRoutePanel } from './components/SafeRoutePanel';
import { ContactSupport } from './components/ContactSupport';
import { unsubscribe as unsubscribePush } from './lib/push';
import { nativePushSupported, registerForPush, unregisterFromPush, attachHandlers } from './lib/nativePush';
import { STALE_REPLAY_MS } from './lib/outbox';
import * as trackBuffer from './lib/trackBuffer';
import { fetchHealth, fetchMe, fetchReports, escalateReport, dismissReport, recordConsent, type Report } from './lib/api';

// ---------------------------------------------------------------------------
// Deferred surfaces
// ---------------------------------------------------------------------------
// Split out of the initial bundle so the emergency screen is interactive as
// early as possible on a slow connection.
//
// THE RULE: nothing on the emergency path may be lazy. SosPanel, AlertOverlay,
// SystemStatusBar, OperatorStatus, EmergencyCallPocket and SafeRoutePanel stay
// eagerly imported above — an alarm must never wait on a network fetch, and a
// chunk that fails to arrive must never be the reason someone cannot call for
// help. Everything below is either administrative or reference material that a
// person consults at a desk, not during an incident.
//
// These chunks are still precached by the service worker on first visit, so
// after one load they open instantly and work offline like the rest of the app.
const MapPanel = lazy(() => import('./components/MapPanel').then((m) => ({ default: m.MapPanel })));
const CommandDashboard = lazy(() => import('./components/CommandDashboard').then((m) => ({ default: m.CommandDashboard })));
const FeedbackCenter = lazy(() => import('./components/FeedbackCenter').then((m) => ({ default: m.FeedbackCenter })));
const DestinationsManager = lazy(() => import('./components/DestinationsManager').then((m) => ({ default: m.DestinationsManager })));
const BillingPanel = lazy(() => import('./components/BillingPanel').then((m) => ({ default: m.BillingPanel })));

// Deliberately plain: a spinner that appears for one frame is noise, and these
// panels are never on a critical path where a richer skeleton would earn its
// keep.
function PanelFallback({ label }: { label: string }) {
  return <div className="panel-loading" role="status" aria-live="polite">Loading {label}…</div>;
}
import {
  loadSession,
  saveSession,
  clearSession,
  joinCredentials,
  sessionToken,
  sessionName,
  type Session,
} from './lib/session';

const VIEW_KEY = 'alert-system-view';
const SAFE_FOR_KEY = 'sw-safe-for-v1';

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [alarm, dispatch] = useAlarmState();
  const [log, setLog] = useState<LogEntry[]>([]);
  // Bumped on every local alert/all-clear so the supervisor history refetches.
  const [incidentTick, setIncidentTick] = useState(0);
  // Standing status set by a supervisor, plus the liveness facts the status bar
  // and footer report. 'emergency' is derived from an active alert, not stored.
  const [standing, setStanding] = useState<{ level: SystemStatusLevel; note: string }>({ level: 'clear', note: '' });
  // Read once at mount: this device has already accepted the current terms.
  const [consented, setConsented] = useState(() => hasAcceptedCurrentTerms());
  const [responder, setResponder] = useState<RespondingMessage | null>(null);
  const [lastAlert, setLastAlert] = useState<number | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [reportTick, setReportTick] = useState(0);
  const [sirenTesting, setSirenTesting] = useState(false);
  // The incident this person has confirmed they are safe for. Held as an id, not
  // a flag, so it can never carry over from one emergency into the next, and
  // persisted so a reload during an evacuation does not silently retract an
  // answer the supervisor has already counted.
  const [safeFor, setSafeForState] = useState<string | null>(() => localStorage.getItem(SAFE_FOR_KEY));
  const setSafeFor = useCallback((id: string | null) => {
    setSafeForState(id);
    if (id) localStorage.setItem(SAFE_FOR_KEY, id);
    else localStorage.removeItem(SAFE_FOR_KEY);
  }, []);
  const [view, setView] = useState<AppView>(() => (localStorage.getItem(VIEW_KEY) === 'command' ? 'command' : 'worker'));
  const [showSettings, setShowSettings] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  // Plans & billing. Supervisors only — it needs an account token, and it is
  // administrative by definition. Nothing here can reach the alert path.
  const [showBilling, setShowBilling] = useState(false);
  // Supervisor configuration (destinations, feedback). Rendered instead of the
  // dashboard rather than beside it — the command centre is viewport-locked and
  // a sibling section would break its no-scroll layout.
  const [showTools, setShowTools] = useState(false);
  // Multi-tenant auth. orgsMode: null = still checking the backend, true =
  // accounts required, false = legacy single-room (no login).
  const [orgsMode, setOrgsMode] = useState<boolean | null>(null);
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const { armed, arm, siren } = useSiren();
  const profile = useMemo(() => getProfile(settings.profileId), [settings.profileId]);
  const sessionId = useRef<string>(crypto.randomUUID());
  const telemetry = useSelfTelemetry(settings.shareLocation);
  const network = useNetworkStatus();
  const telemetryRef = useRef(telemetry);
  telemetryRef.current = telemetry;
  const activeAlertLogRef = useRef<{ id: string; startedAt: number } | null>(null);
  // Wire ids already applied to app state. The outbox replays messages by their
  // original id, so this is what makes delivery at-least-once safe to act on.
  const handledIds = useRef<Set<string>>(new Set());
  const remember = useCallback((id: string) => {
    handledIds.current.add(id);
    // Bounded: only recent ids can plausibly be replayed, and an unbounded set
    // in a tab left open for weeks is a leak nobody would ever look for.
    if (handledIds.current.size > 300) {
      handledIds.current = new Set([...handledIds.current].slice(-150));
    }
  }, []);

  // One-second tick that drives the response-time lap timer.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => localStorage.setItem(VIEW_KEY, view), [view]);

  // Black or white background — applied to the document root so tokens flip.
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  // Assign a stable operator ID the first time (or if the name is set and none exists).
  useEffect(() => {
    if (!settings.operatorId) setSettings((s) => ({ ...s, operatorId: makeOperatorId(s.deviceName) }));
  }, [settings.operatorId]);

  const patchSettings = useCallback((patch: Partial<typeof settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  // Discover whether the backend requires accounts, and validate a stored login.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const health = await fetchHealth();
      if (cancelled) return;
      setOrgsMode(health.orgs);
      // A stale/expired supervisor token shouldn't strand us on a blank app.
      const s = loadSession();
      if (health.orgs && s?.kind === 'supervisor') {
        const user = await fetchMe(s.token);
        if (cancelled) return;
        if (user) setSession({ kind: 'supervisor', token: s.token, user });
        else { clearSession(); setSession(null); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const onAuthed = useCallback((s: Session) => {
    saveSession(s);
    setSession(s);
    setAuthNotice(null);
    const nm = sessionName(s);
    if (nm) setSettings((prev) => ({ ...prev, deviceName: nm }));
    setView(s.kind === 'supervisor' ? 'command' : 'worker');
  }, []);

  // Accepting the terms must never depend on the network.
  //
  // The local record is written first and the screen advances immediately; the
  // durable server-side record is attempted afterwards and its failure is
  // swallowed. Someone who has just agreed, on a bad connection, in a building
  // where something is wrong, must not be held on a legal screen because a POST
  // timed out.
  const acceptTerms = useCallback(
    (points: string[]) => {
      saveConsent(points);
      setConsented(true);
      const creds = joinCredentials(session) ?? {};
      if (creds.token || creds.orgCode) {
        void recordConsent({ version: TERMS_VERSION, points }, creds).catch(() => {
          /* the local record stands; the server copy can be re-sent later */
        });
      }
    },
    [session],
  );

  const signOut = useCallback(() => {
    // Capture the credentials NOW. Both unregister calls are asynchronous and
    // await the service worker before they touch the network, so by the time
    // they build their request the session below is already gone — and the
    // backend requires org credentials to unregister a device, precisely so
    // that holding a push token is not enough to silence someone's alerts.
    const creds = joinCredentials(session) ?? {};
    void unsubscribePush(creds); // stop this device receiving the old org's alerts
    void unregisterFromPush(creds); // and the same for the Android app's FCM token
    clearSession();
    setSession(null);
    setView('worker');
  }, [session]);

  // Keep the device identity in sync with the active session.
  useEffect(() => {
    const nm = sessionName(session);
    if (nm && nm !== settings.deviceName) patchSettings({ deviceName: nm });
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  // Native push. The bell in the org bar covers browsers via Web Push; a
  // Capacitor webview has no push service, so the Android app registers with
  // FCM instead. Registration is accepted by the server even before Firebase
  // credentials exist, so the devices already in the field are the ones that
  // receive the first alert once they do.
  useEffect(() => {
    if (!nativePushSupported()) return;
    const creds = joinCredentials(session);
    if (!creds || (!creds.token && !creds.orgCode)) return;
    let cancelled = false;
    void (async () => {
      const res = await registerForPush(creds, settings.deviceName);
      if (cancelled) return;
      if (res.status === 'error') console.warn('[push] native registration failed:', res.error);
      else if (res.delivery === 'pending-credentials') {
        console.info('[push] device registered; server is awaiting Firebase credentials');
      }
    })();
    // Tapping a notification only needs to bring the app forward — the relay is
    // the authority on state and the socket reconciles it on resume.
    void attachHandlers({});
    return () => { cancelled = true; };
  }, [session, settings.deviceName]);

  // The app only runs its socket/dashboard once we're past the auth gate.
  const runApp = orgsMode === false || !!session;
  const joinCreds = useMemo(() => joinCredentials(session), [session]);
  const token = sessionToken(session);

  const handleWire = useCallback(
    (m: WireMessage) => {
      // Any message at all is proof the relay is alive — including the roster
      // that arrives every few seconds while nothing is happening.
      setLastSync(Date.now());

      if (m.kind === 'status') {
        setStanding({ level: m.status, note: m.note });
        return;
      }

      // A supervisor is on their way. Kept only while it refers to the alarm
      // actually ringing, so it can never be shown against a later one.
      if (m.kind === 'responding') {
        setResponder(m.cancelled ? null : m);
        return;
      }

      if (m.kind === 'reports') {
        setReportTick((t) => t + 1);
        return;
      }

      if (m.kind === 'alert') {
        // A device that raised this while offline already handled it locally,
        // and the relay echoes it back on replay. Without this guard the same
        // emergency would be logged twice and re-raised after its all-clear.
        if (handledIds.current.has(m.id)) return;
        remember(m.id);

        setSirenTesting(false);
        setLastAlert(m.timestamp);
        setIncidentTick((t) => t + 1);

        // An alert delivered long after it was raised is recorded but does not
        // sound. The relay normally diverts these to the supervisor's queue
        // before they ever reach a room; this is the same judgement applied on
        // the client, for relays running without a database to divert them to.
        const stale = m.replayed === true && Date.now() - m.timestamp > STALE_REPLAY_MS;
        if (!stale) dispatch({ type: 'RAISE', alert: m });

        const id = crypto.randomUUID();
        activeAlertLogRef.current = { id, startedAt: m.timestamp };
        const tel = telemetryRef.current;
        setLog((l) =>
          [
            {
              id,
              kind: 'alert' as const,
              type: m.type,
              severity: m.severity,
              message: m.message,
              sender: m.sender,
              timestamp: m.timestamp,
              mine: m.sender === settings.deviceName,
              lat: tel.lat,
              lng: tel.lng,
            },
            ...l,
          ].slice(0, 50),
        );
      } else if (m.kind === 'all-clear') {
        if (handledIds.current.has(m.id)) return;
        remember(m.id);
        setIncidentTick((t) => t + 1);
        dispatch({ type: 'CLEAR' });
        const active = activeAlertLogRef.current;
        activeAlertLogRef.current = null;
        setLog((l) => {
          const patched = active
            ? l.map((e) => (e.id === active.id ? { ...e, durationMs: m.timestamp - active.startedAt } : e))
            : l;
          return [
            {
              id: crypto.randomUUID(),
              kind: 'all-clear' as const,
              sender: m.sender,
              timestamp: m.timestamp,
              mine: m.sender === settings.deviceName,
            },
            ...patched,
          ].slice(0, 50);
        });
      }
    },
    [dispatch, remember, settings.deviceName],
  );

  // This device's own status for the shared roster: 'sos' while an alert it
  // raised is still active, otherwise 'safe'.
  const selfStatus = alarm.alert && alarm.alert.sender === settings.deviceName ? 'sos' : 'safe';

  const getSelfInfo = useCallback(
    (): WorkerInfo => ({
      id: sessionId.current,
      name: settings.deviceName,
      role: view === 'command' ? 'supervisor' : 'worker',
      status: selfStatus,
      zone: settings.zone,
      battery: telemetry.battery,
      charging: telemetry.charging,
      lat: settings.shareLocation ? telemetry.lat : null,
      lng: settings.shareLocation ? telemetry.lng : null,
      accuracy: settings.shareLocation ? telemetry.accuracy : null,
      safeFor,
      updatedAt: Date.now(),
    }),
    [settings.deviceName, settings.zone, settings.shareLocation, view, selfStatus, telemetry, safeFor],
  );

  const { status, deviceCount, roster, joinRejected, send, sendHeartbeat, queued, queuedSince } = useAlertSocket(
    handleWire,
    getSelfInfo,
    joinCreds,
    runApp,
  );

  // A rejected join (bad code / expired token) sends the user back to the gate.
  useEffect(() => {
    if (!joinRejected) return;
    clearSession();
    setSession(null);
    setView('worker');
    setAuthNotice(
      session?.kind === 'worker'
        ? "That team code wasn't recognized. Check it and try again."
        : 'Your session has expired. Please sign in again.',
    );
  }, [joinRejected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persisted incident history for the supervisor view (only polled while it's open).
  const history = useIncidentHistory(view === 'command', incidentTick, token);

  // Public reports awaiting review. Only supervisors can see or act on them,
  // and the relay pokes us (reportTick) whenever the queue changes.
  useEffect(() => {
    if (view !== 'command' || !token) {
      setReports([]);
      return;
    }
    let cancelled = false;
    fetchReports(token)
      .then((r) => !cancelled && (setReports(r), setReportsError(null)))
      .catch((e: unknown) => !cancelled && setReportsError(e instanceof Error ? e.message : 'could not load reports'));
    return () => {
      cancelled = true;
    };
  }, [view, token, reportTick]);

  const onEscalateReport = useCallback(
    async (id: string, type: AlertType, severity: Severity) => {
      await escalateReport(id, { type, severity }, token);
      setReportTick((t) => t + 1);
    },
    [token],
  );

  const onDismissReport = useCallback(
    async (id: string) => {
      await dismissReport(id, token);
      setReportTick((t) => t + 1);
    },
    [token],
  );

  // Push a heartbeat immediately when meaningful telemetry changes, so the
  // command roster reflects SOS / location / battery without waiting for the tick.
  useEffect(() => {
    sendHeartbeat();
  }, [selfStatus, safeFor, telemetry.lat, telemetry.lng, telemetry.battery, settings.zone, settings.deviceName, view, sendHeartbeat]);

  // While the relay is unreachable during a live incident, keep the positions
  // on the device. The relay records a movement track only between an alert and
  // its all-clear, so a signal drop mid-evacuation would otherwise leave a hole
  // in exactly the stretch of trail a supervisor most needs to see.
  useEffect(() => {
    if (status === 'open') return;
    const id = alarm.alert?.id;
    if (!id || !settings.shareLocation) return;
    if (telemetry.lat === null || telemetry.lng === null) return;
    trackBuffer.record(id, {
      lat: telemetry.lat,
      lng: telemetry.lng,
      accuracy: telemetry.accuracy,
      at: Date.now(),
    });
  }, [status, alarm.alert, settings.shareLocation, telemetry.lat, telemetry.lng, telemetry.accuracy]);

  // "I am safe" — the one piece of state only the person can supply. Stamped
  // with the incident id so the supervisor's roll call counts answers to *this*
  // emergency, and pushed straight out rather than waiting for the next tick.
  const confirmSafe = useCallback(() => {
    const id = alarm.alert?.id;
    if (!id) return;
    setSafeFor(id);
  }, [alarm.alert]);

  const trigger = useCallback(
    (type: AlertType, severity: Severity, message: string) => {
      void arm(); // we're inside a user gesture — unlock audio for later sirens
      const alert: AlertMessage = {
        kind: 'alert',
        id: crypto.randomUUID(),
        type,
        severity,
        message,
        sender: settings.deviceName,
        timestamp: Date.now(),
      };
      // Server echoes to everyone including us; if offline, fire locally anyway.
      if (!send(alert)) handleWire(alert);
    },
    [arm, send, handleWire, settings.deviceName],
  );

  const allClear = useCallback(() => {
    const msg: AllClearMessage = {
      kind: 'all-clear',
      id: crypto.randomUUID(),
      sender: settings.deviceName,
      timestamp: Date.now(),
    };
    if (!send(msg)) handleWire(msg);
  }, [send, handleWire, settings.deviceName]);

  // Tell the site this supervisor is on their way.
  //
  // Sent over the relay rather than the REST API so it reaches the person's
  // screen at alarm speed. Deliberately NOT queued in the outbox on failure:
  // an ETA is only true for a minute or two, and replaying a stale one after a
  // reconnect would tell somebody help was two minutes away when it is not.
  const onRespond = useCallback(
    (r: { incidentId: string; etaS: number | null; distanceM: number | null; routed: boolean }) => {
      send({ kind: 'responding', ...r, supervisor: settings.deviceName, timestamp: Date.now() });
    },
    [send, settings.deviceName],
  );

  // Supervisor sets the standing status. Applied locally too, so a relay that
  // is briefly down doesn't leave the person who pressed it staring at nothing.
  const setSystemStatus = useCallback(
    (level: SystemStatusLevel, note = '') => {
      const msg: WireMessage = {
        kind: 'status',
        status: level,
        note,
        sender: settings.deviceName,
        timestamp: Date.now(),
      };
      if (!send(msg)) handleWire(msg);
    },
    [send, handleWire, settings.deviceName],
  );

  const testAlarm = useCallback(() => {
    void arm();
    handleWire({
      kind: 'alert',
      id: crypto.randomUUID(),
      type: 'security',
      severity: 'high',
      message: 'This is a local test alarm — other devices are not affected.',
      sender: `${settings.deviceName} (local test)`,
      timestamp: Date.now(),
    });
  }, [arm, handleWire, settings.deviceName]);

  const toggleSirenTest = useCallback(async () => {
    await arm();
    setSirenTesting((v) => !v);
  }, [arm]);

  // Which tone should be sounding right now (alarm takes priority over testing).
  const activeTone: SirenTone | null = useMemo(() => {
    if (settings.silentMode) return null;
    if (alarm.alert && !alarm.acknowledged && severityWants(alarm.alert.severity).siren) {
      return settings.sirenTone === 'auto' ? ALERT_META[alarm.alert.type].tone : settings.sirenTone;
    }
    if (sirenTesting) return settings.sirenTone === 'auto' ? 'wail' : settings.sirenTone;
    return null;
  }, [alarm, sirenTesting, settings.sirenTone, settings.silentMode]);

  useEffect(() => {
    if (activeTone && armed) {
      siren.start(activeTone, settings.volume);
    } else {
      siren.stop();
    }
    return () => siren.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTone, armed]);

  useEffect(() => siren.setVolume(settings.volume), [settings.volume, siren]);

  // Vibration (mobile)
  const vibrationOn =
    !!alarm.alert && !alarm.acknowledged && settings.vibration && severityWants(alarm.alert.severity).vibration;
  useEffect(() => {
    if (vibrationOn && alarm.alert) {
      startVibration(alarm.alert.severity);
    } else {
      stopVibration();
    }
    return stopVibration;
  }, [vibrationOn, alarm.alert]);

  // Keep the screen awake while an alert is active.
  const alarmActive = !!alarm.alert;
  useEffect(() => {
    if (!alarmActive) return;
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock
      ?.request('screen')
      .then((l) => {
        lock = l;
      })
      .catch(() => {});
    return () => {
      lock?.release().catch(() => {});
    };
  }, [alarmActive]);

  // Optional fullscreen on alert (worker view only — the command view shouldn't take over).
  useEffect(() => {
    if (view !== 'worker') return;
    if (alarmActive && settings.autoFullscreen && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    if (!alarmActive && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alarmActive, view]);

  // Still checking the backend — brief splash to avoid a flash of the wrong UI.
  if (orgsMode === null) {
    return (
      <div className="app">
        <div className="boot-splash"><Logo size={26} className="boot-logo" decorative /> <span>Connecting…</span></div>
      </div>
    );
  }

  // Accounts required but not signed in → the entry gate.
  if (orgsMode && !session) {
    return <AuthGate onAuthed={onAuthed} notice={authNotice} />;
  }

  // Terms & Conditions, once per device, after joining or signing in.
  //
  // Placed AFTER the auth gate on purpose: the confirmations are about how this
  // person will use the service, so they belong once someone is actually
  // entering it, not in front of a sign-in form. Raising TERMS_VERSION brings
  // this screen back for everybody.
  if (!consented) {
    return <ConsentGate onAccept={acceptTerms} />;
  }

  const org = session?.kind === 'supervisor' ? session.user.org : undefined;
  const workerCode = session?.kind === 'worker' ? session.orgCode : undefined;

  // An active alarm outranks anything a supervisor set by hand.
  const statusLevel: SystemStatusLevel = alarm.alert ? 'emergency' : standing.level;

  return (
    <div className="app">
      <SystemStatusBar
        level={statusLevel}
        note={alarm.alert ? '' : standing.note}
        lastAlert={lastAlert}
        now={now}
      />
      <ConnectionStatus
        status={status}
        deviceCount={deviceCount}
        audioArmed={armed}
        onArmAudio={() => void arm()}
        view={view}
        onViewChange={setView}
        userName={settings.deviceName}
        theme={settings.theme}
        onToggleTheme={() => patchSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
      />

      {session && (
        <div className="org-bar">
          {org ? (
            <span className="org-info">
              <b>{org.name}</b>
              <span className="org-code" title="Share this code with your workers">Team code {org.joinCode}</span>
              {org.publicCode && (
                <a
                  className="org-public"
                  href={`/r/${org.publicCode}`}
                  target="_blank"
                  rel="noreferrer"
                  title="Public reporting page — safe to print or share. Reports queue for your review."
                >
                  Public report link
                </a>
              )}
            </span>
          ) : (
            <span className="org-info"><b>Team {workerCode}</b><span className="org-code">{settings.deviceName}</span></span>
          )}
          {joinCreds && <PushToggle creds={joinCreds} />}
          {org && !showTools && !showSupport && (
            <button className="org-tools" onClick={() => setShowTools(true)} title="Safe destinations and feedback">
              <Icon name="map-pin" /> Setup
            </button>
          )}
          {org && token && (
            <button className="org-tools" onClick={() => setShowBilling((v) => !v)} title="Plans, payment and invoices">
              <Icon name="check-circle" /> {showBilling ? 'Close' : 'Plans'}
            </button>
          )}
          <button className="org-support" onClick={() => setShowSupport((v) => !v)}>
            <Icon name="help" /> {showSupport ? 'Close' : 'Support'}
          </button>
          <button className="org-signout" onClick={signOut}>
            <Icon name="exit" /> {org ? 'Sign out' : 'Leave'}
          </button>
        </div>
      )}

      {showSupport ? (
        <main className="worker">
          <ContactSupport onBack={() => setShowSupport(false)} />
        </main>
      ) : showBilling && token ? (
        <main className="worker">
          <Suspense fallback={<PanelFallback label="plans" />}>
            <BillingPanel token={token} onBack={() => setShowBilling(false)} />
          </Suspense>
        </main>
      ) : view === 'command' && showTools ? (
        <main className="worker">
          <button className="btn back-btn" onClick={() => setShowTools(false)}>
            <Icon name="arrow-left" /> Back to command centre
          </button>
          <Suspense fallback={<PanelFallback label="tools" />}>
            <DestinationsManager token={token} roster={roster} />
            <FeedbackCenter token={token} />
          </Suspense>
        </main>
      ) : view === 'command' ? (
        <Suspense fallback={<PanelFallback label="command centre" />}>
        <CommandDashboard
          roster={roster}
          alarm={alarm}
          log={log}
          history={history.incidents}
          stats={history.stats}
          persistence={history.persistence}
          historyError={history.error}
          profile={profile}
          selfName={settings.deviceName}
          status={status}
          onAcknowledge={() => dispatch({ type: 'ACKNOWLEDGE' })}
          onAllClear={allClear}
          standing={standing.level}
          onSetStatus={setSystemStatus}
          reports={reports}
          reportsError={reportsError}
          onEscalateReport={onEscalateReport}
          onDismissReport={onDismissReport}
          token={token}
          selfPosition={telemetry.lat !== null && telemetry.lng !== null ? { lat: telemetry.lat, lng: telemetry.lng } : null}
          onRespond={onRespond}
        />
        </Suspense>
      ) : showSettings ? (
        <main className="worker">
          <button className="btn back-btn" onClick={() => setShowSettings(false)}>
            <Icon name="arrow-left" /> Back to SOS
          </button>
          <SettingsPanel
            settings={settings}
            onChange={patchSettings}
            onTestSiren={() => void toggleSirenTest()}
            onTestAlarm={testAlarm}
            sirenTesting={sirenTesting}
          />
        </main>
      ) : (
        <main className="worker">
          <SosPanel profile={profile} disabled={alarmActive} onTrigger={trigger} />
          {/* Both of these are quiet until they matter: the route panel renders
              nothing without a live alert, and the call pocket sits collapsed
              until one opens it. */}
          <SafeRoutePanel
            alertType={alarm.alert?.type ?? null}
            lat={settings.shareLocation ? telemetry.lat : null}
            lng={settings.shareLocation ? telemetry.lng : null}
            creds={joinCreds ?? {}}
            operatorId={sessionId.current}
          />
          <EmergencyCallPocket
            lat={telemetry.lat}
            lng={telemetry.lng}
            alertType={alarm.alert?.type ?? null}
          />
          <OperatorStatus
            name={settings.deviceName}
            operatorId={settings.operatorId}
            telemetry={telemetry}
            network={network}
            shareLocation={settings.shareLocation}
            assembly={{ lat: settings.assemblyLat, lng: settings.assemblyLng, label: settings.assemblyLabel }}
            alarm={alarm}
            now={now}
          />
          {/* The map and the history are reference, not action. Keeping them on
              the primary screen pushed the SOS and the live telemetry into a
              second scroll; behind a toggle, the screen someone opens under
              pressure is only the parts they act on. */}
          {showMore && (
            <>
              <Suspense fallback={<PanelFallback label="map" />}>
                <MapPanel
                  userLat={telemetry.lat}
                  userLng={telemetry.lng}
                  assembly={{ lat: settings.assemblyLat, lng: settings.assemblyLng, label: settings.assemblyLabel }}
                />
              </Suspense>
              <AlertLog entries={log} />
            </>
          )}
          <div className="worker-tools">
            <button className="btn settings-link" onClick={() => setShowMore((v) => !v)}>
              {showMore ? 'Hide map & history' : 'Map & history'}
            </button>
            <button className="btn settings-link" onClick={() => setShowSettings(true)}>
              <Icon name="settings" /> Settings
            </button>
            <button className="btn settings-link" onClick={() => setShowSupport(true)}>
              <Icon name="help" /> Support
            </button>
          </div>
        </main>
      )}

      {view === 'worker' && alarm.alert && (
        <AlertOverlay
          alert={alarm.alert}
          acknowledged={alarm.acknowledged}
          settings={settings}
          label={alertLabel(profile, alarm.alert.type)}
          safeConfirmed={safeFor === alarm.alert.id}
          onConfirmSafe={confirmSafe}
          onAcknowledge={() => dispatch({ type: 'ACKNOWLEDGE' })}
          onAllClear={allClear}
          // Matched by incident id at the point of use, so a response to an
          // earlier emergency can never be shown against this one.
          responder={responder && responder.incidentId === alarm.alert.id ? responder : null}
        />
      )}

      <SystemFooter connected={status === 'open'} lastSync={lastSync} now={now} queued={queued} queuedSince={queuedSince} />
    </div>
  );
}
