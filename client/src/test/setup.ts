// English is a lazily loaded chunk in the app (lib/i18n.ts), awaited by
// main.tsx before the first paint when it is the saved language. Tests render
// components directly, so they get the same guarantee here.
import { loadLocale } from '../lib/i18n';

await loadLocale('en');
