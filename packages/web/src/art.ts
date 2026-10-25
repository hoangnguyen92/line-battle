import type { CharacterId } from '@line-battle/engine';

/**
 * Character and falling-object art, drawn as SVG and turned into images once.
 * Sticker style: flat colours, one highlight, a dark outline. Characters are
 * 100 x 120 with their feet at the bottom centre; objects are 100 x 100,
 * centred. A new character or object pack is a new entry here, not new code.
 */

export type Face = 'idle' | 'blink' | 'look' | 'dazed' | 'ko' | 'win';
export type HitObject = 'apple' | 'flowerpot' | 'bowling' | 'anvil' | 'piano' | 'cow' | 'car';

const INK = '#1b1d2a';
const LINE = `stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;

// ---- faces ------------------------------------------------------------------

/** Eyes and mouth for a face centred on (cx, eyeY) with eyes `gap` apart. */
function face(kind: Face, cx: number, eyeY: number, mouthY: number, gap = 12, eye = INK): string {
  const l = cx - gap, r = cx + gap;
  const lookUp = kind === 'look' ? -3 : 0;
  let eyes: string;
  let mouth: string;
  switch (kind) {
    case 'blink':
      eyes = `<path d="M${l - 4} ${eyeY} h8 M${r - 4} ${eyeY} h8" stroke="${eye}" stroke-width="2.6" stroke-linecap="round"/>`;
      break;
    case 'dazed':
      eyes = [l, r].map((x) => `<path d="M${x} ${eyeY} m-4 0 a4 4 0 1 1 4 4 a2 2 0 1 1 -2 -2" fill="none" stroke="${eye}" stroke-width="2" stroke-linecap="round"/>`).join('');
      break;
    case 'ko':
      eyes = [l, r].map((x) => `<path d="M${x - 4} ${eyeY - 4} l8 8 M${x + 4} ${eyeY - 4} l-8 8" stroke="${eye}" stroke-width="2.6" stroke-linecap="round"/>`).join('');
      break;
    case 'win':
      eyes = [l, r].map((x) => `<path d="M${x - 5} ${eyeY + 2} q5 -7 10 0" fill="none" stroke="${eye}" stroke-width="2.6" stroke-linecap="round"/>`).join('');
      break;
    default:
      eyes = [l, r]
        .map((x) => `<ellipse cx="${x}" cy="${eyeY + lookUp}" rx="3.4" ry="4.4" fill="${eye}"/><circle cx="${x + 1.2}" cy="${eyeY + lookUp - 1.6}" r="1.3" fill="#fff"/>`)
        .join('');
  }
  switch (kind) {
    case 'look':
      mouth = `<ellipse cx="${cx}" cy="${mouthY + 1}" rx="3" ry="3.6" fill="${INK}"/>`;
      break;
    case 'dazed':
      mouth = `<path d="M${cx - 7} ${mouthY + 2} q3.5 -4 7 0 q3.5 4 7 0" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
      break;
    case 'ko':
      mouth = `<path d="M${cx - 6} ${mouthY} h12" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/><path d="M${cx + 1} ${mouthY} q0 7 4 6 q3 -1 1 -6z" fill="#ff7a8a" stroke="${INK}" stroke-width="1.6"/>`;
      break;
    case 'win':
      mouth = `<path d="M${cx - 8} ${mouthY - 2} q8 12 16 0z" fill="#7a2230" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>`;
      break;
    default:
      mouth = `<path d="M${cx - 5} ${mouthY} q5 5 10 0" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
  }
  return eyes + mouth;
}

const shadow = `<ellipse cx="50" cy="116" rx="27" ry="4" fill="#000" opacity="0.35"/>`;

/** Two legs and shoes, standing. */
function legs(pants: string, shoe: string): string {
  return `<rect x="38" y="94" width="9" height="20" rx="4" fill="${pants}" ${LINE}/>
<rect x="53" y="94" width="9" height="20" rx="4" fill="${pants}" ${LINE}/>
<ellipse cx="41" cy="115" rx="8" ry="4" fill="${shoe}" ${LINE}/>
<ellipse cx="59" cy="115" rx="8" ry="4" fill="${shoe}" ${LINE}/>`;
}

/** An arm from the shoulder (x, y): down at the side, or up in the air on a win. */
function arm(x: number, y: number, side: -1 | 1, color: string, hand: string, up: boolean): string {
  const ex = x + side * (up ? 12 : 8);
  const ey = up ? y - 24 : y + 22;
  const mid = up ? `${x + side * 12} ${y - 6}` : `${x + side * 10} ${y + 8}`;
  return `<path d="M${x} ${y} Q${mid} ${ex} ${ey}" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round"/>
<path d="M${x} ${y} Q${mid} ${ex} ${ey}" fill="none" stroke="${color}" stroke-width="6.5" stroke-linecap="round"/>
<circle cx="${ex}" cy="${ey}" r="5" fill="${hand}" ${LINE}/>`;
}

// ---- characters -------------------------------------------------------------

interface CharacterArt {
  /** The whole figure for a face. */
  svg(face: Face): string;
  /** Just the legs, splayed out flat: what shows under the car. */
  flat: string;
}

function splayed(pants: string, shoe: string): string {
  return `<path d="M44 112 L14 114 M56 112 L88 108" stroke="${INK}" stroke-width="11" stroke-linecap="round"/>
<path d="M44 112 L14 114 M56 112 L88 108" stroke="${pants}" stroke-width="6" stroke-linecap="round"/>
<ellipse cx="11" cy="111" rx="5" ry="7" fill="${shoe}" ${LINE}/>
<ellipse cx="91" cy="105" rx="5" ry="7" fill="${shoe}" ${LINE} transform="rotate(-15 91 105)"/>`;
}

const bao: CharacterArt = {
  svg: (f) => `${shadow}${legs('#2c3557', '#f4f4f4')}
${arm(31, 70, -1, '#3fc1b0', '#f6d2b0', f === 'win')}${arm(69, 70, 1, '#3fc1b0', '#f6d2b0', f === 'win')}
<path d="M30 100 Q27 72 38 64 L62 64 Q73 72 70 100 Z" fill="#3fc1b0" ${LINE}/>
<path d="M40 64 Q50 74 60 64" fill="#2a9d8f" ${LINE}/>
<path d="M44 70 v10 M56 70 v10" stroke="#f4f4f4" stroke-width="2" stroke-linecap="round"/>
<rect x="40" y="84" width="20" height="9" rx="3" fill="#2a9d8f" stroke="${INK}" stroke-width="2"/>
<circle cx="27" cy="40" r="5" fill="#f6d2b0" ${LINE}/><circle cx="73" cy="40" r="5" fill="#f6d2b0" ${LINE}/>
<circle cx="50" cy="38" r="23" fill="#f6d2b0" ${LINE}/>
<path d="M27 36 Q24 14 44 13 Q49 4 56 11 Q63 6 66 14 Q77 18 74 34 Q67 25 59 27 Q55 19 49 25 Q41 20 35 27 Q30 28 27 36Z" fill="#22232e" ${LINE}/>
<ellipse cx="36" cy="47" rx="4" ry="2.6" fill="#ff8fa3" opacity="0.6"/><ellipse cx="64" cy="47" rx="4" ry="2.6" fill="#ff8fa3" opacity="0.6"/>
${face(f, 50, 39, 50, 10)}`,
  flat: splayed('#2c3557', '#f4f4f4'),
};

const mochi: CharacterArt = {
  svg: (f) => `${shadow}
<path d="M70 104 Q92 100 88 78 Q86 68 80 72" fill="none" stroke="${INK}" stroke-width="11" stroke-linecap="round"/>
<path d="M70 104 Q92 100 88 78 Q86 68 80 72" fill="none" stroke="#f7a541" stroke-width="6" stroke-linecap="round"/>
<ellipse cx="41" cy="113" rx="8" ry="5" fill="#fff6ea" ${LINE}/><ellipse cx="59" cy="113" rx="8" ry="5" fill="#fff6ea" ${LINE}/>
${arm(33, 72, -1, '#fff6ea', '#fff6ea', f === 'win')}${arm(67, 72, 1, '#fff6ea', '#fff6ea', f === 'win')}
<path d="M32 110 Q26 76 40 66 L60 66 Q74 76 68 110 Z" fill="#fff6ea" ${LINE}/>
<ellipse cx="50" cy="92" rx="11" ry="13" fill="#ffe2c4"/>
<path d="M30 30 L28 8 L46 20 Z" fill="#f7a541" ${LINE}/><path d="M70 30 L72 8 L54 20 Z" fill="#fff6ea" ${LINE}/>
<path d="M32 24 L31 14 L40 20Z" fill="#ffb3c1"/><path d="M68 24 L69 14 L60 20Z" fill="#ffb3c1"/>
<ellipse cx="50" cy="42" rx="25" ry="22" fill="#fff6ea" ${LINE}/>
<path d="M27 38 Q30 22 46 21 Q44 32 34 44 Q29 44 27 38Z" fill="#f7a541"/>
<path d="M28 50 h-10 M28 54 l-9 3 M72 50 h10 M72 54 l9 3" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>
<path d="M47 49 h6 l-3 3z" fill="#ff8fa3" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>
<ellipse cx="35" cy="51" rx="4" ry="2.6" fill="#ff8fa3" opacity="0.55"/><ellipse cx="65" cy="51" rx="4" ry="2.6" fill="#ff8fa3" opacity="0.55"/>
${face(f, 50, 41, 55, 11)}`,
  flat: splayed('#fff6ea', '#f7a541'),
};

function screenEyes(f: Face): string {
  const c = '#5ff3ff';
  switch (f) {
    case 'blink':
      return `<path d="M36 44 h10 M54 44 h10" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`;
    case 'ko':
    case 'dazed':
      return `<path d="M37 39 l8 8 M45 39 l-8 8 M55 39 l8 8 M63 39 l-8 8" stroke="#ff6b7a" stroke-width="3" stroke-linecap="round"/>
<path d="M42 54 q4 -4 8 0 q4 4 8 0" fill="none" stroke="#ff6b7a" stroke-width="2.4" stroke-linecap="round"/>`;
    case 'win':
      return `<path d="M36 46 q5 -8 10 0 M54 46 q5 -8 10 0" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/>
<path d="M42 52 q8 8 16 0" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`;
    case 'look':
      return `<rect x="37" y="36" width="8" height="9" rx="2" fill="${c}"/><rect x="55" y="36" width="8" height="9" rx="2" fill="${c}"/>
<rect x="47" y="51" width="6" height="5" rx="2" fill="${c}"/>`;
    default:
      return `<rect x="37" y="39" width="8" height="10" rx="2" fill="${c}"/><rect x="55" y="39" width="8" height="10" rx="2" fill="${c}"/>
<path d="M43 54 h14" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`;
  }
}

const bolt: CharacterArt = {
  svg: (f) => `${shadow}${legs('#8792b0', '#4b5578')}
${arm(29, 72, -1, '#a9b4d0', '#ffd166', f === 'win')}${arm(71, 72, 1, '#a9b4d0', '#ffd166', f === 'win')}
<rect x="28" y="64" width="44" height="34" rx="8" fill="#a9b4d0" ${LINE}/>
<rect x="38" y="72" width="24" height="14" rx="3" fill="#4b5578" stroke="${INK}" stroke-width="2"/>
<circle cx="44" cy="79" r="2.6" fill="#ff6b7a"/><circle cx="51" cy="79" r="2.6" fill="#ffd166"/><circle cx="58" cy="79" r="2.6" fill="#7ddc8a"/>
<path d="M50 21 V9" stroke="${INK}" stroke-width="6" stroke-linecap="round"/><path d="M50 21 V9" stroke="#c5cde3" stroke-width="2.5"/>
<circle cx="50" cy="7" r="5" fill="${f === 'ko' ? '#6b6f82' : '#ff6b7a'}" ${LINE}/>
<rect x="22" y="36" width="6" height="14" rx="2" fill="#8792b0" ${LINE}/><rect x="72" y="36" width="6" height="14" rx="2" fill="#8792b0" ${LINE}/>
<rect x="26" y="20" width="48" height="42" rx="11" fill="#c5cde3" ${LINE}/>
<rect x="31" y="28" width="38" height="30" rx="7" fill="#1e2440" stroke="${INK}" stroke-width="2"/>
<path d="M34 31 h10" stroke="#fff" stroke-width="2" opacity="0.35" stroke-linecap="round"/>
${screenEyes(f)}`,
  flat: splayed('#8792b0', '#4b5578'),
};

const pip: CharacterArt = {
  svg: (f) => `${shadow}
<path d="M30 112 Q22 112 24 104 L36 102 Z" fill="#5cb85c" ${LINE}/><path d="M70 112 Q78 112 76 104 L64 102 Z" fill="#5cb85c" ${LINE}/>
${arm(30, 72, -1, '#6fd36f', '#6fd36f', f === 'win')}${arm(70, 72, 1, '#6fd36f', '#6fd36f', f === 'win')}
<ellipse cx="50" cy="86" rx="22" ry="25" fill="#6fd36f" ${LINE}/>
<ellipse cx="50" cy="92" rx="14" ry="15" fill="#e8f7c8"/>
<ellipse cx="50" cy="46" rx="28" ry="20" fill="#6fd36f" ${LINE}/>
<circle cx="35" cy="28" r="12" fill="#6fd36f" ${LINE}/><circle cx="65" cy="28" r="12" fill="#6fd36f" ${LINE}/>
<circle cx="35" cy="28" r="8" fill="#fff"/><circle cx="65" cy="28" r="8" fill="#fff"/>
<ellipse cx="33" cy="52" rx="4.5" ry="2.8" fill="#ff8fa3" opacity="0.7"/><ellipse cx="67" cy="52" rx="4.5" ry="2.8" fill="#ff8fa3" opacity="0.7"/>
${face(f, 50, 29, 52, 15)}`,
  flat: splayed('#5cb85c', '#5cb85c'),
};

const CHARACTER_ART: Record<CharacterId, CharacterArt> = { bao, mochi, bolt, pip };

// ---- falling objects ----------------------------------------------------------

const OBJECT_SVG: Record<HitObject, string> = {
  apple: `<path d="M50 30 Q30 18 18 34 Q6 56 22 78 Q34 94 50 86 Q66 94 78 78 Q94 56 82 34 Q70 18 50 30Z" fill="#e8404c" ${LINE}/>
<path d="M28 44 Q30 34 40 34" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity="0.6"/>
<path d="M50 30 Q50 18 56 10" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
<path d="M54 20 Q66 6 80 14 Q68 28 54 20Z" fill="#5ccb4a" ${LINE}/>`,
  flowerpot: `<path d="M50 40 V18" stroke="#3f9b3a" stroke-width="4"/>
<path d="M50 34 Q34 30 30 18 Q44 18 50 30Z M50 30 Q64 24 72 14 Q60 12 50 26Z" fill="#5ccb4a" ${LINE}/>
<g transform="translate(50 14)"><circle r="7" fill="#ffd166" ${LINE}/>${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="0" cy="-12" rx="6" ry="8" fill="#ff7ab8" ${LINE} transform="rotate(${a})"/>`).join('')}<circle r="6" fill="#ffd166" ${LINE}/></g>
<rect x="18" y="40" width="64" height="14" rx="4" fill="#d9773f" ${LINE}/>
<path d="M24 54 L76 54 L68 94 L32 94 Z" fill="#c96a3c" ${LINE}/>
<path d="M30 60 L34 88" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity="0.3"/>`,
  bowling: `<circle cx="50" cy="50" r="40" fill="#2b3a8f" ${LINE}/>
<path d="M22 40 Q28 20 48 14" fill="none" stroke="#7d8fff" stroke-width="6" stroke-linecap="round" opacity="0.6"/>
<circle cx="44" cy="40" r="6" fill="#0d1230"/><circle cx="60" cy="36" r="6" fill="#0d1230"/><circle cx="54" cy="54" r="7" fill="#0d1230"/>`,
  anvil: `<path d="M8 26 H92 Q90 38 76 42 L64 46 Q60 54 64 62 L74 66 V80 H26 V66 L36 62 Q40 54 36 46 L24 42 Q10 38 8 26Z" fill="#7d8295" ${LINE}/>
<path d="M12 28 H88" stroke="#c5cad8" stroke-width="5" stroke-linecap="round"/>
<rect x="18" y="80" width="64" height="10" rx="3" fill="#5c6072" ${LINE}/>
<text x="50" y="74" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="12" font-weight="900" fill="#4a4e5e">10T</text>`,
  piano: `<rect x="8" y="16" width="84" height="56" rx="6" fill="#20212b" ${LINE}/>
<path d="M14 22 H70" stroke="#fff" stroke-width="3" opacity="0.25" stroke-linecap="round"/>
<rect x="8" y="58" width="84" height="22" fill="#f4f4f4" ${LINE}/>
${[1, 2, 3, 4, 5, 6, 7].map((i) => `<path d="M${8 + i * 10.5} 58 V80" stroke="${INK}" stroke-width="1.6"/>`).join('')}
${[1, 2, 4, 5, 6].map((i) => `<rect x="${8 + i * 10.5 - 3}" y="58" width="6" height="13" fill="${INK}"/>`).join('')}
<rect x="12" y="80" width="6" height="14" fill="#20212b" ${LINE}/><rect x="82" y="80" width="6" height="14" fill="#20212b" ${LINE}/>`,
  cow: `<path d="M24 74 V92 M38 76 V92 M60 76 V92 M74 74 V92" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>
<path d="M24 74 V90 M38 76 V90 M60 76 V90 M74 74 V90" stroke="#f4f4f4" stroke-width="5" stroke-linecap="round"/>
<path d="M10 54 Q4 50 6 44" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
<rect x="10" y="38" width="70" height="42" rx="18" fill="#f4f4f4" ${LINE}/>
<path d="M22 44 Q32 40 34 50 Q30 60 20 56Z M50 60 Q60 54 66 62 Q62 74 50 70Z" fill="#20222e"/>
<ellipse cx="54" cy="80" rx="8" ry="4" fill="#ffb3c1" ${LINE}/>
<path d="M74 26 L70 14 M90 26 L94 14" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
<ellipse cx="82" cy="40" rx="15" ry="16" fill="#f4f4f4" ${LINE}/>
<ellipse cx="84" cy="50" rx="11" ry="7" fill="#ffb3c1" ${LINE}/>
<circle cx="80" cy="50" r="1.6" fill="${INK}"/><circle cx="88" cy="50" r="1.6" fill="${INK}"/>
<circle cx="77" cy="36" r="2.6" fill="${INK}"/><circle cx="88" cy="36" r="2.6" fill="${INK}"/>`,
  car: `<path d="M6 70 Q6 54 20 52 L30 50 L40 34 Q44 28 52 28 H70 Q78 28 82 36 L88 50 Q96 52 96 62 V70 Q96 76 90 76 H12 Q6 76 6 70Z" fill="#e64a55" ${LINE}/>
<path d="M44 48 L50 36 H62 V48Z" fill="#9fd8ff" ${LINE}/><path d="M66 36 H74 Q78 36 80 40 L84 48 H66Z" fill="#9fd8ff" ${LINE}/>
<path d="M12 60 H90" stroke="#ff8a93" stroke-width="3" stroke-linecap="round"/>
<rect x="88" y="58" width="8" height="6" rx="2" fill="#ffd166" ${LINE}/>
<circle cx="28" cy="76" r="12" fill="#20212b" ${LINE}/><circle cx="28" cy="76" r="5" fill="#c5cad8"/>
<circle cx="76" cy="76" r="12" fill="#20212b" ${LINE}/><circle cx="76" cy="76" r="5" fill="#c5cad8"/>`,
};

const UMBRELLA_SVG = `<path d="M50 30 V88 Q50 96 42 96 Q36 96 36 90" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
<path d="M50 30 V88 Q50 96 42 96 Q36 96 36 90" fill="none" stroke="#c7c9d6" stroke-width="2" stroke-linecap="round"/>
<path d="M4 46 Q8 8 50 6 Q92 8 96 46 Q86 38 76 46 Q64 36 50 46 Q36 36 24 46 Q14 38 4 46Z" fill="#4f8cff" ${LINE}/>
<path d="M50 6 Q36 20 24 46 M50 6 Q64 20 76 46" fill="none" stroke="#2f5fcc" stroke-width="2"/>
<path d="M18 26 Q26 14 40 12" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity="0.5"/>`;

// ---- images -----------------------------------------------------------------

const images = new Map<string, HTMLImageElement>();

function image(key: string, viewBox: string, body: string): HTMLImageElement | null {
  let img = images.get(key);
  if (!img) {
    img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`)}`;
    images.set(key, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** The character with a face; null until the image has loaded. */
export function characterImage(id: CharacterId, f: Face): HTMLImageElement | null {
  return image(`c:${id}:${f}`, '0 0 100 120', CHARACTER_ART[id].svg(f));
}

/** The character's legs sticking out flat, for under the car. */
export function flatImage(id: CharacterId): HTMLImageElement | null {
  return image(`f:${id}`, '0 0 100 120', CHARACTER_ART[id].flat);
}

export function objectImage(o: HitObject): HTMLImageElement | null {
  return image(`o:${o}`, '0 0 100 100', OBJECT_SVG[o]);
}

export function umbrellaImage(): HTMLImageElement | null {
  return image('umbrella', '0 0 100 100', UMBRELLA_SVG);
}

/** Starts every image loading, so the first hit of a match isn't invisible. */
export function preloadArt(): void {
  const faces: Face[] = ['idle', 'blink', 'look', 'dazed', 'ko', 'win'];
  for (const id of Object.keys(CHARACTER_ART) as CharacterId[]) {
    for (const f of faces) characterImage(id, f);
    flatImage(id);
  }
  for (const o of Object.keys(OBJECT_SVG) as HitObject[]) objectImage(o);
  umbrellaImage();
}

/** A character as a standalone SVG data URL, for the customise screen. */
export function characterUrl(id: CharacterId, f: Face = 'idle'): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120">${CHARACTER_ART[id].svg(f)}</svg>`)}`;
}
