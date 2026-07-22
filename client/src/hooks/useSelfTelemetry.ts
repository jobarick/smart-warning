import { useEffect, useState } from 'react';

export interface Telemetry {
  battery: number | null; // 0–1
  charging: boolean;
  lat: number | null;
  lng: number | null;
  accuracy: number | null; // metres
  locationError: string | null;
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

  useEffect(() => {
    const getBattery = (navigator as unknown as { getBattery?: () => Promise<BatteryLike> }).getBattery;
    if (!getBattery) return;
    let bat: BatteryLike | null = null;
    const update = () => {
      if (!bat) return;
      setBattery(bat.level);
      setCharging(bat.charging);
    };
    getBattery.call(navigator).then((b) => {
      bat = b;
      update();
      b.addEventListener('levelchange', update);
      b.addEventListener('chargingchange', update);
    });
    return () => {
      bat?.removeEventListener('levelchange', update);
      bat?.removeEventListener('chargingchange', update);
    };
  }, []);

  useEffect(() => {
    if (!shareLocation) {
      setPos(null);
      setLocationError(null);
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
  };
}
