// Copyright (c) 2026 Stam. All rights reserved. See LICENSE.

(function () {
  const titlebarText = document.getElementById('titlebar-text');
  const tabsList = document.getElementById('tabs-list');
  const contentArea = document.getElementById('content-area');
  const launcher = document.getElementById('launcher');
  const statusPos = document.getElementById('status-pos');
  const statusZoom = document.getElementById('status-zoom');
  const statusClickthrough = document.getElementById('status-clickthrough');
  const findBar = document.getElementById('find-bar');
  const findInput = document.getElementById('find-input');
  const replaceInput = document.getElementById('replace-input');
  const fontPanel = document.getElementById('font-panel');
  const fontFamilySel = document.getElementById('font-family');
  const fontSizeSel = document.getElementById('font-size');
  const settingsPanel = document.getElementById('settings-panel');
  const launcherSearchInput = document.getElementById('launcher-search-input');
  const launcherSearchResults = document.getElementById('launcher-search-results');

  let tabs = [];
  let activeTabId = null;
  let zoom = 1;
  let settings = {};
  let terminalAvailable = false;
  let terminalMode = 'pty'; // 'pty' | 'fallback'
  let tabCounter = 0;

  function genId() { return 't' + Date.now() + '-' + (tabCounter++); }

  /* ================= settings ================= */
  async function loadSettings() {
    settings = await window.ghost.invoke('settings-get');
    applyVisualSettings();
    populateSettingsPanel();
  }
  function applyVisualSettings() {
    const root = document.documentElement.style;
    const alphas = { ghost: 0.12, faint: 0.55, solid: 1 };
    root.setProperty('--text-a', alphas[settings.textMode] ?? 0.55);
    root.setProperty('--text-r', settings.invertedText ? '255' : '0');
    root.setProperty('--text-g', settings.invertedText ? '255' : '0');
    root.setProperty('--text-b', settings.invertedText ? '255' : '0');
    // glow is always the OPPOSITE tone of the text, so the outline stays
    // visible against the text itself regardless of what's actually behind it
    root.setProperty('--glow-r', settings.invertedText ? '0' : '255');
    root.setProperty('--glow-g', settings.invertedText ? '0' : '255');
    root.setProperty('--glow-b', settings.invertedText ? '0' : '255');
    root.setProperty('--font-family', settings.fontFamily || 'Consolas, monospace');
    root.setProperty('--font-size', (settings.fontSize || 14) + 'px');
    root.setProperty('--blur-amount', (settings.blurAmount ?? 6) + 'px');
    document.querySelectorAll('.editor').forEach((ed) => {
      ed.classList.toggle('nowrap', !settings.wordWrap);
      ed.classList.toggle('glow-on', settings.charGlow !== false);
    });
    document.querySelectorAll('.editor-wrap, .term-pane').forEach((el) => {
      el.classList.toggle('legibility-blur', settings.legibilityMode === 'blur' || settings.legibilityMode === 'both');
    });
    if (settings.legibilityMode === 'blur') {
      root.setProperty('--text-a', 1); // when relying purely on blur, keep text fully legible
    }
  }
  function populateSettingsPanel() {
    document.getElementById('set-text-mode').value = settings.textMode || 'faint';
    document.getElementById('set-invert').checked = !!settings.invertedText;
    document.getElementById('set-char-glow').checked = settings.charGlow !== false;
    document.getElementById('set-legibility').value = settings.legibilityMode || 'alpha';
    document.getElementById('set-blur-amount').value = settings.blurAmount ?? 6;
    document.getElementById('set-window-opacity').value = settings.windowOpacity ?? 0.65;
    document.getElementById('set-always-on-top').checked = !!settings.alwaysOnTop;
    document.getElementById('set-word-wrap').checked = settings.wordWrap !== false;
    document.getElementById('set-spellcheck').checked = settings.spellcheck !== false;
    document.getElementById('set-autosave-interval').value = settings.autosaveIntervalSec ?? 20;
    document.getElementById('set-start-with-windows').checked = !!settings.startWithWindows;
    document.getElementById('set-summon-at-mouse').checked = !!settings.summonAtMouse;
    document.getElementById('set-notes-dir').textContent = settings.notesDir || '-';
    document.getElementById('set-terminal-status').textContent = terminalMode === 'pty'
      ? 'Available (full terminal)'
      : 'Available in basic mode (node-pty failed to load — install Visual Studio Build Tools + Python, then reinstall, for the full experience)';
  }
  async function patchSettings(patch) {
    settings = await window.ghost.invoke('settings-set', patch);
    applyVisualSettings();
  }

  document.getElementById('settings-btn').addEventListener('click', () => {
    populateSettingsPanel();
    settingsPanel.hidden = !settingsPanel.hidden;
  });
  document.getElementById('settings-close').addEventListener('click', () => { settingsPanel.hidden = true; });
  document.getElementById('set-text-mode').addEventListener('change', (e) => patchSettings({ textMode: e.target.value }));
  document.getElementById('set-invert').addEventListener('change', (e) => patchSettings({ invertedText: e.target.checked }));
  document.getElementById('set-char-glow').addEventListener('change', (e) => patchSettings({ charGlow: e.target.checked }));
  document.getElementById('set-legibility').addEventListener('change', (e) => patchSettings({ legibilityMode: e.target.value }));
  document.getElementById('set-blur-amount').addEventListener('input', (e) => patchSettings({ blurAmount: Number(e.target.value) }));
  document.getElementById('set-window-opacity').addEventListener('input', (e) => patchSettings({ windowOpacity: Number(e.target.value) }));
  document.getElementById('set-always-on-top').addEventListener('change', (e) => patchSettings({ alwaysOnTop: e.target.checked }));
  document.getElementById('set-word-wrap').addEventListener('change', (e) => patchSettings({ wordWrap: e.target.checked }));
  document.getElementById('set-spellcheck').addEventListener('change', (e) => patchSettings({ spellcheck: e.target.checked }));
  document.getElementById('set-autosave-interval').addEventListener('change', (e) => patchSettings({ autosaveIntervalSec: Number(e.target.value) }));
  document.getElementById('set-start-with-windows').addEventListener('change', (e) => patchSettings({ startWithWindows: e.target.checked }));
  document.getElementById('set-summon-at-mouse').addEventListener('change', (e) => patchSettings({ summonAtMouse: e.target.checked }));

  /* ================= titlebar buttons ================= */
  document.getElementById('btn-min').addEventListener('click', () => window.ghost.send('win-minimize'));
  document.getElementById('btn-close').addEventListener('click', () => window.ghost.send('win-close'));

  /* ================= tab bar rendering ================= */
  function tabIconSrc(type) {
    if (type === 'wsl') return 'icons/tile-ubuntu.svg';
    if (type === 'cmd') return 'icons/tile-cmd.svg';
    return 'icons/tile-notepad.svg';
  }

  function renderTabBar() {
    tabsList.innerHTML = '';
    tabs.forEach((tab) => {
      const el = document.createElement('div');
      el.className = 'tab' + (tab.id === activeTabId ? ' active' : '') + (tab.isDirty ? ' dirty' : '');
      el.dataset.id = tab.id;
      const img = document.createElement('img');
      img.src = tabIconSrc(tab.type);
      const title = document.createElement('span');
      title.className = 'tab-title';
      title.textContent = tab.title;
      const close = document.createElement('span');
      close.className = 'tab-close';
      close.textContent = '✕';
      close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.id); });
      el.appendChild(img); el.appendChild(title); el.appendChild(close);
      el.addEventListener('click', () => switchToTab(tab.id));
      tabsList.appendChild(el);
    });
  }

  function updateTitlebar() {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) { titlebarText.textContent = 'Wraith'; return; }
    titlebarText.textContent = `${tab.isDirty ? '*' : ''}${tab.title} - Wraith`;
  }

  function showLauncher() {
    activeTabId = null;
    tabs.forEach((t) => { t.paneEl.style.display = 'none'; });
    launcher.style.display = 'flex';
    renderTabBar();
    updateTitlebar();
  }

  // note panes are flex containers (toolbar + editor-wrap); terminal panes are plain blocks
  function paneDisplay(tab) { return tab.type === 'note' ? 'flex' : 'block'; }

  function switchToTab(id) {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    activeTabId = id;
    launcher.style.display = 'none';
    tabs.forEach((t) => { t.paneEl.style.display = t.id === id ? paneDisplay(t) : 'none'; });
    renderTabBar();
    updateTitlebar();
    if (tab.type === 'note') {
      tab.editorEl.focus();
      updateStatusPos(tab);
      statusZoom.textContent = Math.round(zoom * 100) + '%';
    } else if (tab.term) {
      tab.term.focus();
      setTimeout(() => tab.fitAddon && tab.fitAddon.fit(), 30);
    }
  }

  /* ================= note tabs ================= */
  function createNoteTab({ filePath = null, title, content = '', isFormatted = false }) {
    const id = genId();
    const pane = document.createElement('div');
    pane.className = 'pane note-pane';
    pane.style.display = 'none';

    const toolbar = document.createElement('div');
    toolbar.className = 'note-toolbar';
    const btn = (cls, label, title, action) => {
      const b = document.createElement('button');
      b.className = cls; b.textContent = label; b.title = title; b.type = 'button';
      b.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus/selection in the editor
      b.addEventListener('click', () => {
        if (typeof action === 'function') action();
        else document.execCommand(action);
      });
      toolbar.appendChild(b);
      return b;
    };
    const sep = () => { const s = document.createElement('span'); s.className = 'toolbar-sep'; toolbar.appendChild(s); };

    btn('b', 'B', 'Bold (Ctrl+B)', 'bold');
    btn('i', 'I', 'Italic (Ctrl+I)', 'italic');
    btn('u', 'U', 'Underline (Ctrl+U)', 'underline');
    btn('s', 'S', 'Strikethrough', 'strikeThrough');
    sep();
    btn('bullet', '•', 'Bullet list', 'insertUnorderedList');
    btn('check', '☑', 'Checklist item', () => {
      // Tag the inserted node itself rather than assuming it's the last
      // .checklist-item in DOM order — that assumption breaks the moment a
      // note already has an earlier checklist item and you insert a new one
      // above it.
      document.execCommand('insertHTML', false,
        '<label class="checklist-item" data-just-inserted contenteditable="false"><input type="checkbox">&nbsp;</label>');
      // Chrome leaves the caret BEFORE a just-inserted contenteditable="false"
      // node instead of after it (there's no valid caret position inside a
      // non-editable island), so anything typed next would land in front of
      // the checkbox. Explicitly move the caret past it.
      const inserted = editor.querySelector('.checklist-item[data-just-inserted]');
      if (inserted) {
        inserted.removeAttribute('data-just-inserted');
        const r = document.createRange();
        r.setStartAfter(inserted);
        r.collapse(true);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
      }
    });
    btn('subitem', '→', 'Sub-item on next line', () => {
      document.execCommand('insertHTML', false, '<br>&nbsp;&nbsp;&nbsp;&nbsp;→&nbsp;');
    });
    sep();
    btn('align-l', 'L', 'Align left', 'justifyLeft');
    btn('align-c', 'C', 'Align center', 'justifyCenter');
    btn('align-r', 'R', 'Align right', 'justifyRight');
    sep();
    const fontBtn = btn('font', 'Aa', 'Font', () => {
      const willOpen = fontPanel.hidden;
      if (willOpen) {
        fontFamilySel.value = settings.fontFamily || 'Consolas, monospace';
        fontSizeSel.value = String(settings.fontSize || 14);
        const rect = fontBtn.getBoundingClientRect();
        fontPanel.style.left = Math.round(rect.left) + 'px';
        fontPanel.style.right = 'auto';
        fontPanel.style.top = Math.round(rect.bottom + 4) + 'px';
      }
      fontPanel.hidden = !willOpen;
    });
    pane.appendChild(toolbar);

    const editorWrap = document.createElement('div');
    editorWrap.className = 'editor-wrap';
    const editor = document.createElement('div');
    editor.className = 'editor';
    editor.contentEditable = 'true';
    editor.spellcheck = settings.spellcheck !== false;
    if (isFormatted) editor.innerHTML = content; else editor.innerText = content;
    editor.classList.toggle('nowrap', !settings.wordWrap);
    editor.classList.toggle('glow-on', settings.charGlow !== false);
    editorWrap.appendChild(editor);
    pane.appendChild(editorWrap);
    contentArea.appendChild(pane);

    const tab = { id, type: 'note', title, filePath, isDirty: false, paneEl: pane, editorEl: editor, autosaveTimer: null };
    tabs.push(tab);

    editor.addEventListener('input', () => {
      tab.isDirty = true;
      renderTabBar(); updateTitlebar();
      updateStatusPos(tab);
    });
    editor.addEventListener('keyup', () => updateStatusPos(tab));
    editor.addEventListener('click', () => updateStatusPos(tab));

    startAutosave(tab);

    tabs.forEach((t) => { t.paneEl.style.display = 'none'; });
    pane.style.display = paneDisplay(tab);
    switchToTab(id);
    return tab;
  }

  function startAutosave(tab) {
    const secs = settings.autosaveIntervalSec || 20;
    tab.autosaveTimer = setInterval(async () => {
      if (tab.type !== 'note' || !tab.isDirty) return;
      if (tab.filePath) {
        await window.ghost.invoke('note-save', {
          filePath: tab.filePath,
          plain: tab.editorEl.innerText,
          html: tab.editorEl.innerHTML,
          wantsFormatted: tab.filePath.toLowerCase().endsWith('.html')
        });
      } else {
        await window.ghost.invoke('autosave-write', { tabId: tab.id, plain: tab.editorEl.innerText });
      }
    }, secs * 1000);
  }

  // A brand-new note has no filePath yet, so there's nothing to infer the
  // save format from — check the DOM itself for markup the toolbar actually
  // produces (bold/italic/underline/strike, lists, checklist items,
  // alignment) so a formatted note defaults to the .html filter instead of
  // silently offering .txt and discarding everything on the first save.
  // Plain <div> line-wrapping from pressing Enter doesn't count — a simple
  // multi-line note should still default to plain text.
  function hasRichFormatting(editorEl) {
    return !!editorEl.querySelector('b, strong, i, em, u, s, strike, ul, ol, .checklist-item, [style*="text-align"]');
  }

  async function saveTab(tab, forceDialog) {
    if (tab.type !== 'note') return;
    const wantsFormatted = tab.filePath ? tab.filePath.toLowerCase().endsWith('.html') : hasRichFormatting(tab.editorEl);
    const result = await window.ghost.invoke('note-save', {
      filePath: forceDialog ? null : tab.filePath,
      plain: tab.editorEl.innerText,
      html: tab.editorEl.innerHTML,
      wantsFormatted,
      suggestedTitle: tab.title
    });
    if (!result) return false;
    tab.filePath = result.filePath;
    tab.title = result.title;
    tab.isDirty = false;
    await window.ghost.invoke('autosave-clear', { tabId: tab.id });
    renderTabBar(); updateTitlebar();
    return true;
  }

  async function closeTab(id) {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const tab = tabs[idx];
    if (tab.type === 'note' && tab.isDirty) {
      const choice = await window.ghost.invoke('note-confirm-close', { title: tab.title });
      if (choice === 'cancel') return;
      if (choice === 'save') {
        const ok = await saveTab(tab, false);
        if (!ok) return;
      }
    }
    if (tab.type === 'note') {
      clearInterval(tab.autosaveTimer);
      window.ghost.invoke('autosave-clear', { tabId: tab.id });
    } else if (tab.term) {
      window.ghost.send('terminal-kill', tab.id);
    }
    tab.paneEl.remove();
    tabs.splice(idx, 1);
    if (activeTabId === id) {
      if (tabs.length) switchToTab(tabs[tabs.length - 1].id);
      else showLauncher();
    } else {
      renderTabBar();
    }
  }

  function updateStatusPos(tab) {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode) { statusPos.textContent = 'Ln 1, Col 1'; return; }
    const range = document.createRange();
    range.selectNodeContents(tab.editorEl);
    try { range.setEnd(sel.anchorNode, sel.anchorOffset); } catch (e) { return; }
    const textBefore = range.toString();
    const lines = textBefore.split('\n');
    statusPos.textContent = `Ln ${lines.length}, Col ${lines[lines.length - 1].length + 1}`;
  }

  /* ================= terminal tabs ================= */
  async function createTerminalTab(shellType) {
    const id = genId();
    const pane = document.createElement('div');
    pane.className = 'pane term-pane';
    pane.classList.toggle('legibility-blur', settings.legibilityMode === 'blur' || settings.legibilityMode === 'both');
    pane.style.display = 'none';
    contentArea.appendChild(pane);

    const title = shellType === 'wsl' ? 'Ubuntu (WSL)' : 'Command Prompt';
    const tab = { id, type: shellType, title, isDirty: false, paneEl: pane, term: null, fitAddon: null };
    tabs.push(tab);
    tabs.forEach((t) => { t.paneEl.style.display = 'none'; });
    pane.style.display = 'block';
    switchToTab(id);

    const container = document.createElement('div');
    container.className = 'term-container';
    pane.appendChild(container);

    const term = new Terminal({
      fontFamily: 'Consolas, monospace',
      fontSize: 13,
      theme: { background: 'rgba(0,0,0,0)', foreground: '#e8e8ea' },
      allowTransparency: true,
      cursorBlink: true
    });
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();
    tab.term = term; tab.fitAddon = fitAddon;
    // switchToTab() ran before tab.term existed, so its focus() call was a no-op — do it now instead.
    if (activeTabId === id) term.focus();

    const spawnResult = await window.ghost.invoke('terminal-spawn', { tabId: id, shellType });
    if (!spawnResult.ok) {
      term.write(`\r\n\x1b[31mFailed to start: ${spawnResult.error}\x1b[0m\r\n`);
      return;
    }
    if (spawnResult.fallback) {
      const extra = shellType === 'wsl'
        ? ' Bash line-editing/colors may be degraded without a real PTY.'
        : '';
      term.write(`\x1b[33m[basic mode: no real PTY, node-pty didn't load.${extra} Commands and output still work, but typing is locally echoed since the shell can't do it for us over a plain pipe. Arrow keys/tab-completion aren't supported here.]\x1b[0m\r\n`);
    }

    tab.fallback = !!spawnResult.fallback;
    tab.lineBuffer = '';
    tab.escapeSwallow = 0;

    term.onData((data) => {
      if (!tab.fallback) {
        // real PTY: the shell itself echoes, so just pass keystrokes straight through
        window.ghost.send('terminal-input', id, data);
        return;
      }
      // Fallback mode: plain pipes get no echo from Windows console programs, so we
      // fake a basic line editor client-side — printable chars, Backspace, Enter, Ctrl+C.
      // Arrow keys/escape sequences are swallowed rather than leaking garbage into the line.
      for (const ch of data) {
        const code = ch.charCodeAt(0);
        if (tab.escapeSwallow > 0) { tab.escapeSwallow--; continue; }
        if (code === 27) { tab.escapeSwallow = 2; continue; } // ESC-prefixed sequence (arrows etc.)
        if (ch === '\r') {
          term.write('\r\n');
          window.ghost.send('terminal-input', id, tab.lineBuffer + '\n');
          tab.lineBuffer = '';
        } else if (code === 127 || code === 8) {
          if (tab.lineBuffer.length > 0) {
            tab.lineBuffer = tab.lineBuffer.slice(0, -1);
            term.write('\b \b');
          }
        } else if (code === 3) {
          tab.lineBuffer = '';
          term.write('^C\r\n');
          window.ghost.send('terminal-input', id, '\x03');
        } else if (code >= 32) {
          tab.lineBuffer += ch;
          term.write(ch);
        }
      }
    });
    term.onResize(({ cols, rows }) => window.ghost.send('terminal-resize', id, cols, rows));

    const ro = new ResizeObserver(() => { try { fitAddon.fit(); } catch (e) {} });
    ro.observe(container);
  }

  window.ghost.on('terminal-data', (tabId, data) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab && tab.term) tab.term.write(data);
  });
  window.ghost.on('terminal-exit', (tabId) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab && tab.term) tab.term.write('\r\n\x1b[90m[process exited]\x1b[0m\r\n');
  });

  async function newNoteTab() {
    const defaults = await window.ghost.invoke('note-new-default');
    createNoteTab({ title: defaults.title });
  }

  /* ================= launcher ================= */
  document.querySelectorAll('.cube').forEach((cube) => {
    cube.addEventListener('click', () => {
      const type = cube.dataset.type;
      if (type === 'note') newNoteTab();
      else createTerminalTab(type);
    });
  });

  document.getElementById('new-tab-btn').addEventListener('click', () => showLauncher());

  let searchDebounce = null;
  launcherSearchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const q = launcherSearchInput.value.trim();
    if (!q) { launcherSearchResults.hidden = true; return; }
    searchDebounce = setTimeout(async () => {
      const results = await window.ghost.invoke('search-notes', q);
      renderSearchResults(results);
    }, 200);
  });
  function renderSearchResults(results) {
    launcherSearchResults.innerHTML = '';
    if (!results.length) { launcherSearchResults.hidden = true; return; }
    results.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'launcher-search-result';
      const t = document.createElement('div');
      t.className = 'r-title';
      t.textContent = r.title;
      row.appendChild(t);
      if (r.snippet) {
        const s = document.createElement('div');
        s.className = 'r-snippet';
        s.textContent = '...' + r.snippet + '...';
        row.appendChild(s);
      }
      row.addEventListener('click', () => openNoteFromPath(r.filePath));
      launcherSearchResults.appendChild(row);
    });
    launcherSearchResults.hidden = false;
  }
  async function openNoteFromPath(filePath) {
    const existing = tabs.find((t) => t.type === 'note' && t.filePath === filePath);
    if (existing) { switchToTab(existing.id); return; }
    const result = await window.ghost.invoke('note-read-path', filePath);
    if (!result) return;
    createNoteTab({ filePath: result.filePath, title: result.title, content: result.content, isFormatted: result.isFormatted });
    launcherSearchResults.hidden = true;
    launcherSearchInput.value = '';
  }

  /* ================= find / replace (note tabs only) ================= */
  function activeNoteTab() {
    const tab = tabs.find((t) => t.id === activeTabId);
    return tab && tab.type === 'note' ? tab : null;
  }
  function doFind(backwards) {
    const term = findInput.value;
    if (!term || !activeNoteTab()) return;
    window.find(term, false, !!backwards, true, false, true, false);
  }
  document.getElementById('find-next-btn').addEventListener('click', () => doFind(false));
  document.getElementById('find-prev-btn').addEventListener('click', () => doFind(true));
  document.getElementById('find-close-btn').addEventListener('click', () => { findBar.hidden = true; });
  findInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doFind(e.shiftKey); });
  document.getElementById('replace-btn').addEventListener('click', () => {
    const tab = activeNoteTab(); if (!tab) return;
    const sel = window.getSelection();
    if (sel && sel.toString() === findInput.value && findInput.value) {
      document.execCommand('insertText', false, replaceInput.value);
    }
    doFind(false);
  });
  document.getElementById('replace-all-btn').addEventListener('click', () => {
    const tab = activeNoteTab(); if (!tab || !findInput.value) return;
    // Was: tab.editorEl.innerText = tab.editorEl.innerText.split(...).join(...) —
    // that overwrites the whole element as plain text, silently stripping every
    // bit of formatting (bold, lists, checklists, alignment) from the entire
    // note on a single click. Walk matches with window.find() and replace each
    // one in place with execCommand instead, so everything else is untouched.
    tab.editorEl.focus();
    const start = document.createRange();
    start.selectNodeContents(tab.editorEl);
    start.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(start);

    let count = 0;
    const maxIterations = 5000; // guard against a pathological/runaway match
    while (count < maxIterations && window.find(findInput.value, false, false, false, false, true, false)) {
      const cur = window.getSelection();
      if (!cur.rangeCount || !tab.editorEl.contains(cur.anchorNode)) break;
      document.execCommand('insertText', false, replaceInput.value);
      count++;
    }
    tab.isDirty = true; renderTabBar(); updateTitlebar();
  });

  /* ================= font panel ================= */
  document.getElementById('font-close').addEventListener('click', () => { fontPanel.hidden = true; });
  document.getElementById('font-apply').addEventListener('click', () => {
    patchSettings({ fontFamily: fontFamilySel.value, fontSize: Number(fontSizeSel.value) });
    fontPanel.hidden = true;
    const tab = activeNoteTab(); if (tab) tab.editorEl.focus();
  });
  // Dropdown behavior: close it on an outside click, same as a native <select>.
  document.addEventListener('mousedown', (e) => {
    if (fontPanel.hidden) return;
    if (fontPanel.contains(e.target) || e.target.closest('.font')) return;
    fontPanel.hidden = true;
  });

  /* ================= click-through / global summon ================= */
  window.ghost.on('click-through-changed', (enabled) => { statusClickthrough.hidden = !enabled; });
  window.ghost.on('request-click-through-toggle', () => window.ghost.send('toggle-click-through'));

  /* ================= confirm unsaved notes before the app actually quits ================= */
  // Reuses the exact same per-tab confirm/save flow closeTab() already uses,
  // just walked across every dirty note instead of one.
  window.ghost.on('check-unsaved-before-quit', async () => {
    const dirtyNotes = tabs.filter((t) => t.type === 'note' && t.isDirty);
    for (const tab of dirtyNotes) {
      switchToTab(tab.id); // bring it into view so the user can see what they're being asked about
      const choice = await window.ghost.invoke('note-confirm-close', { title: tab.title });
      if (choice === 'cancel') { window.ghost.send('unsaved-check-result', false); return; }
      if (choice === 'save') {
        const ok = await saveTab(tab, false);
        if (!ok) { window.ghost.send('unsaved-check-result', false); return; }
      }
    }
    window.ghost.send('unsaved-check-result', true);
  });

  /* ================= keyboard shortcuts ================= */
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const tab = tabs.find((t) => t.id === activeTabId);
    const key = e.key.toLowerCase();

    if (key === 'n' && !e.shiftKey) { e.preventDefault(); newNoteTab(); return; }
    if (key === 't') { e.preventDefault(); showLauncher(); return; }
    if (key === 'w') { e.preventDefault(); if (activeTabId) closeTab(activeTabId); return; }
    if (key === 'o') { e.preventDefault(); openFileFlow(); return; }
    if (key === 's' && tab && tab.type === 'note') { e.preventDefault(); saveTab(tab, e.shiftKey); return; }
    if (key === 'f' && tab && tab.type === 'note') { e.preventDefault(); findBar.hidden = false; findBar.querySelector('.find-replace-only').style.display = 'none'; findInput.focus(); return; }
    if (key === 'h' && tab && tab.type === 'note') { e.preventDefault(); findBar.hidden = false; findBar.querySelector('.find-replace-only').style.display = 'flex'; findInput.focus(); return; }
    if (key === 'b' && tab && tab.type === 'note') { e.preventDefault(); document.execCommand('bold'); return; }
    if (key === 'i' && tab && tab.type === 'note') { e.preventDefault(); document.execCommand('italic'); return; }
    if (key === 'u' && tab && tab.type === 'note') { e.preventDefault(); document.execCommand('underline'); return; }
    if (key === '=' ) { e.preventDefault(); setZoom(zoom + 0.1); return; }
    if (key === '-') { e.preventDefault(); setZoom(zoom - 0.1); return; }
    if (key === '0') { e.preventDefault(); setZoom(1); return; }
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F5') {
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab || tab.type !== 'note') return;
      const now = new Date();
      let h = now.getHours(); const ampm = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
      const m = String(now.getMinutes()).padStart(2, '0');
      document.execCommand('insertText', false, `${h}:${m} ${ampm} ${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`);
    }
  });

  async function openFileFlow() {
    const result = await window.ghost.invoke('note-open-dialog');
    if (!result) return;
    const existing = tabs.find((t) => t.type === 'note' && t.filePath === result.filePath);
    if (existing) { switchToTab(existing.id); return; }
    createNoteTab({ filePath: result.filePath, title: result.title, content: result.content, isFormatted: result.isFormatted });
  }

  function setZoom(z) {
    zoom = Math.min(3, Math.max(0.3, z));
    document.documentElement.style.setProperty('--zoom', zoom);
    statusZoom.textContent = Math.round(zoom * 100) + '%';
  }

  /* ================= autocorrect + hover-to-revert ================= */
  // Curated common-typo list, not a live dictionary API — Electron has no
  // synchronous "is this word misspelled" query, only the reactive
  // right-click suggestions already wired up via spellcheck. This covers
  // the most common English typos and corrects them on word-boundary
  // (space/punctuation), wrapping the fix in a span you can hover to revert.
  const AUTOCORRECT_MAP = {
    teh: 'the', adn: 'and', recieve: 'receive', recieved: 'received',
    seperate: 'separate', definately: 'definitely', occured: 'occurred',
    untill: 'until', wich: 'which', thier: 'their', becuase: 'because',
    freind: 'friend', wierd: 'weird', alot: 'a lot', beleive: 'believe',
    acheive: 'achieve', goverment: 'government', enviroment: 'environment',
    neccessary: 'necessary', accomodate: 'accommodate', occassion: 'occasion',
    embarass: 'embarrass', existance: 'existence', independant: 'independent',
    maintainance: 'maintenance', noticable: 'noticeable', priviledge: 'privilege',
    publically: 'publicly', recomend: 'recommend', refered: 'referred',
    sucessful: 'successful', tommorow: 'tomorrow', wheter: 'whether',
    writen: 'written', youre: "you're", dont: "don't", cant: "can't",
    wont: "won't", im: "I'm", ive: "I've", didnt: "didn't", doesnt: "doesn't",
    isnt: "isn't", wasnt: "wasn't", arent: "aren't", shouldnt: "shouldn't",
    wouldnt: "wouldn't", couldnt: "couldn't", thats: "that's", whats: "what's"
  };

  // Listens on 'input' (not 'keydown') so the trigger character comes from
  // the browser's own event.data rather than a hand-tracked key — this
  // fires correctly no matter how the character arrived (physical key,
  // IME, autofill, execCommand), which keydown-based .key sniffing doesn't
  // reliably cover.
  document.addEventListener('input', (e) => {
    const editor = e.target;
    if (!editor || !editor.classList || !editor.classList.contains('editor')) return;
    if (e.inputType !== 'insertText' || !e.data || !'.,!?;: '.includes(e.data)) return;
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return;
    const range = sel.getRangeAt(0);

    // Robust text-before-cursor extraction via Range.toString(): works
    // regardless of whether the cursor sits inside a text node or at an
    // element boundary (which happens right after execCommand mutations) —
    // same technique already used in updateStatusPos() below. The trigger
    // character is already inserted by this point, so strip it off first.
    const probe = document.createRange();
    probe.selectNodeContents(editor);
    probe.setEnd(range.startContainer, range.startOffset);
    let textBefore = probe.toString();
    if (textBefore.endsWith(e.data)) textBefore = textBefore.slice(0, -e.data.length);
    const match = textBefore.match(/([a-zA-Z']+)$/);
    if (!match) return;
    const word = match[1];
    const lower = word.toLowerCase();
    if (!(lower in AUTOCORRECT_MAP)) return;

    let correction = AUTOCORRECT_MAP[lower];
    if (word[0] === word[0].toUpperCase() && word[0].toLowerCase() !== word[0]) {
      correction = correction[0].toUpperCase() + correction.slice(1);
    }

    // Defer the fix-up to right after this input event finishes: Chromium
    // refuses to run a second execCommand while one is still unwinding on
    // the call stack (harmless for a real keypress, but this event can also
    // fire from another execCommand-driven insertion, e.g. paste), so a
    // same-tick execCommand call here would silently no-op.
    //
    // Capture the fix-up spot as a live Range now, at event time — by the
    // time the deferred callback runs, the user may already be typing the
    // next word, so execCommand('delete') acting on "wherever the caret
    // currently is" would eat their new characters instead of the typo.
    // Ranges auto-track DOM edits that happen elsewhere in the same node,
    // so this stays correctly anchored even as more text is typed after it.
    const fixRange = range.cloneRange();
    setTimeout(() => {
      const s = window.getSelection();
      // Save wherever the user's caret actually is now, so we can restore
      // it after jumping back to fix an earlier word.
      const liveRange = (s.rangeCount && s.isCollapsed) ? s.getRangeAt(0).cloneRange() : null;

      s.removeAllRanges();
      s.addRange(fixRange);

      // Remove the typed word plus the trigger character via repeated
      // "delete" (backspace-equivalent) — relies on the browser's own
      // caret-based editing instead of manual Range math, so it's correct
      // regardless of the underlying DOM shape.
      for (let i = 0; i < word.length + e.data.length; i++) document.execCommand('delete', false);

      const escaped = word.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      document.execCommand('insertHTML', false,
        `<span class="autocorrect-fix" data-original="${escaped}">${correction}</span>${e.data}`);

      // Jump back to wherever the user actually is now. liveRange is a live
      // DOM Range, so the browser has already shifted its offset to account
      // for the delete+insert above — even when the correction isn't the
      // same length as the typo (e.g. "alot" -> "a lot").
      if (liveRange) {
        const s2 = window.getSelection();
        s2.removeAllRanges();
        s2.addRange(liveRange);
      }
    }, 0);
  });

  // Single shared tooltip, positioned over whatever autocorrect-fix span is hovered
  const revertTip = document.createElement('div');
  revertTip.className = 'autocorrect-tip';
  revertTip.hidden = true;
  document.body.appendChild(revertTip);
  let revertTarget = null;

  document.addEventListener('mouseover', (e) => {
    const span = e.target.closest && e.target.closest('.autocorrect-fix');
    if (!span) return;
    revertTarget = span;
    revertTip.innerHTML = '';
    const label = document.createElement('span');
    label.textContent = `Changed from "${span.dataset.original}"`;
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.textContent = 'Undo';
    undoBtn.addEventListener('click', () => {
      if (!revertTarget) return;
      revertTarget.replaceWith(document.createTextNode(revertTarget.dataset.original));
      revertTip.hidden = true;
      revertTarget = null;
    });
    revertTip.appendChild(label);
    revertTip.appendChild(undoBtn);
    const rect = span.getBoundingClientRect();
    revertTip.style.left = Math.round(rect.left) + 'px';
    revertTip.style.top = Math.round(rect.bottom + 4) + 'px';
    revertTip.hidden = false;
  });
  document.addEventListener('mouseout', (e) => {
    const span = e.target.closest && e.target.closest('.autocorrect-fix');
    if (!span) return;
    // don't hide if the mouse moved onto the tooltip itself (to click Undo)
    if (e.relatedTarget && revertTip.contains(e.relatedTarget)) return;
    revertTip.hidden = true;
    revertTarget = null;
  });

  /* ================= calculator side panel ================= */
  (function () {
    const toggle = document.getElementById('calc-toggle');
    const panel = document.getElementById('calc-panel');
    const display = document.getElementById('calc-display');
    const advToggle = document.getElementById('calc-adv-toggle');
    const advPanel = document.getElementById('calc-advanced');
    const exprInput = document.getElementById('calc-graph-expr');
    const plotBtn = document.getElementById('calc-plot-btn');
    const canvas = document.getElementById('calc-graph-canvas');

    let expr = '';
    let calcOpen = false;

    function setOpen(open) {
      calcOpen = open;
      document.body.classList.toggle('calc-open', open);
      panel.hidden = !open;
      // arrow points OUTWARD (away from content) when closed = "click to drag out";
      // points INWARD (back toward content) when open = "click to put it back in"
      toggle.innerHTML = open ? '&#x25C0;' : '&#x25B6;';
      toggle.title = open ? 'Close calculator' : 'Open calculator';
    }
    toggle.addEventListener('click', () => setOpen(!calcOpen));

    function updateDisplay() {
      display.textContent = expr || '0';
    }

    function pressKey(k) {
      if (k === 'C') {
        expr = '';
      } else if (k === 'back') {
        expr = expr.slice(0, -1);
      } else if (k === '=') {
        try {
          const result = MathExpr.evaluate(expr);
          expr = String(Math.round(result * 1e10) / 1e10);
        } catch (e) {
          expr = 'Error';
        }
      } else {
        if (expr === 'Error') expr = '';
        expr += k;
      }
      updateDisplay();
    }
    document.querySelectorAll('.calc-buttons button').forEach((btn) => {
      btn.addEventListener('click', () => pressKey(btn.dataset.k));
    });

    advToggle.addEventListener('click', () => {
      const willShow = advPanel.hidden;
      advPanel.hidden = !willShow;
      advToggle.innerHTML = 'Advanced ' + (willShow ? '&#x25B4;' : '&#x25BE;');
    });

    function plotGraph() {
      const ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const expression = exprInput.value.trim();
      if (!expression) return;

      const xMin = -10, xMax = 10, samples = 200;
      const points = [];
      let yMin = Infinity, yMax = -Infinity;
      for (let i = 0; i <= samples; i++) {
        const x = xMin + (xMax - xMin) * (i / samples);
        let y;
        try { y = MathExpr.evaluate(expression, x); } catch (e) { points.push(null); continue; }
        if (typeof y !== 'number' || !isFinite(y)) { points.push(null); continue; }
        points.push({ x, y });
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
      if (yMin === Infinity) {
        ctx.fillStyle = '#e8b4b4';
        ctx.font = '11px sans-serif';
        ctx.fillText('Could not evaluate this expression', 8, h / 2);
        return;
      }
      if (yMin === yMax) { yMin -= 1; yMax += 1; }
      const pad = (yMax - yMin) * 0.1;
      yMin -= pad; yMax += pad;

      const toPx = (x, y) => [
        ((x - xMin) / (xMax - xMin)) * w,
        h - ((y - yMin) / (yMax - yMin)) * h
      ];

      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      if (yMin < 0 && yMax > 0) {
        const [, zy] = toPx(0, 0);
        ctx.beginPath(); ctx.moveTo(0, zy); ctx.lineTo(w, zy); ctx.stroke();
      }
      if (xMin < 0 && xMax > 0) {
        const [zx] = toPx(0, 0);
        ctx.beginPath(); ctx.moveTo(zx, 0); ctx.lineTo(zx, h); ctx.stroke();
      }

      ctx.strokeStyle = '#2fd98f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      let started = false;
      for (const p of points) {
        if (!p) { started = false; continue; }
        const [px, py] = toPx(p.x, p.y);
        if (!started) { ctx.moveTo(px, py); started = true; }
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    plotBtn.addEventListener('click', plotGraph);
    exprInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') plotGraph(); });

    updateDisplay();
  })();

  /* ================= init ================= */
  (async function init() {
    terminalAvailable = await window.ghost.invoke('terminal-available');
    terminalMode = await window.ghost.invoke('terminal-mode');
    await loadSettings();
    showLauncher();
  })();
})();
