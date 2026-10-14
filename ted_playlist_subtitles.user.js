// ==UserScript==
// @name         YouTube Playlist Subtitles to TXT
// @namespace    local.playlist.subtitles
// @version      1.0
// @description  Adds a button on YouTube that downloads English subtitles of a whole playlist as one .txt file
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const getText = async u => (await fetch(u, { credentials: 'include' })).text();
  const unesc = s => JSON.parse('"' + s + '"');

  /* ---------- floating button + status box ---------- */
  const btn = document.createElement('button');
  btn.textContent = 'Get subtitles';
  btn.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;padding:14px 18px;border:0;border-radius:28px;background:#2563eb;color:#fff;font:600 16px system-ui;box-shadow:0 4px 16px rgba(0,0,0,.4)';
  document.body.appendChild(btn);

  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;top:12px;left:12px;right:12px;z-index:2147483647;background:#111;color:#fff;padding:12px 16px;border-radius:10px;font:15px system-ui;display:none';
  document.body.appendChild(box);
  const log = t => { box.style.display = 'block'; box.textContent = t; };

  /* ---------- helpers ---------- */
  function jsonArray(html, key) {
    const i = html.indexOf('"' + key + '":[');
    if (i < 0) return null;
    const start = html.indexOf('[', i);
    let depth = 0, inStr = false, esc = false;
    for (let p = start; p < html.length; p++) {
      const c = html[p];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; }
      else if (c === '"') inStr = true;
      else if (c === '[') depth++;
      else if (c === ']') { depth--; if (!depth) return JSON.parse(html.slice(start, p + 1)); }
    }
    return null;
  }

  async function getPlaylistIds(listId) {
    const html = await getText('/playlist?list=' + listId);
    const ids = [];
    const add = v => { if (v && !ids.includes(v)) ids.push(v); };
    let m;
    const re1 = new RegExp('watch\\?v=([\\w-]{11})(?:\\\\u0026|&amp;|&)list=' + listId, 'g');
    while ((m = re1.exec(html))) add(m[1]);
    const re2 = /"playlistVideoRenderer":\{"videoId":"([\w-]{11})"/g;
    while ((m = re2.exec(html))) add(m[1]);
    document.querySelectorAll('a[href*="/watch?v="]').forEach(a => {
      const x = a.href.match(/[?&]v=([\w-]{11})/);
      if (x && a.href.includes('list=' + listId)) add(x[1]);
    });
    console.log('Subtitle tool: found ' + ids.length + ' videos');
    return ids;
  }

  async function getSubs(id) {
    const html = await getText('/watch?v=' + id);
    const t = html.match(/<title>(.*?)<\/title>/s);
    let title = t ? t[1].replace(/ - YouTube$/, '').trim() : id;
    const ta = document.createElement('textarea'); ta.innerHTML = title; title = ta.value;
    let text = '';

    try {
      const tracks = jsonArray(html, 'captionTracks') || [];
      const en = tracks.filter(x => (x.languageCode || '').startsWith('en'));
      const pick = en.find(x => x.kind !== 'asr') || en[0];
      if (pick) {
        const body = await getText(pick.baseUrl + '&fmt=json3');
        if (body) {
          const d = JSON.parse(body);
          text = (d.events || []).filter(e => e.segs)
            .map(e => e.segs.map(s => s.utf8).join('').replace(/\s+/g, ' ').trim())
            .filter(Boolean).join(' ');
        }
      }
    } catch (e) {}

    if (!text) {
      try {
        const p = html.match(/"getTranscriptEndpoint":\{"params":"([^"]+)"/);
        const key = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
        const ver = html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/);
        if (p && key) {
          const r = await fetch('/youtubei/v1/get_transcript?key=' + key[1], {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: ver ? ver[1] : '2.20250101.00.00', hl: 'en' } }, params: unesc(p[1]) })
          });
          const j = await r.json();
          const segs = j.actions[0].updateEngagementPanelAction.content.transcriptRenderer.content
            .transcriptSearchPanelRenderer.body.transcriptSegmentListRenderer.initialSegments;
          text = segs.map(s => (s.transcriptSegmentRenderer.snippet.runs || []).map(x => x.text).join('')
            .replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
        }
      } catch (e) {}
    }
    return { title, text };
  }

  /* ---------- main ---------- */
  let running = false;
  btn.addEventListener('click', async () => {
    if (running) return;
    const m = location.href.match(/[?&]list=([\w-]+)/);
    if (!m) { log('Open a playlist page first (address must contain list=...). Tip: use "Desktop site" in the browser menu.'); return; }
    running = true; btn.disabled = true;
    try {
      log('Loading playlist...');
      const ids = await getPlaylistIds(m[1]);
      if (!ids.length) { log('No videos found. Enable "Desktop site" in the browser menu, reload, and try again.'); return; }

      let out = '', failed = [], ok = 0;
      for (let i = 0; i < ids.length; i++) {
        log('Video ' + (i + 1) + ' of ' + ids.length + '...');
        try {
          const r = await getSubs(ids[i]);
          if (r.text) { out += '===== ' + String(i + 1).padStart(2, '0') + '. ' + r.title + ' =====\n' + r.text + '\n\n'; ok++; }
          else failed.push((i + 1) + '. ' + r.title + ' (' + ids[i] + ')');
        } catch (e) { failed.push((i + 1) + '. ' + ids[i] + ' (' + e.message + ')'); }
        await sleep(500);
      }
      if (failed.length) out += '===== NO SUBTITLES RETRIEVED FOR =====\n' + failed.join('\n') + '\n';

      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([out], { type: 'text/plain;charset=utf-8' }));
      a.download = 'playlist_subtitles.txt';
      document.body.appendChild(a); a.click(); a.remove();
      log('Done: ' + ok + ' of ' + ids.length + ' videos. File downloaded.');
    } catch (e) {
      log('Error: ' + e.message);
    } finally {
      running = false; btn.disabled = false;
    }
  });
})();
