import { useEffect, useState } from 'react';

export interface Telemetry {
  battery: number | null; // 0–1
  charging: boolean;
  lat: number | null;
  lng: number | null;
  accuracy: number | null; // metres
  locationError: string | null;
  /** When this fix arrived — lets a viewer judge live vs stale, rather than
   *  taking a position on trust just because one is on screen. */
  updatedAt: number | null;
}

interface BatteryLike extends EventTarget {
  level: number;
  charging: boolean;
}

/**
 * Reads this device's battery (Battery Status API, where supported) and — only
 * when `shareLocation` is true — its GPS position via watchPosition. Location
 * requires the browser's permission prompt; denial is surfaced, not thrown.
 */
export function useSelfTelemetry(shareLocation: boolean): Telemetry {
  const [battery, setBattery] = useState<number | null>(null);
  const [charging, setCharging] = useState(false);
  const [pos, setPos] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    const getBattery = (navigator as unknown as { getBattery?: () => Promise<BatteryLike> }).getBattery;
    if (!getBattery) return;
    let bat: BatteryLike | null = null;
    let cancelled = false;
    const update = () => {
      if (!bat) return;
      setBattery(bat.level);
      setCharging(bat.charging);
    };
    getBattery.call(navigator).then((b) => {
      if (cancelled) return;
      bat = b;
      update();
      b.addEventListener('levelchange', update);
      b.addEventListener('chargingchange', update);
    });
    return () => {
      cancelled = true;
      bat?.removeEventListener('levelchange', update);
      bat?.removeEventListener('chargingchange', update);
    };
  }, []);

  useEffect(() => {
    if (!shareLocation) {
      setPos(null);
      setLocationError(null);
      setUpdatedAt(null);
      return;
    }
    if (!('geolocation' in navigator)) {
      setLocationError('Location not available on this device');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
        setLocationError(null);
        // The fix's own timestamp, not when the callback ran — a cached fix
        // handed back immediately (maximumAge above) is not a fresh one.
        setUpdatedAt(p.timestamp);
      },
      (err) => setLocationError(err.code === err.PERMISSION_DENIED ? 'Location permission denied' : 'Location unavailable'),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [shareLocation]);

  return {
    battery,
    charging,
    lat: pos?.lat ?? null,
    lng: pos?.lng ?? null,
    accuracy: pos?.accuracy ?? null,
    locationError,
    updatedAt,
  };
}
