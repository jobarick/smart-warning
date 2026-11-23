import { useEffect } from 'react';
import { startIncidentLocation, stopIncidentLocation } from '../lib/nativeForegroundService';

export interface IncidentLocationInput {
  /** Personal accounts have no live roster for the service to serve. */
  isPersonal: boolean;
  /**
   * This device is signed in and its relay connection is meant to run. After
   * sign out no position can reach anyone, so the service (and its "sharing
   * your location" notification) must stop even if the alert is still held.
   */
  signedIn: boolean;
  /** The active alert's id, or null when there is none (or after all clear). */
  alertId: string | null;
  /** This device raised the alert: pressing SOS is itself the user action. */
  raisedHere: boolean;
  /** The person tapped Acknowledge on this alert. */
  acknowledged: boolean;
  /** The person answered the roll call ("I am safe") for this alert. */
  safeConfirmed: boolean;
  /** A supervisor on this device told the site they are responding. */
  responded: boolean;
}

/**
 * Whether this device should hold the location foreground service right now.
 *
 * Google Play only allows a location foreground service to start as a
 * continuation of something the person did, so a device that merely
 * received an alert must not start it by itself. On the raiser's device
 * the SOS press is that action; everywhere else it waits until the person
 * acts on the alert (acknowledges it, answers the roll call or responds).
 */
export function shouldHoldIncidentLocation(i: IncidentLocationInput): boolean {
  if (i.isPersonal || !i.signedIn || !i.alertId) return false;
  return i.raisedHere || i.acknowledged || i.safeConfirmed || i.responded;
}

/**
 * Holds a foreground service slot for an active org incident so heartbeats
 * keep reaching the live roster after the screen locks. See
 * nativeForegroundService.ts and IncidentLocationService.java for what the
 * service does and why it is Android only for now.
 */
export function useIncidentLocation(i: IncidentLocationInput): void {
  const hold = shouldHoldIncidentLocation(i);
  useEffect(() => {
    if (!hold) return;
    void startIncidentLocation();
    return () => void stopIncidentLocation();
    // Keyed on the alert's id, a stable primitive, so a new alert object with
    // the same id on every heartbeat re-render never restarts the service,
    // while a new incident or the all clear (id becomes null) stops it.
  }, [hold, i.alertId]);
}
