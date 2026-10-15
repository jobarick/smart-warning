// The Android app declares no microphone permission, so the voice note button
// must not appear there: it could only ever fail.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

const native = vi.hoisted(() => ({ value: false }));
vi.mock('../lib/platform', () => ({ isNativeApp: () => native.value }));

import { VoiceNoteButton } from './VoiceNoteButton';

afterEach(() => { cleanup(); native.value = false; });

function withRecorder() {
  Object.defineProperty(window, 'MediaRecorder', { value: class { static isTypeSupported() { return true; } }, configurable: true });
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => ({}) }, configurable: true });
}

describe('VoiceNoteButton', () => {
  it('shows in a browser that can record', () => {
    withRecorder();
    const { container } = render(<VoiceNoteButton incidentId="i1" token="t" locale="en" />);
    expect(container.querySelector('.voice-note')).not.toBeNull();
  });

  it('is hidden in the Android app, which has no microphone permission', () => {
    withRecorder();
    native.value = true;
    const { container } = render(<VoiceNoteButton incidentId="i1" token="t" locale="en" />);
    expect(container.querySelector('.voice-note')).toBeNull();
  });
});
