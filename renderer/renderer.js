(function () {
  const editor = document.getElementById('editor');
  const titlebarText = document.getElementById('titlebar-text');
  const statusPos = document.getElementById('status-pos');
  const statusZoom = document.getElementById('status-zoom');
  const statusClickthrough = document.getElementById('status-clickthrough');
  const statusbar = document.getElementById('statusbar');
  const findBar = document.getElementById('find-bar');
  const findInput = document.getElementById('find-input');
  const replaceInput = document.getElementById('replace-input');
  const fontPanel = document.getElementById('font-panel');
  const fontFamilySel = document.getElementById('font-family');
  const fontSizeSel = document.getElementById('font-size');

  editor.focus();

  /* ---------- titlebar buttons ---------- */
  document.getElementById('btn-min').addEventListener('click', () => window.ghost.send('win-minimize'));
  document.getElementById('btn-close').addEventListener('click', () => window.ghost.send('win-close'));

  /* ---------- dirty tracking ---------- */
  let suppressDirty = false;
  editor.addEventListener('input', () => {
    if (!suppressDirty) window.ghost.send('mark-dirty', true);
    updateStatusPos();
  });

  /* ---------- content load/save ---------- */
  window.ghost.on('content-request', () => {
    window.ghost.send('content-response', editor.innerText);
  });
  window.ghost.on('content-request-typed', () => {
    window.ghost.send('content-response-typed', editor.innerText, editor.innerHTML);
  });
  window.ghost.on('load-content', (raw, isFormatted) => {
    suppressDirty = true;
    if (isFormatted) {
      editor.innerHTML = raw;
    } else {
      editor.innerText = raw || '';
    }
    suppressDirty = false;
    updateStatusPos();
  });

  /* ---------- edit menu actions ---------- */
  window.ghost.on('do-undo', () => document.execCommand('undo'));
  window.ghost.on('do-redo', () => document.execCommand('redo'));
  window.ghost.on('do-delete', () => document.execCommand('delete'));
  window.ghost.on('insert-datetime', () => {
    const now = new Date();
    let h = now.getHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    const m = String(now.getMinutes()).padStart(2, '0');
    const stamp = `${h}:${m} ${ampm} ${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;
    document.execCommand('insertText', false, stamp);
  });

  /* ---------- formatting ---------- */
  window.ghost.on('fmt-bold', () => document.execCommand('bold'));
  window.ghost.on('fmt-italic', () => document.execCommand('italic'));
  window.ghost.on('fmt-underline', () => document.execCommand('underline'));

  window.ghost.on('toggle-wordwrap', (enabled) => {
    editor.classList.toggle('nowrap', !enabled);
  });

  window.ghost.on('text-mode', (mode) => {
    const alphas = { ghost: 0.12, faint: 0.55, solid: 1 };
    document.documentElement.style.setProperty('--text-a', alphas[mode] ?? 0.55);
  });

  window.ghost.on('toggle-white-text', (inverted) => {
    const root = document.documentElement.style;
    if (inverted) {
      root.setProperty('--text-r', '255');
      root.setProperty('--text-g', '255');
      root.setProperty('--text-b', '255');
    } else {
      root.setProperty('--text-r', '0');
      root.setProperty('--text-g', '0');
      root.setProperty('--text-b', '0');
    }
  });

  /* ---------- font panel ---------- */
  window.ghost.on('open-font-picker', () => { fontPanel.hidden = false; });
  document.getElementById('font-close').addEventListener('click', () => { fontPanel.hidden = true; });
  document.getElementById('font-apply').addEventListener('click', () => {
    document.documentElement.style.setProperty('--font-family', fontFamilySel.value);
    document.documentElement.style.setProperty('--font-size', fontSizeSel.value + 'px');
    fontPanel.hidden = true;
    editor.focus();
  });

  /* ---------- zoom ---------- */
  let zoom = 1;
  window.ghost.on('zoom', (dir) => {
    if (dir === 0) zoom = 1;
    else zoom = Math.min(3, Math.max(0.3, zoom + dir * 0.1));
    document.documentElement.style.setProperty('--zoom', zoom);
    statusZoom.textContent = Math.round(zoom * 100) + '%';
  });

  /* ---------- status bar ---------- */
  window.ghost.on('toggle-statusbar', (visible) => {
    statusbar.classList.toggle('hidden', !visible);
  });

  function updateStatusPos() {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode) { statusPos.textContent = 'Ln 1, Col 1'; return; }
    // Compute line/col by walking text before the caret within the editor.
    const range = document.createRange();
    range.selectNodeContents(editor);
    try {
      range.setEnd(sel.anchorNode, sel.anchorOffset);
    } catch (e) { return; }
    const textBefore = range.toString();
    const lines = textBefore.split('\n');
    const ln = lines.length;
    const col = lines[lines.length - 1].length + 1;
    statusPos.textContent = `Ln ${ln}, Col ${col}`;
  }
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === editor) updateStatusPos();
  });

  /* ---------- click-through status ---------- */
  window.ghost.on('click-through-changed', (enabled) => {
    statusClickthrough.hidden = !enabled;
  });

  /* ---------- find / replace ---------- */
  window.ghost.on('open-find', () => {
    findBar.hidden = false;
    findBar.querySelector('.find-replace-only').style.display = 'none';
    findInput.focus();
  });
  window.ghost.on('open-replace', () => {
    findBar.hidden = false;
    findBar.querySelector('.find-replace-only').style.display = 'flex';
    findInput.focus();
  });
  document.getElementById('find-close-btn').addEventListener('click', () => {
    findBar.hidden = true;
    editor.focus();
  });

  function doFind(backwards) {
    const term = findInput.value;
    if (!term) return;
    window.find(term, false, !!backwards, true, false, true, false);
  }
  document.getElementById('find-next-btn').addEventListener('click', () => doFind(false));
  document.getElementById('find-prev-btn').addEventListener('click', () => doFind(true));
  window.ghost.on('find-next', () => doFind(false));
  window.ghost.on('find-prev', () => doFind(true));
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doFind(e.shiftKey);
  });

  document.getElementById('replace-btn').addEventListener('click', () => {
    const sel = window.getSelection();
    if (sel && sel.toString() === findInput.value && findInput.value) {
      document.execCommand('insertText', false, replaceInput.value);
    }
    doFind(false);
  });
  document.getElementById('replace-all-btn').addEventListener('click', () => {
    const term = findInput.value;
    if (!term) return;
    const replacement = replaceInput.value;
    const full = editor.innerText.split(term).join(replacement);
    suppressDirty = false;
    editor.innerText = full;
    window.ghost.send('mark-dirty', true);
  });

  updateStatusPos();
})();
