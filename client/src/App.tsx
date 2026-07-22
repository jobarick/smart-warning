import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AlertMessage, AlertType, AllClearMessage, LogEntry, Severity, SirenTone, WireMessage, WorkerInfo } from './types';
import { ALERT_META, severityWants } from './types';
import { loadSettings, saveSettings } from './lib/settings';
import { startVibration, stopVibration } from './lib/haptics';
import { useAlertSocket } from './hooks/useAlertSocket';
import { useAlarmState } from './hooks/useAlarmState';
import { useSiren } from './hooks/useSiren';
import { useSelfTelemetry } from './hooks/useSelfTelemetry';
import { AlertOverlay } from './components/AlertOverlay';
import { TriggerPanel } from './components/TriggerPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { ConnectionStatus, type AppView } from './components/ConnectionStatus';
import { AlertLog } from './components/AlertLog';
import { CommandDashboard } from './components/CommandDashboard';

const VIEW_KEY = 'alert-system-view';

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [alarm, dispatch] = useAlarmState();
  const [log, setLog] = useState<LogEntry[]>([]);
  const [sirenTesting, setSirenTesting] = useState(false);
  const [view, setView] = useState<AppView>(() => (localStorage.getItem(VIEW_KEY) === 'command' ? 'command' : 'worker'));
  const { armed, arm, siren } = useSiren();
  const sessionId = useRef<string>(crypto.randomUUID());
  const telemetry = useSelfTelemetry(settings.shareLocation);

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => localStorage.setItem(VIEW_KEY, view), [view]);

  const patchSettings = useCallback((patch: Partial<typeof settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  const addLog = useCallback((entry: Omit<LogEntry, 'id'>) => {
    setLog((l) => [{ ...entry, id: crypto.randomUUID() }, ...l].slice(0, 50));
  }, []);

  const handleWire = useCallback(
    (m: WireMessage) => {
      if (m.kind === 'alert') {
        setSirenTesting(false);
        dispatch({ type: 'RAISE', alert: m });
        addLog({
          kind: 'alert',
          type: m.type,
          severity: m.severity,
          message: m.message,
          sender: m.sender,
          timestamp: m.timestamp,
          mine: m.sender === settings.deviceName,
        });
      } else if (m.kind === 'all-clear') {
        dispatch({ type: 'CLEAR' });
        addLog({ kind: 'all-clear', sender: m.sender, timestamp: m.timestamp, mine: m.sender === settings.deviceName });
      }
    },
    [dispatch, addLog, settings.deviceName],
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
      updatedAt: Date.now(),
    }),
    [settings.deviceName, settings.zone, settings.shareLocation, view, selfStatus, telemetry],
  );

  const { status, deviceCount, roster, send, sendHeartbeat } = useAlertSocket(handleWire, getSelfInfo);

  // Push a heartbeat immediately when meaningful telemetry changes, so the
  // command roster reflects SOS / location / battery without waiting for the tick.
  useEffect(() => {
    sendHeartbeat();
  }, [selfStatus, telemetry.lat, telemetry.lng, telemetry.battery, settings.zone, settings.deviceName, view, sendHeartbeat]);

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

  return (
    <div className="app">
      <ConnectionStatus
        status={status}
        deviceCount={deviceCount}
        audioArmed={armed}
        onArmAudio={() => void arm()}
        view={view}
        onViewChange={setView}
      />

      {view === 'command' ? (
        <CommandDashboard
          roster={roster}
          alarm={alarm}
          log={log}
          selfName={settings.deviceName}
          status={status}
          onAcknowledge={() => dispatch({ type: 'ACKNOWLEDGE' })}
          onAllClear={allClear}
        />
      ) : (
        <main className="layout">
          <div className="col">
            <TriggerPanel onTrigger={trigger} disabled={alarmActive} />
            <AlertLog entries={log} />
          </div>
          <div className="col">
            <SettingsPanel
              settings={settings}
              onChange={patchSettings}
              onTestSiren={() => void toggleSirenTest()}
              onTestAlarm={testAlarm}
              sirenTesting={sirenTesting}
            />
          </div>
        </main>
      )}

      {view === 'worker' && alarm.alert && (
        <AlertOverlay
          alert={alarm.alert}
          acknowledged={alarm.acknowledged}
          settings={settings}
          onAcknowledge={() => dispatch({ type: 'ACKNOWLEDGE' })}
          onAllClear={allClear}
        />
      )}
    </div>
  );
}
