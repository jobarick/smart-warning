// The sign-in screen's way home and its two ways to sign up.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AuthGate } from './AuthGate';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });

function gate(onHome?: () => void) {
  return render(
    <AuthGate onAuthed={() => {}} locale="en" onToggleLocale={() => {}} theme="dark" onThemeChange={() => {}} onHome={onHome} />,
  );
}

describe('AuthGate', () => {
  it('the top-left Smart Warning goes back to the home page', () => {
    const onHome = vi.fn();
    gate(onHome);
    fireEvent.click(screen.getByRole('link', { name: 'Smart Warning home' }));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('without a home page (Android app) it returns to the account chooser', () => {
    window.history.replaceState(null, '', '/get-started?step=login');
    gate();
    expect(document.querySelector('.auth-title')?.textContent).toMatch(/sign in/i);
    fireEvent.click(screen.getByRole('link', { name: 'Smart Warning home' }));
    expect(screen.queryByRole('button', { name: /Start my free trial/ })).not.toBeNull();
  });

  it('sign in offers both a personal account and an organization', () => {
    window.history.replaceState(null, '', '/get-started?step=login');
    gate(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Create a personal account' }));
    expect(document.querySelector('.auth-title')?.textContent).toBe('Create a personal account');
  });

  it('and the organization door from sign in still works', () => {
    window.history.replaceState(null, '', '/get-started?step=login');
    gate(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Create an organization' }));
    expect(document.querySelector('.auth-title')?.textContent).toMatch(/organi[sz]ation/i);
  });
});
