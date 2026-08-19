# WhatsAppForLinux

An unofficial, **multi-account** WhatsApp desktop client for Linux, built on
current Electron.

Each account gets its own isolated Chromium session, so several numbers stay
signed in at the same time and receive messages in the background — switch
between them from the rail on the left.

> **Not affiliated with WhatsApp LLC or Meta Platforms, Inc.** This is an
> independent wrapper around [web.whatsapp.com](https://web.whatsapp.com).
> WhatsApp is a trademark of its respective owner.

---

## Features

- **Multi-account** — unlimited accounts, each in a separate `persist:` session
  partition. No shared cookies, no shared storage, no cross-talk.
- **Background delivery** — every account loads at startup and keeps running
  while hidden, so notifications arrive for accounts you are not looking at.
- **Profile pictures on the rail** — each tile shows that account's own
  WhatsApp photo, cached locally so it is there at startup. Falls back to
  initials when the photo cannot be read.
- **Per-account unread badges** on the rail, in the tray, and on the launcher.
- **Tray integration** — close to tray, per-account menu entries, unread total
  in the tooltip.
- **Notification click routing** — clicking a notification jumps to the account
  that raised it.
- **Native context menu** with spellcheck suggestions, add-to-dictionary, and
  per-account zoom that persists.
- **Drag to reorder**, rename, and mute accounts.
- **Wayland-native mode** (optional, in Settings) for sharp HiDPI rendering.
- **Zero runtime dependencies** — nothing but Electron itself.

## Install

Grab a package from the [latest release](https://github.com/abuhassan-dev/WhatsAppForLinux/releases/latest).

```bash
# Debian / Ubuntu
sudo apt install ./whatsappforlinux_1.0.0_amd64.deb
```

```bash
# Fedora / RHEL
sudo dnf install ./whatsappforlinux-1.0.0.x86_64.rpm
```

```bash
# AppImage — no install needed
chmod +x WhatsAppForLinux-1.0.0-x86_64.AppImage && ./WhatsAppForLinux-1.0.0-x86_64.AppImage
```

## Build from source

Requires Node.js 20 or newer.

```bash
npm install
npm start
```

If `npm start` says *"Downloading Electron binary…"* and hangs, your npm is
blocking install scripts. Fetch the binary once, explicitly:

```bash
node node_modules/electron/install.js
```

Then package it:

```bash
npm run dist
```

Artifacts land in `dist/`. Build a single target with `npm run dist:deb`,
`dist:rpm`, `dist:appimage`, or `dist:snap`.

Regenerate the icon set from `build/icon-source.png` (pure Python — decodes,
resamples with a triangle filter over premultiplied alpha, and re-encodes, with
no ImageMagick or Pillow needed):

```bash
npm run icons
```

To change the icon, replace `build/icon-source.png` with a square 8-bit RGBA PNG
of at least 512x512 and re-run that. `build/make-generic-icon.py` draws an
unbranded two-bubble mark instead, if you ever need one.

### Desktop integration when running from source

A source checkout has no installed `.desktop` file, so the desktop environment
cannot resolve the window's `app_id` (`com.mayon.whatsappforlinux`) and shows a
generic placeholder icon instead of the app's. On GNOME 50+ an unresolvable id
also makes `xdg-desktop-portal` refuse portal sessions. Register one — it goes
in `~/.local/share`, so no root is needed:

```bash
npm run dev:desktop
```

```bash
npm run dev:desktop:remove
```

Installed `.deb`, `.rpm`, and snap packages ship their own entry and need none
of this. A bare AppImage does not install one either; use
[AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher) or run
`npm run dev:desktop` from a checkout if you want the icon to appear.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl` + `1`…`9` | Jump to account by position |
| `Ctrl` + `Tab` | Next account |
| `Ctrl` + `Shift` + `Tab` | Previous account |
| `Ctrl` + `Shift` + `N` | Add account |
| `Ctrl` + `R` | Reload current account |
| `Ctrl` + `+` / `-` / `0` | Zoom in / out / reset |
| `Ctrl` + `W` | Hide to tray |
| `Ctrl` + `Q` | Quit |
| `F11` | Fullscreen |
| `Alt` | Reveal the menu bar |

Double-click an account tile to rename it; right-click for reload, mute, and
remove.

## Where your data lives

```
~/.config/WhatsAppForLinux/
├── accounts.json          # account list: names, colours, order
├── settings.json          # window state and preferences
├── avatars/<uuid>.png     # cached profile picture per account
└── Partitions/wa-<uuid>/  # one isolated session per account
```

WhatsApp Web exposes no API for the signed-in user's own photo, so it is read
out of the page and cached. The lookup avoids class names and localised labels
— WhatsApp's classes are generated atomic CSS that changes without notice — and
keys on three stable signals instead: the CDN media-type path that marks an
image as a profile photo, the image *not* being inside a chat-list
grid/row/listitem (those are contacts), and it sitting in the app header.

A photo can only be read while its account is on screen: Chromium does not run
`requestAnimationFrame` for a view that is not visible, and WhatsApp renders
through it, so a background account has no DOM to read. Each account's avatar
is therefore captured the first time you switch to it, then cached on disk and
reused on every later start. Until then, that tile shows initials.

Removing an account deletes only its local partition. Nothing is deleted on
your phone or on WhatsApp's servers.

## How multi-account works

Electron scopes cookies, `localStorage`, and IndexedDB per *session partition*.
Each account is assigned `persist:wa-<uuid>` and gets its own
`WebContentsView`; the window shows one at a time and keeps the rest alive but
hidden with `backgroundThrottling` off so messages keep arriving.

```
BaseWindow
├── WebContentsView  sidebar   (local UI, sandboxed, contextIsolation)
├── WebContentsView  account A (session persist:wa-…, visible)
├── WebContentsView  account B (session persist:wa-…, hidden, still running)
└── …
```

## Security

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` on every
  view — remote WhatsApp code never touches Node.
- The renderer talks to the main process only through a fixed
  `contextBridge` surface; channel names are not renderer-controlled, and
  privileged handlers verify the sender.
- Permission requests are allowlisted (notifications, mic/camera, clipboard,
  fullscreen) *and* origin-checked. Screen capture is refused.
- Navigation is restricted to `*.whatsapp.com` / `*.whatsapp.net` by parsed
  hostname — never a substring match. Everything else opens in your browser,
  and only over `http`, `https`, or `mailto`.
- The sidebar UI runs under a strict CSP with no remote origins.

Found a security problem? Please open an issue.

## Trademark

WhatsApp is a registered trademark of WhatsApp LLC / Meta Platforms, Inc. This
project is not affiliated with, authorised, or endorsed by them. The icon
depicts the WhatsApp mark to identify what the client connects to; run
`python3 build/make-generic-icon.py` to build with an unbranded icon instead.

## Licence

[MIT](LICENSE)
