# Paseo Next

Tauri desktop shell for Paseo. It reuses the existing Expo web renderer and
injects a `window.paseoDesktop` bridge compatible with the Electron wrapper.

Development uses an isolated daemon home by default:

```bash
npm run dev:desktop-next
```

The default runtime state lives in `~/.paseo-next` and the daemon binds to a
random loopback port, so it does not touch the main daemon on port 6767.

For regression testing against the stable Paseo daemon and its existing
sessions, launch in connect-only mode:

```bash
npm run dev:desktop-next:stable
```

In this mode Paseo Next reads `~/.paseo/paseo.pid` and connects to the stable
daemon, but it will not start, stop, or restart that daemon. Start the stable
Paseo app or daemon first.
