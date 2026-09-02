# Wraith

A transparent, tabbed workspace: Notepad, a Command Prompt, and a WSL Ubuntu
terminal, all in one see-through window. Pick one from the launcher, and
each opens as its own tab.

## Features

- **Launcher screen**: three tiles — Ubuntu (WSL), Command Prompt, Notepad —
  each opens a new tab of that type. Also has a search box for finding your
  saved notes by name or content.
- **Real terminals**: actual `cmd.exe` and `wsl.exe` processes via `node-pty`,
  rendered with `xterm.js`. If `node-pty` fails to load on your machine, the
  rest of the app (notes, launcher, settings) still works — you just get a
  clear "terminal unavailable" message on those tabs instead of a crash.
- **Tabs**: open multiple notes and terminals at once, switch between them,
  close individually. Notes auto-title with the date if you don't rename them.
- **Transparent window** with three text-visibility modes (Fully Transparent /
  Kinda Transparent / Solid Black & White), plus an alternate legibility mode
  that blurs what's behind the text instead of relying on opacity — or both
  at once. All configurable from the Settings panel (gear icon in the tab bar).
- **Auto-save**: unsaved notes save to a recovery slot every N seconds
  (configurable); once a note has a real save location, autosave writes
  straight to it.
- **File search**: searches your Notes folder by filename or content —
  implemented as a plain JS file walk, deliberately not shelling out to
  `findstr`/`grep`, so there's no command-injection surface from your search
  text.
- **Global summon hotkey**: `Ctrl+\`` shows/hides the window from anywhere,
  no need to focus it first (same convention VS Code uses for its terminal).
- **System tray**: closing the window hides it to tray instead of quitting.
- **Start with Windows**, **spell check** (with real right-click
  suggestions), and **remembers window position/size** — all in Settings.
- Paste images and emoji directly into notes — this is native `contenteditable`
  behavior, not something bolted on, so it just works.
- Saves as plain `.txt` (drop-in Notepad-compatible) or `.html` if you want
  to keep bold/italic/underline formatting.

## Keyboard shortcuts

`Ctrl+N` new note · `Ctrl+T` new tab (launcher) · `Ctrl+W` close tab ·
`Ctrl+O` open · `Ctrl+S` / `Ctrl+Shift+S` save / save as · `Ctrl+F` find ·
`Ctrl+H` replace · `Ctrl+B/I/U` bold/italic/underline · `Ctrl+=/-/0` zoom ·
`F5` insert date/time · `Ctrl+\`` summon/hide window (global) ·
`Ctrl+Shift+T` click-through mode (global)

There's no native File/Edit menu anymore — the app moved to a custom tab bar
and Settings panel instead, so menu-driven actions became shortcuts + the
visible panels (Settings, Font, Find).

## Running it (development)

```
npm install
npm start
```

`node-pty` is a native module and needs to be compiled for your Electron
version. `npm install` triggers this automatically via
`electron-builder install-app-deps` (see the `postinstall` script in
`package.json`), but it needs **Python and Visual Studio Build Tools (C++
workload)** installed on Windows to succeed. If terminal tabs show
"unavailable" after install, that's almost certainly why — the rest of the
app will still work regardless.

## Building a real installer (.exe)

```
npm run dist
```

## Notes

- `icon-src/` holds the vector sources for every icon (app icon, and the
  three launcher tiles) plus `make_ico.py` to regenerate `build/icon.ico`.
- Visually verified via headless Chrome renders of the launcher, note-tab
  creation, and Settings panel (with a mocked IPC bridge) — this caught and
  fixed two real bugs (a broken search-result-open path, and a stale
  line/column indicator after programmatic text insertion). The actual
  terminal spawning (`node-pty` + real `cmd.exe`/`wsl.exe` processes) has
  **not** been run end-to-end — that needs a real Windows machine with the
  native module compiled. Test it for real and tell me what breaks.
