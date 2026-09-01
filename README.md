# Ghost Notepad

A transparent, see-through Notepad replacement. The window background is
fully transparent — whatever's behind it (desktop, another app, a video)
shows through — and the text itself has three visibility modes, plus real
formatting (bold/italic/underline, font, size) that plain Notepad never had.

## Features

- **Fully transparent window** — click-through mode available (`Ctrl+Shift+T`,
  or View → Click-Through Mode) so it becomes a pure on-screen overlay you
  can't accidentally click into; toggle back anytime with the same shortcut.
- **Three text transparency modes** (Format → Text Transparency): Fully
  Transparent, Kinda Transparent, Solid (Black & White). The blinking cursor
  always stays visible regardless of mode, so you never lose your place.
- **Window opacity control** (View → Window Opacity): 100% down to 20%,
  independent of the text transparency mode.
- **Real formatting**: Bold/Italic/Underline, font family + size.
- **Everything classic Notepad has**: New/Open/Save/Save As, Cut/Copy/Paste,
  Undo/Redo, Find/Find Next/Find Previous/Replace, Select All, Time/Date
  insert (F5), Word Wrap toggle, Zoom, status bar with line/column position.
- **Always on Top** toggle, for keeping it pinned over other windows.
- Saves as plain `.txt` (drop-in Notepad-compatible) or `.ghost.html` if you
  want to keep bold/italic/underline formatting intact.

## Running it (development)

```
npm install
npm start
```

## Building a real installer (.exe)

```
npm run dist
```

Uses `electron-builder` to produce an NSIS installer with the custom
black-and-white icon (`build/icon.ico`) already wired in.

## Notes

- `icon-src/icon.svg` is the source vector for the app icon — a classic
  Notepad-style page + folded corner + pencil, redrawn in black/white/gray
  instead of the usual blue/brown. `icon-src/make_ico.py` regenerates
  `build/icon.ico` from it if you ever want to tweak the design (needs PNGs
  at 16/24/32/48/64/128/256px rendered from the SVG first).
- This was built and visually verified (including catching and fixing a real
  CSS specificity bug where `[hidden]` was being silently overridden) using a
  headless Chrome render of the renderer UI, but the actual Electron app
  itself has not been run end-to-end — test the file dialogs and IPC wiring
  for real once you run `npm start` on Windows.
