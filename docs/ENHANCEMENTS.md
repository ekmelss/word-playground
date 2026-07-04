# Word Playground — Enhancement Requirements

**Status:** Decisions locked · **Date:** 2026-07-04
**Repo:** `ekmelss/word-playground` (static site, GitHub Pages)
**Constraint:** Must stay **$0 cost**.

---

## 0. Current state (baseline)

Pure static site, no build step, no backend.

- `index.html` — home / playground picker, Word of the Day, best-scores strip
- `antonym.html` — **Flip or Flop** game
- `wordmatch.html` — **Synonym Match** game
- `typing.html` — **Plural Rush** game
- `bgm.mp3` — single background track, **loops globally**
- Scores today: saved **per-device only** via `localStorage`
  (`wp_antonym_best`, `wp_synonym_best`, `wp_plural_best`, `wp_music_muted`)

---

## 1. Goals & progress

| # | Feature | Backend? | Status |
|---|---------|----------|--------|
| 1 | Timer for each game | No | ✅ **Done** |
| 2 | Full song per game | No | 🟡 Wired — waiting on mp3 files |
| 3 | **Shared online leaderboard** | Yes (Firebase) | ✅ **Done** — verified in Firestore (project `word-playground-hani`) |
| 4 | Design refresh | No | 🟡 Homepage playground redone (2D roam + CSS kid) — testing |

---

## 2. Locked decisions

- **Backend / DB:** **Firebase Firestore** (free Spark plan) — live leaderboard, never sleeps, drops into static HTML via CDN `<script>`.
- **Player identity:** **Option A — anonymous account + username claim.**
  - Firebase Anonymous Auth silently creates a persistent account per browser on first visit.
  - **After the player finishes their first game**, prompt: "🎉 Pick a username to save your spot!" — unique name, **no password, no email**.
  - Upgradeable later to Option B (username + password + one-time recovery code) for cross-device login.
  - Rejected: name-only password reset (anyone could hijack an account); hand-rolled password storage (insecure on a static site).
- **Ranking:** **Cumulative lifetime total points**, weighted by game difficulty (below). Per-game personal bests still shown so skill is visible.

---

## 3. Scoring model (locked)

One shared points pot. Every finished game adds points to the player's lifetime total, which is what the leaderboard ranks by.

**Per-game points earned:**
```
pointsThisGame = (correct × 10 × difficultyWeight)
               + streakBonus     (reward combos, where the game has streaks)
               + speedBonus      (finish under target time, up to +50; uses the new timer)
               + perfectBonus    (no mistakes, +50)
```

**Difficulty weights** (typing is hardest → earns most):

| Game | Type | Weight |
|------|------|--------|
| Flip or Flop (antonym) | recognition | **×1.0** |
| Synonym Match | recognition + recall | **×1.25** |
| Plural Rush (typing) | active production | **×1.5** |

Worked examples:
- Flip or Flop 8/8, fast, perfect → `8×10×1.0 + 50 + 30 = 160`
- Plural Rush 20 words → `20×10×1.5 + bonuses ≈ 300+`

⚠️ **Balancing note:** Plural Rush is length-variable, so cap or normalize a single run so a marathon can't dwarf everyone. Tunable once we see real numbers. Plural Rush already computes an internal `score`; the other two currently store best-correct / best-stars — each game will map its result into the unified formula above before submitting.

---

## 4. Requirements per feature

### 4.1 Timer (each game) — ✅ DONE
Implemented a shared `GameClock` module in all three games:
- Live `M:SS` elapsed clock shown during play (`#game-time`, in the progress row).
- Final time shown on the results screen (`#result-time`).
- Starts on "Let's Play"/replay; **pauses** when the How-to modal opens or the tab is hidden; resumes on return.
- Stashes `lastGameMs` on each game-over, ready to submit with the leaderboard score.
- No per-question countdowns were changed (those already existed in antonym/typing).

### 4.2 Full song per game — 🟡 WIRED (waiting on files)
Note: game pages previously had **no** BGM, only Web-Audio SFX. Added per-game BGM:
- Each game page now has `<audio id="bgm" loop preload="auto">` + a shared BGM controller.
- **Defaults chosen:** loops quietly (vol 0.28), restarts per page, starts on first user gesture (autoplay-safe).
- The existing 🔊 mute button now controls **BGM + SFX + speech together**, and the mute pref is shared site-wide via `localStorage['wp_music_muted']` (same key the home page uses).
- Missing files fail silently (no error) — it just stays quiet until the mp3s are added.

**Picked tracks (Pixabay Content License — free, no attribution, repo-safe):**
| File to add | Track | Pixabay ID |
|---|---|---|
| `song-antonym.mp3` | Fun Kids Playful Comic Carefree Game Happy Positive | 57026 |
| `song-synonym.mp3` | Positive Fun – Playful and Uplifting | 248800 |
| `song-plural.mp3` | Funny Kids Games (Happy) | 179909 |
| (spare) | Children Happy Cheerful Positive Playground (10-min) | 442877 |
| Home `bgm.mp3` | keep existing "Play With Me" | — |

**To activate:** download each track from Pixabay, rename to the filename above, drop in `word-dodge/`.
Easy tweaks: remove `loop` attr = play once; point all three `src` to one file = shared song.
⚠️ ~4 MB each; a few is fine on Pages, don't pile on dozens.

### 4.3 Shared leaderboard (Firebase)
- **Auth:** Firebase Anonymous Auth; claim unique username after first game (see §2).
- **Data model** — Firestore:
  ```
  users/{uid}      → { username, usernameLower, totalPoints, createdAt, updatedAt }
  usernames/{nameLower} → { uid }        // reserves a unique name
  plays/{autoId}   → { uid, game, points, correct, timeMs, createdAt }  // history/audit
  ```
- **Write:** on game-over, add points to `users/{uid}.totalPoints` (+ a `plays` record).
- **Read:** top N by `totalPoints desc`; optional live updates.
- **Where shown:** leaderboard panel on each game-over screen + combined board on `index.html`.
- **Security rules (must-do):** a user may only write their own `users/{uid}` and `plays`; validate types + bounds to limit spam; usernames write-once.
- **Abuse note:** a public client-writable board can be gamed; acceptable for a school/portfolio project; rules keep it sane.

### 4.4 Design refresh
- Keep the playful identity (Fredoka One + Nunito, pastel palette, splash, playground stage).
- Scope TBD — list specific screens/pain points to redesign.

---

## 5. Build order
1. ✅ **Timer** — done (feeds the ranking tiebreaker & speed bonus).
2. **Per-game songs** — asset swap + small audio logic change.
3. **Firebase** — project + anon auth + Firestore rules + username claim + leaderboard read/write on one game as pilot.
4. Roll leaderboard out to the other two games + home board.
5. **Design pass.**

## 6. Waiting on you
- Firebase project setup (create project → enable Anonymous Auth + Firestore → paste the web config). I'll wire the rest.
- Which specific screens are in scope for the design refresh.
