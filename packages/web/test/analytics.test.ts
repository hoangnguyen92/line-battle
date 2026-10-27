import { describe, expect, it } from 'vitest';
import { visitSource } from '../src/analytics';

describe('visit source', () => {
  const page = 'https://linebattle.net/';
  it('prefers a ref tag, then the referring site', () => {
    expect(visitSource('https://linebattle.net/?ref=itch', 'https://m.facebook.com/')).toBe('itch');
    expect(visitSource('https://linebattle.net/?utm_source=Zalo', '')).toBe('zalo');
    expect(visitSource(page, 'https://l.facebook.com/l.php?u=x')).toBe('facebook');
    expect(visitSource(page, 'https://www.youtube.com/shorts/abc')).toBe('youtube');
    expect(visitSource(page, 'https://www.tiktok.com/@linebattlegame')).toBe('tiktok');
    expect(visitSource(page, 'https://www.google.com.vn/')).toBe('google');
    expect(visitSource(page, 'https://voz.vn/t/123')).toBe('voz');
    expect(visitSource(page, 'https://example.org/blog')).toBe('example.org');
  });
  it('counts its own pages and no referrer as direct', () => {
    expect(visitSource(page, '')).toBe('direct');
    expect(visitSource(page, 'https://www.linebattle.net/admin.html')).toBe('direct');
  });
});
