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
    if (!tab) { titlebarText.textContent = 'Ghost Notepad'; return; }
    titlebarText.textContent = `${tab.isDirty ? '*' : ''}${tab.title} - Ghost Notepad`;
  }

  function showLauncher() {
    activeTabId = null;
    tabs.forEach((t) => { t.paneEl.style.display = 'none'; });
    launcher.style.display = 'flex';
    renderTabBar();
    updateTitlebar();
  }

  function switchToTab(id) {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    activeTabId = id;
    launcher.style.display = 'none';
    tabs.forEach((t) => { t.paneEl.style.display = t.id === id ? 'block' : 'none'; });
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
    pane.className = 'pane editor-wrap';
    pane.style.display = 'none';
    const editor = document.createElement('div');
    editor.className = 'editor';
    editor.contentEditable = 'true';
    editor.spellcheck = settings.spellcheck !== false;
    if (isFormatted) editor.innerHTML = content; else editor.innerText = content;
    editor.classList.toggle('nowrap', !settings.wordWrap);
    editor.classList.toggle('glow-on', settings.charGlow !== false);
    pane.appendChild(editor);
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
    pane.style.display = 'block';
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

  async function saveTab(tab, forceDialog) {
    if (tab.type !== 'note') return;
    const wantsFormatted = tab.filePath ? tab.filePath.toLowerCase().endsWith('.html') : false;
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
    tab.editorEl.innerText = tab.editorEl.innerText.split(findInput.value).join(replaceInput.value);
    tab.isDirty = true; renderTabBar(); updateTitlebar();
  });

  /* ================= font panel ================= */
  document.getElementById('font-close').addEventListener('click', () => { fontPanel.hidden = true; });
  document.getElementById('font-apply').addEventListener('click', () => {
    patchSettings({ fontFamily: fontFamilySel.value, fontSize: Number(fontSizeSel.value) });
    fontPanel.hidden = true;
    const tab = activeNoteTab(); if (tab) tab.editorEl.focus();
  });

  /* ================= click-through / global summon ================= */
  window.ghost.on('click-through-changed', (enabled) => { statusClickthrough.hidden = !enabled; });
  window.ghost.on('request-click-through-toggle', () => window.ghost.send('toggle-click-through'));

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

  /* ================= init ================= */
  (async function init() {
    terminalAvailable = await window.ghost.invoke('terminal-available');
    terminalMode = await window.ghost.invoke('terminal-mode');
    await loadSettings();
    showLauncher();
  })();
})();
