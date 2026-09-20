import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Keeps live location updates flowing during an active incident once the
 * screen locks or the app backgrounds — see
 * android/app/src/main/java/com/smartwarning/app/IncidentLocationService.java
 * for what this actually does (holds a foreground-service slot; does not
 * read location itself) and why.
 *
 * Android only, for now: the equivalent iOS mechanism (a location background
 * mode + NSLocationAlwaysAndWhenInUseUsageDescription) was deliberately left
 * out of this pass — see SMART_WARNING_FIX_PLAN.md's P1-2 write-up. Calling
 * these on iOS, the web, or a build without the native plugin registered is
 * always a safe, silent no-op.
 */
interface IncidentLocationPlugin {
  start(): Promise<{ error?: string } | void>;
  stop(): Promise<void>;
}

const IncidentLocation = registerPlugin<IncidentLocationPlugin>('IncidentLocation');

function supported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

/**
 * Start the foreground service. Never throws, and never something the SOS
 * flow waits on — this is an exemption from background throttling, not part
 * of the alert path itself, and a device that refuses it (an aggressive OEM
 * battery-saver mode, for instance) must not be treated as an SOS failure.
 */
export async function startIncidentLocation(): Promise<void> {
  if (!supported()) return;
  try {
    const res = await IncidentLocation.start();
    if (res && 'error' in res && res.error) {
      console.warn('[incident-location] foreground service could not start:', res.error);
    }
  } catch (e) {
    console.warn('[incident-location] start failed:', e instanceof Error ? e.message : e);
  }
}

/** Stop the foreground service. Safe to call even if it was never started. */
export async function stopIncidentLocation(): Promise<void> {
  if (!supported()) return;
  try {
    await IncidentLocation.stop();
  } catch (e) {
    console.warn('[incident-location] stop failed:', e instanceof Error ? e.message : e);
  }
}
