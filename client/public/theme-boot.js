// Paints the right theme before the app bundle arrives, so a light-mode phone
// never flashes black on a slow connection. A file rather than an inline
// script because the CSP allows only 'self' scripts. Must agree with
// src/lib/theme.ts: an explicit choice wins, otherwise follow the device.
(function () {
  var t = 'dark';
  try {
    var s = JSON.parse(localStorage.getItem('alert-system-settings-v1') || '{}');
    if (s.theme === 'dark' || s.theme === 'light') t = s.theme;
    else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) t = 'light';
  } catch (e) { /* storage blocked: keep dark */ }
  document.documentElement.dataset.theme = t;
})();
