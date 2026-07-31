# Tools

Build-time asset tooling. **Not part of the app build.**

This directory has its own `package.json` on purpose. Vercel and Render install
with `cd client && npm ci`, so nothing here is ever downloaded by a deployment —
`sharp` is a large native dependency and has no business in the install path of
a life-safety service.

## Regenerating the icons

Everything visual derives from one vector source: `client/public/logo.svg`.
Change the mark there, mirror the paths into `generate-icons.js` and
`client/src/components/Logo.tsx`, then:

```bash
cd tools && npm install && npm run icons
```

That rewrites, from the single source:

| Output | Purpose |
|---|---|
| `client/public/icon-192.png`, `icon-512.png` | PWA install icons |
| `client/public/icon-maskable-512.png` | Full-bleed, mark inside the safe centre 80% |
| `client/public/apple-touch-icon.png` | iOS home screen (it ignores SVG) |
| `client/android/.../mipmap-*/ic_launcher.png` | Legacy launcher, 5 densities |
| `client/android/.../mipmap-*/ic_launcher_round.png` | Circular launcher, 5 densities |
| `client/android/.../mipmap-*/ic_launcher_foreground.png` | Adaptive foreground, 108dp canvas |
| `client/android/.../drawable-*/splash.png` | Capacitor splash, every density |

Then `cd client && npx cap sync android` to copy them into the Android build.

## Two things that will bite you

**Write palette PNGs, not RGB.** Every asset is two flat colours plus
antialiased edges. As 24-bit RGB the splash screens alone came to 6.5 MB and
added 5 MB to the APK; as palette PNGs the whole set is 52 KB. The script
already does this — do not remove it.

**Density is a supersample factor, not a quality knob.** Each generated SVG
declares its size in pixels, so sharp renders at `size × density/72`. A fixed
high density blows past sharp's pixel limit on the 1920px splashes, and — worse
— if the failure is partial you end up with splash files written at 5× their
intended size, which the script then reads back as their "current" size on the
next run. If that happens, `git checkout` the splash PNGs before regenerating.
