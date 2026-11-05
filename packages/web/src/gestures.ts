import { t } from './i18n';

/**
 * Keeps a phone's own swipe gestures from taking over during play. In-app browsers
 * (Facebook, Messenger, Instagram, Zalo) and mobile Safari treat a sideways swipe as
 * "go back", which closes the game and drops the player back in the app.
 *
 * - While playing, page scrolling, pull-to-refresh and pinch are switched off, and
 *   touch moves are cancelled so the page itself never pans.
 * - The game keeps one history entry of its own while playing, so a back swipe or the
 *   phone's back button lands on that entry instead of leaving, and the match goes on
 *   (the ✕ button is how to leave).
 */
export class GestureGuard {
  private playing = false;
  /** Whether our history entry is on top. */
  private pushed = false;

  constructor() {
    // Non-passive, or the browser ignores preventDefault and pans anyway. A touch that
    // starts on the board, even at the screen edge, is the game's; buttons keep their clicks.
    document.addEventListener('touchstart', (e) => {
      if (this.playing && e.cancelable && !(e.target as Element | null)?.closest?.('button, a, input, select')) e.preventDefault();
    }, { passive: false });
    document.addEventListener('touchmove', (e) => {
      if (this.playing && e.cancelable) e.preventDefault();
    }, { passive: false });
    // Two-finger pinch on iOS ignores touch-action; gesture events let us stop it.
    for (const type of ['gesturestart', 'gesturechange']) {
      document.addEventListener(type, (e) => {
        if (this.playing) e.preventDefault();
      }, { passive: false });
    }
    addEventListener('popstate', () => {
      if (!this.pushed) return;
      this.pushed = false;
      if (!this.playing) return;
      // A swipe mid-match is almost always by accident: stay, and keep the entry for next time.
      this.push();
    });
  }

  setPlaying(on: boolean): void {
    if (on === this.playing) return;
    this.playing = on;
    document.documentElement.classList.toggle('no-gestures', on);
    if (on && !this.pushed) this.push();
  }

  private push(): void {
    try {
      history.pushState({ lineBattle: 'playing' }, '');
      this.pushed = true;
    } catch {
      /* some embedded browsers refuse; the touch guards still apply */
    }
  }
}

export type InAppBrowser = 'facebook' | 'instagram' | 'zalo' | 'tiktok' | null;

/** The app whose built-in browser this page is open in, from its user agent. */
export function inAppBrowser(ua = navigator.userAgent): InAppBrowser {
  if (/FBAN|FBAV|FB_IAB|FBIOS|Messenger/i.test(ua)) return 'facebook';
  if (/Instagram/i.test(ua)) return 'instagram';
  if (/Zalo/i.test(ua)) return 'zalo';
  if (/musical_ly|BytedanceWebview|TikTok/i.test(ua)) return 'tiktok';
  return null;
}

/**
 * A note on the home page for players inside an app's browser, where swipes can close
 * the game. On Android a button opens the page in Chrome; iOS apps don't allow that,
 * so it says where the app's own "open in browser" item is.
 */
export function inAppNote(ua = navigator.userAgent): HTMLElement | null {
  if (!inAppBrowser(ua)) return null;
  const note = document.createElement('p');
  note.className = 'inapp-note';
  if (/Android/i.test(ua)) {
    const url = new URL(location.href);
    const a = document.createElement('a');
    a.href = `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=https;package=com.android.chrome;end`;
    a.textContent = t('Open in Chrome');
    note.append(t('Plays smoother in your browser.'), ' ', a);
  } else {
    note.textContent = t('Plays smoother in Safari: tap ⋯ then "Open in browser".');
  }
  return note;
}
