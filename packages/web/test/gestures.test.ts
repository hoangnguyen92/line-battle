import { describe, expect, it } from 'vitest';
import { inAppBrowser } from '../src/gestures';

describe('in-app browser detection', () => {
  it('spots the apps players come from', () => {
    expect(inAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.0]')).toBe('facebook');
    expect(inAppBrowser('Mozilla/5.0 (Linux; Android 14; SM-A546E) Chrome/130.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]')).toBe('facebook');
    expect(inAppBrowser('Mozilla/5.0 (iPhone) Mobile/15E148 Instagram 350.0.0')).toBe('instagram');
    expect(inAppBrowser('Mozilla/5.0 (Linux; Android 13) Chrome/120.0 Mobile Safari/537.36 Zalo android/12')).toBe('zalo');
  });

  it('leaves ordinary browsers alone', () => {
    expect(inAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1')).toBeNull();
    expect(inAppBrowser('Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36')).toBeNull();
  });
});
