/* ──────────────────────────────────────────────────────────────────────────
   Word Playground · Shared leaderboard (Firebase compat SDK v12)
   Load order on each page (before this file):
     firebase-app-compat.js, firebase-auth-compat.js, firebase-firestore-compat.js,
     firebase-config.js
   Exposes a global  LB  object. See docs/ENHANCEMENTS.md for the data model.
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  const LB = {
    ready: false,
    enabled: false,
    uid: null,
    username: null,
    totalPoints: 0,
    _resolvers: [],
  };
  window.LB = LB;

  // ── Scoring (unified points, difficulty-weighted) ──
  const DIFFICULTY = { antonym: 1.0, synonym: 1.25, plural: 1.5 };
  const TARGET_MS  = { antonym: 60000, synonym: 90000, plural: 120000 }; // "fast" targets for the speed bonus
  const MAX_SUBMIT = 2000; // hard cap per game (matches security rules)

  LB.score = function ({ game, correct = 0, timeMs = 0, perfect = false, extra = 0 }) {
    const w = DIFFICULTY[game] || 1;
    let pts = correct * 10 * w;
    if (timeMs > 0 && TARGET_MS[game]) {
      const ratio = Math.max(0, 1 - timeMs / TARGET_MS[game]); // 0..1, more for faster
      pts += Math.round(ratio * 50);                            // speed bonus up to +50
    }
    if (perfect) pts += 50;                                     // perfect-game bonus
    pts += extra;                                               // streak/combo bonus from the game
    return Math.max(0, Math.min(MAX_SUBMIT, Math.round(pts)));
  };

  LB.whenReady = function () {
    return new Promise((res) => { LB.ready ? res() : LB._resolvers.push(res); });
  };

  // ── Firebase init + anonymous auth ──
  let db = null, auth = null;
  (function init() {
    const cfg = window.FIREBASE_CONFIG;
    if (!cfg || !cfg.apiKey || cfg.apiKey === 'PASTE_API_KEY') {
      console.warn('[LB] Firebase config not set yet — leaderboard is disabled.');
      return;
    }
    if (typeof firebase === 'undefined') {
      console.warn('[LB] Firebase SDK not loaded — check the <script> tags.');
      return;
    }
    try {
      firebase.initializeApp(cfg);
      auth = firebase.auth();
      db = firebase.firestore();
      LB.enabled = true;
    } catch (e) { console.error('[LB] init failed', e); return; }

    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        try { await auth.signInAnonymously(); }
        catch (e) { console.error('[LB] anonymous sign-in failed', e); }
        return;
      }
      LB.uid = user.uid;
      try {
        const snap = await db.collection('users').doc(user.uid).get();
        if (snap.exists) {
          const d = snap.data();
          LB.username = d.username || null;
          LB.totalPoints = d.totalPoints || 0;
        }
      } catch (e) { console.error('[LB] profile load failed', e); }
      LB.ready = true;
      LB._resolvers.splice(0).forEach((r) => r());
      document.dispatchEvent(new CustomEvent('lb-ready'));
    });
  })();

  const svrTs = () => firebase.firestore.FieldValue.serverTimestamp();
  const inc   = (n) => firebase.firestore.FieldValue.increment(n);

  // ── Submit a finished game: add points to lifetime total + log the play ──
  LB.submit = async function ({ game, points, correct = 0, timeMs = 0 }) {
    await LB.whenReady();
    if (!LB.enabled || !LB.uid) return 0;
    points = Math.max(0, Math.min(MAX_SUBMIT, Math.round(points || 0)));

    const userRef = db.collection('users').doc(LB.uid);
    const data = { totalPoints: inc(points), updatedAt: svrTs() };
    if (!LB.totalPoints) data.createdAt = svrTs();
    try {
      await userRef.set(data, { merge: true });
      LB.totalPoints += points;
    } catch (e) { console.error('[LB] total update failed', e); }

    try {
      await db.collection('plays').add({ uid: LB.uid, game, points, correct, timeMs, createdAt: svrTs() });
    } catch (e) { console.error('[LB] play write failed', e); }

    return points;
  };

  // ── Claim a unique username (transaction-safe) ──
  LB.claimUsername = async function (name) {
    await LB.whenReady();
    if (!LB.enabled || !LB.uid) throw new Error('offline');
    name = (name || '').trim().replace(/\s+/g, ' ');
    if (!/^[A-Za-z0-9_ ]{2,12}$/.test(name)) throw new Error('invalid');
    const lower = name.toLowerCase();
    const nameRef = db.collection('usernames').doc(lower);
    const userRef = db.collection('users').doc(LB.uid);

    await db.runTransaction(async (tx) => {
      const nameSnap = await tx.get(nameRef);
      if (nameSnap.exists && nameSnap.data().uid !== LB.uid) throw new Error('taken');
      tx.set(nameRef, { uid: LB.uid });
      tx.set(userRef, { username: name, usernameLower: lower, totalPoints: inc(0), updatedAt: svrTs() }, { merge: true });
    });
    LB.username = name;
    document.dispatchEvent(new CustomEvent('lb-username', { detail: name }));
    return name;
  };

  // ── Read top N players (skips players who haven't claimed a username) ──
  LB.getTop = async function (n = 10) {
    await LB.whenReady();
    if (!LB.enabled) return [];
    const snap = await db.collection('users').orderBy('totalPoints', 'desc').limit(n * 3).get();
    const rows = [];
    snap.forEach((doc) => {
      const d = doc.data();
      if (d.username) rows.push({ uid: doc.id, username: d.username, totalPoints: d.totalPoints || 0, me: doc.id === LB.uid });
    });
    return rows.slice(0, n);
  };

  /* ── UI: styles ── */
  const style = document.createElement('style');
  style.textContent = `
    .lb-panel{width:100%;background:#fff;border-radius:24px;padding:18px 18px 14px;box-shadow:0 6px 0 rgba(0,0,0,.06);border:2px solid #f0f0f0;margin-top:16px;text-align:left;}
    .lb-title{font-family:'Fredoka One',cursive;font-size:18px;color:#A855F7;text-align:center;margin-bottom:12px;}
    .lb-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:14px;margin-bottom:6px;background:#FAF7FF;font-weight:800;}
    .lb-row.me{background:linear-gradient(135deg,#FFF3E0,#FFE8F4);box-shadow:0 0 0 2px #FF6B9D40;}
    .lb-rank{font-family:'Fredoka One',cursive;font-size:16px;color:#bbb;width:30px;text-align:center;flex-shrink:0;}
    .lb-name{flex:1;color:#555;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .lb-name .lb-you{font-size:10px;color:#FF6B9D;letter-spacing:1px;}
    .lb-pts{font-family:'Fredoka One',cursive;color:#A855F7;font-size:15px;white-space:nowrap;}
    .lb-empty{text-align:center;color:#bbb;font-weight:700;font-size:13px;padding:8px;}
    .lb-cta{display:block;width:100%;margin-top:10px;padding:12px;border:none;border-radius:16px;cursor:pointer;font-family:'Fredoka One',cursive;font-size:15px;color:#fff;background:linear-gradient(135deg,#A855F7,#FF6B9D);box-shadow:0 4px 0 rgba(168,85,247,.3);}
    .lb-mask{position:fixed;inset:0;z-index:600;background:rgba(168,85,247,.45);display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;pointer-events:none;transition:opacity .25s;}
    .lb-mask.show{opacity:1;pointer-events:all;}
    .lb-modal{background:#fff;border-radius:26px;padding:26px 22px;max-width:360px;width:100%;text-align:center;box-shadow:0 12px 0 rgba(0,0,0,.1);transform:scale(.86);transition:transform .3s cubic-bezier(.175,.885,.32,1.275);}
    .lb-mask.show .lb-modal{transform:scale(1);}
    .lb-modal h3{font-family:'Fredoka One',cursive;font-size:22px;color:#A855F7;margin-bottom:6px;}
    .lb-modal p{font-size:13px;font-weight:700;color:#888;margin-bottom:16px;line-height:1.5;}
    .lb-input{width:100%;padding:13px 16px;border-radius:16px;border:3px solid #eee;font-family:'Fredoka One',cursive;font-size:20px;color:#555;text-align:center;outline:none;background:#FAFAFA;}
    .lb-input:focus{border-color:#A855F7;box-shadow:0 0 0 4px rgba(168,85,247,.15);}
    .lb-err{color:#FF4757;font-size:12px;font-weight:800;min-height:16px;margin-top:8px;}
    .lb-btns{display:flex;gap:10px;margin-top:14px;}
    .lb-btns button{flex:1;padding:13px;border:none;border-radius:16px;cursor:pointer;font-family:'Fredoka One',cursive;font-size:16px;}
    .lb-save{color:#fff;background:linear-gradient(135deg,#6BCB77,#4ECDC4);box-shadow:0 4px 0 rgba(0,0,0,.12);}
    .lb-skip{color:#999;background:#f0f0f0;}
  `;
  document.head.appendChild(style);

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MEDAL = ['🥇', '🥈', '🥉'];

  // ── Render the board into a container element ──
  LB.renderBoard = async function (el, { limit = 10, cta = false } = {}) {
    if (!el) return;
    if (!LB.enabled) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="lb-panel"><div class="lb-title">🏆 Leaderboard</div><div class="lb-empty">Loading…</div></div>`;
    let rows = [];
    try { rows = await LB.getTop(limit); } catch (e) { console.error('[LB] board load', e); }

    let inner = `<div class="lb-title">🏆 Leaderboard</div>`;
    if (!rows.length) {
      inner += `<div class="lb-empty">No scores yet — be the first! 🎉</div>`;
    } else {
      inner += rows.map((r, i) => `
        <div class="lb-row ${r.me ? 'me' : ''}">
          <span class="lb-rank">${MEDAL[i] || (i + 1)}</span>
          <span class="lb-name">${esc(r.username)}${r.me ? ' <span class="lb-you">(YOU)</span>' : ''}</span>
          <span class="lb-pts">${r.totalPoints.toLocaleString()}</span>
        </div>`).join('');
    }
    if (cta && LB.ready && !LB.username) {
      inner += `<button class="lb-cta" onclick="LB.promptUsername()">✨ Join the leaderboard</button>`;
    }
    el.innerHTML = `<div class="lb-panel">${inner}</div>`;
  };

  // ── Username claim modal ──
  let maskEl = null;
  LB.promptUsername = function ({ onDone } = {}) {
    if (!LB.enabled) return;
    if (!maskEl) {
      maskEl = document.createElement('div');
      maskEl.className = 'lb-mask';
      maskEl.innerHTML = `
        <div class="lb-modal">
          <h3>🎉 Nice game!</h3>
          <p>Pick a username to save your score on the leaderboard. No password needed!</p>
          <input class="lb-input" id="lb-name-input" maxlength="12" placeholder="your name" autocomplete="off" spellcheck="false">
          <div class="lb-err" id="lb-name-err"></div>
          <div class="lb-btns">
            <button class="lb-skip" id="lb-skip">Maybe later</button>
            <button class="lb-save" id="lb-save">Save ✓</button>
          </div>
        </div>`;
      document.body.appendChild(maskEl);
    }
    const input = maskEl.querySelector('#lb-name-input');
    const err = maskEl.querySelector('#lb-name-err');
    err.textContent = ''; input.value = LB.username || '';
    maskEl.classList.add('show');
    setTimeout(() => input.focus(), 100);

    const close = () => { maskEl.classList.remove('show'); if (onDone) onDone(); };
    maskEl.querySelector('#lb-skip').onclick = close;
    const save = async () => {
      const name = input.value.trim();
      err.textContent = '';
      try {
        await LB.claimUsername(name);
        close();
      } catch (e) {
        err.textContent = e.message === 'taken' ? 'That name is taken — try another!'
          : e.message === 'invalid' ? '2–12 letters, numbers, spaces or _'
          : 'Something went wrong, try again.';
      }
    };
    maskEl.querySelector('#lb-save').onclick = save;
    input.onkeydown = (e) => { if (e.key === 'Enter') save(); };
  };

  // Convenience: prompt for a name after a game IF the player hasn't got one yet.
  LB.maybePromptAfterGame = async function (opts) {
    await LB.whenReady();
    if (LB.enabled && !LB.username) LB.promptUsername(opts);
  };
})();
