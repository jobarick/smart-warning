import type { Settings, SirenTone } from '../types';
import { SAFE_FLASH_RATE } from '../lib/settings';
import { Icon } from './Icon';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onTestSiren: () => void;
  onTestAlarm: () => void;
  sirenTesting: boolean;
}

const TONES: { value: Settings['sirenTone']; label: string }[] = [
  { value: 'auto', label: 'Auto (per alert type)' },
  { value: 'wail', label: 'Classic wail' },
  { value: 'yelp', label: 'Yelp (fast sweep)' },
  { value: 'hilo', label: 'Hi-lo two-tone' },
  { value: 'pulse', label: 'Pulse beep' },
  { value: 'phaser', label: 'Phaser sweep' },
];

export function SettingsPanel({ settings, onChange, onTestSiren, onTestAlarm, sirenTesting }: Props) {
  const maxRate = settings.allowFastStrobe ? 10 : SAFE_FLASH_RATE;

  return (
    <section className="panel">
      <h2>Emergency controls</h2>

      <div className="fields-grid">
      <label className="field">
        <span>Device name</span>
        <input
          type="text"
          value={settings.deviceName}
          maxLength={40}
          onChange={(e) => onChange({ deviceName: e.target.value })}
        />
      </label>

      <label className="field">
        <span>Zone / area</span>
        <input
          type="text"
          value={settings.zone}
          maxLength={40}
          placeholder="e.g. Sublevel 2, Line B"
          onChange={(e) => onChange({ zone: e.target.value })}
        />
      </label>

      <label className="field field-check field-wide">
        <input
          type="checkbox"
          checked={settings.shareLocation}
          onChange={(e) => onChange({ shareLocation: e.target.checked })}
        />
        <span>
          Share my location — <em>sends GPS coordinates to the command view so a supervisor can find you</em>
        </span>
      </label>

      <label className="field">
        <span>Border thickness — {settings.borderThickness}px</span>
        <input
          type="range"
          min={10}
          max={80}
          value={settings.borderThickness}
          onChange={(e) => onChange({ borderThickness: Number(e.target.value) })}
        />
      </label>

      <label className="field">
        <span>Brightness — {Math.round(settings.brightness * 100)}%</span>
        <input
          type="range"
          min={30}
          max={100}
          value={Math.round(settings.brightness * 100)}
          onChange={(e) => onChange({ brightness: Number(e.target.value) / 100 })}
        />
      </label>

      <label className="field">
        <span>Flash pattern</span>
        <select
          value={settings.flashMode}
          onChange={(e) => onChange({ flashMode: e.target.value as Settings['flashMode'] })}
        >
          <option value="none">None (border only)</option>
          <option value="pulse">Pulse (soft flashing)</option>
          <option value="strobe">Strobe (high intensity)</option>
        </select>
      </label>

      <label className="field">
        <span>Flash rate — {Math.min(settings.flashRate, maxRate)} / sec</span>
        <input
          type="range"
          min={1}
          max={maxRate}
          step={0.5}
          value={Math.min(settings.flashRate, maxRate)}
          onChange={(e) => onChange({ flashRate: Number(e.target.value) })}
        />
      </label>

      <label className="field field-check field-wide">
        <input
          type="checkbox"
          checked={settings.allowFastStrobe}
          onChange={(e) => onChange({ allowFastStrobe: e.target.checked })}
        />
        <span>
          Allow flash rates above {SAFE_FLASH_RATE}/sec — <em>I understand rapid flashing can trigger
          seizures in photosensitive people</em>
        </span>
      </label>

      <label className="field field-check field-wide">
        <input
          type="checkbox"
          checked={settings.silentMode}
          onChange={(e) => onChange({ silentMode: e.target.checked })}
        />
        <span>
          Silent mode — <em>flash and border only, no siren on this device</em>
        </span>
      </label>

      <label className="field">
        <span>Siren tone</span>
        <select
          value={settings.sirenTone}
          disabled={settings.silentMode}
          onChange={(e) => onChange({ sirenTone: e.target.value as 'auto' | SirenTone })}
        >
          {TONES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Volume — {Math.round(settings.volume * 100)}%</span>
        <input
          type="range"
          min={0}
          max={100}
          disabled={settings.silentMode}
          value={Math.round(settings.volume * 100)}
          onChange={(e) => onChange({ volume: Number(e.target.value) / 100 })}
        />
      </label>

      <label className="field field-check">
        <input
          type="checkbox"
          checked={settings.vibration}
          onChange={(e) => onChange({ vibration: e.target.checked })}
        />
        <span>Vibration (mobile devices)</span>
      </label>

      <label className="field field-check">
        <input
          type="checkbox"
          checked={settings.autoFullscreen}
          onChange={(e) => onChange({ autoFullscreen: e.target.checked })}
        />
        <span>Go fullscreen when an alert fires</span>
      </label>
      </div>

      <div className="settings-actions">
        <button className="btn" onClick={onTestSiren} disabled={settings.silentMode}>
          {sirenTesting ? (
            <>
              <Icon name="stop" /> Stop siren test
            </>
          ) : (
            <>
              <Icon name="volume" /> Test siren
            </>
          )}
        </button>
        <button className="btn" onClick={onTestAlarm}>
          <Icon name="flask" /> Test alarm (this device only)
        </button>
      </div>
    </section>
  );
}
