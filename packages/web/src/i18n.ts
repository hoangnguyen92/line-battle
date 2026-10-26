/**
 * The game's text in other languages. English is written in place in the
 * code and the page; t() looks the English up here and falls back to it, so
 * a missing translation shows English rather than nothing. `{name}` marks a
 * value filled in at run time.
 */
export const LANGUAGES = ['en', 'vi'] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', vi: 'Tiếng Việt' };

const LANGUAGE_KEY = 'lineBattle.language';

function detect(): Language {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if ((LANGUAGES as readonly string[]).includes(saved ?? '')) return saved as Language;
  } catch {
    /* storage blocked: go by the browser */
  }
  const browser = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language];
  return browser.some((l) => l?.toLowerCase().startsWith('vi')) ? 'vi' : 'en';
}

export const language: Language = detect();

/** Saves the choice; the page reloads to show it everywhere. */
export function setLanguage(next: Language): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, next);
  } catch {
    /* it just won't stick after this visit */
  }
  location.reload();
}

const VI: Record<string, string> = {
  // ---- menu
  'Clear lines, build combos, bury your opponent.': 'Xóa hàng, nối combo, chôn vùi đối thủ.',
  'Playing as a guest': 'Đang chơi với tư cách khách',
  'Log in or sign up': 'Đăng nhập hoặc đăng ký',
  'Profile and leaderboard': 'Hồ sơ và bảng xếp hạng',
  'Log out': 'Đăng xuất',
  'Solo and local': 'Chơi đơn và cùng máy',
  '40 Lines Sprint': 'Sprint 40 hàng',
  'Best:': 'Kỷ lục:',
  'none yet': 'chưa có',
  'Local versus (2 players)': 'Đấu 2 người cùng máy',
  'How to play': 'Cách chơi',
  'Versus bots': 'Chơi với máy',
  'Bot level': 'Cấp độ máy',
  'Versus bot': 'Đấu với máy',
  'Gauntlet': 'Vượt ải',
  'Gauntlet:': 'Vượt ải:',
  'not started': 'chưa bắt đầu',
  'all 5 bots beaten': 'đã thắng cả 5 máy',
  '{n} of 5 bots beaten': 'đã thắng {n}/5 máy',
  'Online 1v1': 'Đấu online 1v1',
  'Your name': 'Tên của bạn',
  'Ranked': 'Xếp hạng',
  'Quick match': 'Đấu nhanh',
  'Rated matches against players near your rating. Needs an account.': 'Trận tính điểm với người chơi gần điểm của bạn. Cần có tài khoản.',
  'Private room with a friend': 'Phòng riêng với bạn bè',
  'Create room': 'Tạo phòng',
  'CODE': 'MÃ',
  'Room code': 'Mã phòng',
  'Join': 'Vào',
  'Your region': 'Khu vực của bạn',
  'Matchmaking pairs players in the same region first.': 'Ghép trận ưu tiên người chơi cùng khu vực.',
  'Character and skins': 'Nhân vật và giao diện',
  'Controls': 'Phím điều khiển',
  'Handling': 'Độ nhạy phím',
  'Keys and rules': 'Phím và luật chơi',
  'Language': 'Ngôn ngữ',
  '{pps} pieces per second': '{pps} khối mỗi giây',
  'Beginner': 'Mới chơi',
  'Casual': 'Thường',
  'Intermediate': 'Trung bình',
  'Advanced': 'Nâng cao',
  'Expert': 'Chuyên gia',
  'Asia': 'Châu Á',
  'Oceania': 'Châu Đại Dương',
  'Europe and Africa': 'Châu Âu và châu Phi',
  'Americas': 'Châu Mỹ',

  // ---- key tables
  'Sprint, bots and online': 'Sprint, đấu máy và online',
  'Versus': 'Đấu 2 người',
  'Player 1': 'Người chơi 1',
  'Player 2': 'Người chơi 2',
  'Move': 'Di chuyển',
  'Move left': 'Sang trái',
  'Move right': 'Sang phải',
  'Soft drop': 'Rơi nhanh',
  'Hard drop': 'Thả thẳng',
  'Rotate clockwise': 'Xoay phải',
  'Rotate counter-clockwise': 'Xoay trái',
  'Rotate 180': 'Xoay 180',
  'Hold': 'Giữ',
  'Left Shift': 'Shift trái',
  'Right Shift': 'Shift phải',
  'Menu': 'Menu',
  'Restart / menu': 'Chơi lại / menu',
  'or': 'hoặc',
  'none': 'không có',
  'Online matches are first to 2 rounds and use the sprint keys. Ranked and quick match pair you with a player near your rating, in your region first. Ranked moves your rating and needs an account. Create a room and send its code to a friend to play them directly. The gauntlet runs through all 5 bots from Beginner to Expert; lose a match and the run ends. Every match is first to 2 rounds. Your attacks cancel garbage waiting for you first; the rest goes to your opponent. The bar beside each board shows incoming garbage (orange = still cancellable, red = rises on your next piece that clears nothing).':
    'Trận online thắng 2 hiệp là thắng và dùng phím của chế độ sprint. Xếp hạng và đấu nhanh ghép bạn với người chơi gần điểm của bạn, ưu tiên cùng khu vực. Xếp hạng làm thay đổi điểm của bạn và cần có tài khoản. Tạo phòng rồi gửi mã cho bạn bè để đấu trực tiếp. Vượt ải lần lượt đấu cả 5 máy từ Mới chơi đến Chuyên gia; thua một trận là kết thúc. Mỗi trận thắng 2 hiệp là thắng. Đòn tấn công của bạn trước hết sẽ triệt tiêu hàng rác đang chờ bạn; phần còn lại gửi sang đối thủ. Thanh bên cạnh mỗi bảng cho thấy hàng rác sắp tới (cam = vẫn triệt tiêu được, đỏ = sẽ dâng lên ở khối tiếp theo không xóa được hàng nào).',

  // ---- handling
  'DAS: Delayed Auto Shift': 'DAS: Độ trễ tự trượt',
  'ARR: Auto Repeat Rate': 'ARR: Tốc độ lặp tự động',
  'SDF: Soft drop speed': 'SDF: Tốc độ rơi nhanh',
  'How long you hold left or right before the piece starts sliding on its own. Lower = slides sooner.':
    'Thời gian giữ phím trái hoặc phải trước khi khối tự trượt. Càng thấp = trượt càng sớm.',
  'Once it slides, the time between each step. 0 = it jumps straight to the wall.':
    'Khi đã trượt, đây là thời gian giữa mỗi bước. 0 = khối lao thẳng vào tường.',
  'How much faster the piece falls while you hold soft drop. All the way right = instant.':
    'Khối rơi nhanh hơn bao nhiêu khi bạn giữ phím rơi nhanh. Kéo hết sang phải = tức thì.',
  '1 frame = 1/60 of a second (about 17 ms).': '1 khung hình = 1/60 giây (khoảng 17 ms).',
  'Beside each board: SENT = garbage lines sent this round, APM = attack (garbage lines sent) per minute, PPS = pieces placed per second.':
    'Bên cạnh mỗi bảng: ĐÃ GỬI = số hàng rác đã gửi trong hiệp, APM = số hàng tấn công (hàng rác gửi đi) mỗi phút, PPS = số khối đặt mỗi giây.',
  'Defaults': 'Mặc định',
  'Done': 'Xong',
  '{n} frames ({ms} ms)': '{n} khung hình ({ms} ms)',
  '0 (instant)': '0 (tức thì)',
  'instant': 'tức thì',

  // ---- character and skins
  'Character': 'Nhân vật',
  'Block skin': 'Kiểu khối',
  'Board theme': 'Chủ đề bảng',
  "Show the opponent's board in the default skin": 'Hiện bảng của đối thủ bằng kiểu khối mặc định',
  'Sound volume': 'Âm lượng',
  'off': 'tắt',
  'Looks never change how the game plays. Your opponent sees your character and skin online.':
    'Giao diện không ảnh hưởng đến cách chơi. Khi chơi online, đối thủ sẽ thấy nhân vật và kiểu khối của bạn.',
  'Done (Esc)': 'Xong (Esc)',
  'Earned': 'Đã đạt',
  'Locked: {how}': 'Chưa mở: {how}',
  'Beat all 5 bots in the gauntlet': 'Thắng cả 5 máy ở chế độ Vượt ải',
  'Bao the kid': 'Bé Bao',
  'Mochi the cat': 'Mèo Mochi',
  'Bolt the robot': 'Robot Bolt',
  'Pip the frog': 'Ếch Pip',
  'Gem': 'Đá quý',
  'Flat': 'Phẳng',
  'Glossy': 'Bóng',
  'Pixel': 'Pixel',
  'Neon': 'Neon',
  'Candy': 'Kẹo',
  'Stone': 'Đá',
  'Gold': 'Vàng',
  'Night': 'Đêm',
  'Ocean': 'Đại dương',
  'Sakura': 'Hoa anh đào',
  'Paper': 'Giấy',

  // ---- controls screen
  'Click + to add a key, or a key to remove it. Each action can have up to 3 keys. Esc, Enter, Tab and R are kept for the menus.':
    'Bấm + để thêm phím, hoặc bấm vào một phím để xóa. Mỗi thao tác có tối đa 3 phím. Esc, Enter, Tab và R được giữ cho menu.',
  '{actions} has no key yet: it gets its default back when you leave.': '{actions} chưa có phím: sẽ trở về phím mặc định khi bạn thoát.',
  '{actions} have no key yet: they get their default back when you leave.': '{actions} chưa có phím: sẽ trở về phím mặc định khi bạn thoát.',
  'Remove this key': 'Xóa phím này',
  'Add a key': 'Thêm phím',
  'Press a key…': 'Bấm một phím…',

  // ---- tutorial
  'Play the Beginner bot': 'Đấu với máy Mới chơi',
  'Skip the tutorial (Esc)': 'Bỏ qua hướng dẫn (Esc)',
  'All done': 'Hoàn thành',
  'Step {n} of {total}': 'Bước {n}/{total}',
  'Rotate': 'Xoay',
  'Drop': 'Thả',
  'Clear a line': 'Xóa một hàng',
  'Clear four at once': 'Xóa bốn hàng một lúc',
  'Ready for a match': 'Sẵn sàng thi đấu',
  'Move the falling piece left and right with {left} and {right}.': 'Di chuyển khối đang rơi sang trái và phải bằng {left} và {right}.',
  'Turn it clockwise with {cw}, and the other way with {ccw}.': 'Xoay khối theo chiều kim đồng hồ bằng {cw}, và ngược lại bằng {ccw}.',
  'Hold {soft} to drop faster, or press {hard} to drop it all the way at once.': 'Giữ {soft} để khối rơi nhanh hơn, hoặc bấm {hard} để thả thẳng xuống đáy.',
  'Press {hold} to put a piece aside for later. Press it again to swap it back.': 'Bấm {hold} để cất một khối dùng sau. Bấm lần nữa để đổi lại.',
  'Fill the gap on the right to complete the row. Full rows disappear.': 'Lấp khoảng trống bên phải để hoàn thành hàng. Hàng đầy sẽ biến mất.',
  'Clearing 4 rows with one long I piece is a Quad: it sends 4 lines of garbage in a match. Use {hold} to save an I piece if it helps.':
    'Xóa 4 hàng bằng một khối I dài gọi là Quad: trong trận đấu nó gửi 4 hàng rác. Dùng {hold} để cất khối I nếu cần.',
  'In a match, every clear sends garbage to your opponent, and bigger clears, combos and T-spins send more. Your clears cancel garbage coming at you first. Top out and you lose the round.':
    'Trong trận đấu, mỗi lần xóa hàng sẽ gửi hàng rác cho đối thủ; xóa nhiều hàng, combo và T-spin gửi nhiều hơn. Lần xóa của bạn trước hết sẽ triệt tiêu hàng rác đang đến. Chồng khối chạm đỉnh là thua hiệp đó.',
  'TRY AGAIN': 'THỬ LẠI',
  'the gap got covered': 'khoảng trống bị che mất',

  // ---- account and profile
  'Your account': 'Tài khoản của bạn',
  'Name': 'Tên',
  'Password': 'Mật khẩu',
  'Log in': 'Đăng nhập',
  'Create account': 'Tạo tài khoản',
  'Back (Esc)': 'Quay lại (Esc)',
  'An account keeps your rating, match history and handling settings on every device. Ranked play needs one. Names are 3-16 letters or digits; passwords at least 8 characters.':
    'Tài khoản lưu điểm, lịch sử trận đấu và cài đặt phím của bạn trên mọi thiết bị. Chơi xếp hạng cần có tài khoản. Tên gồm 3-16 chữ cái hoặc chữ số; mật khẩu ít nhất 8 ký tự.',
  'Enter a name and a password.': 'Nhập tên và mật khẩu.',
  'Something went wrong. Try again.': 'Đã có lỗi xảy ra. Hãy thử lại.',
  'Log in or create an account to play ranked.': 'Đăng nhập hoặc tạo tài khoản để chơi xếp hạng.',
  'Signed in as ': 'Đã đăng nhập: ',
  ' · rating {rating}': ' · điểm {rating}',
  'Recent matches': 'Trận gần đây',
  'Leaderboard': 'Bảng xếp hạng',
  'Win': 'Thắng',
  'Loss': 'Thua',
  'Void': 'Hủy',
  'vs {name}': 'gặp {name}',
  'Quick': 'Nhanh',
  'Room': 'Phòng',
  'not rated': 'không tính điểm',
  'Replay': 'Xem lại',
  'Download this match as a replay file': 'Tải trận này về dưới dạng tệp xem lại',
  '#{rank} on the leaderboard': 'Hạng #{rank} trên bảng xếp hạng',
  'Not on the leaderboard yet': 'Chưa có trên bảng xếp hạng',
  'Provisional rating: play more ranked matches to settle it': 'Điểm tạm thời: chơi thêm trận xếp hạng để ổn định điểm',
  '{games} ranked match · {wins} won, {losses} lost · {region} · {place}': '{games} trận xếp hạng · thắng {wins}, thua {losses} · {region} · {place}',
  '{games} ranked matches · {wins} won, {losses} lost · {region} · {place}': '{games} trận xếp hạng · thắng {wins}, thua {losses} · {region} · {place}',
  'No online matches yet.': 'Chưa có trận online nào.',
  'Nobody has a settled rating yet.': 'Chưa ai có điểm ổn định.',
  // Messages from the server
  "Can't reach the server. Check your connection and try again.": 'Không kết nối được máy chủ. Kiểm tra kết nối mạng rồi thử lại.',
  'Something went wrong on the server.': 'Máy chủ gặp lỗi.',
  'No player with that name.': 'Không có người chơi nào tên như vậy.',
  'No such match.': 'Không tìm thấy trận đấu.',
  'Please log in again.': 'Vui lòng đăng nhập lại.',
  'Too many attempts. Wait a minute and try again.': 'Thử quá nhiều lần. Đợi một phút rồi thử lại.',
  'Names are 3-16 letters, digits, "_", "-" or ".".': 'Tên gồm 3-16 chữ cái, chữ số, "_", "-" hoặc ".".',
  'Passwords need at least 8 characters.': 'Mật khẩu cần ít nhất 8 ký tự.',
  'That name is taken.': 'Tên này đã có người dùng.',
  'Wrong name or password.': 'Sai tên hoặc mật khẩu.',

  // ---- online
  'Connecting…': 'Đang kết nối…',
  'Cancel (Esc)': 'Hủy (Esc)',
  'Not connected': 'Chưa kết nối',
  'Looking for a ranked opponent…': 'Đang tìm đối thủ xếp hạng…',
  'Looking for an opponent…': 'Đang tìm đối thủ…',
  'Room created': 'Đã tạo phòng',
  'Send this code to a friend. The match starts when they join.': 'Gửi mã này cho bạn bè. Trận đấu bắt đầu khi họ vào phòng.',
  'Quick match pairs you with the next player who joins.': 'Đấu nhanh ghép bạn với người chơi tiếp theo vào hàng chờ.',
  'any region': 'mọi khu vực',
  '1 other player searching': '1 người khác đang tìm trận',
  '{n} other players searching': '{n} người khác đang tìm trận',
  'nobody else searching yet': 'chưa có ai khác đang tìm trận',
  '{clock} · rating {rating} ± {range} · {where} · {others}': '{clock} · điểm {rating} ± {range} · {where} · {others}',
  "{clock} · The server is full ({playing} playing). You're in line: your match starts as soon as a slot opens.":
    '{clock} · Máy chủ đã đầy ({playing} người đang chơi). Bạn đang trong hàng chờ: trận đấu sẽ bắt đầu ngay khi có chỗ trống.',
  'The server is full right now. Try again in a minute, or use Quick match to wait in line.':
    'Máy chủ đang đầy. Hãy thử lại sau một phút, hoặc dùng Đấu nhanh để xếp hàng chờ.',
  'No open room with code {code}.': 'Không có phòng nào đang mở với mã {code}.',
  "Can't reach the match server ({url}). Is it running?": 'Không kết nối được máy chủ trận đấu ({url}). Máy chủ có đang chạy không?',
  'Log in to play ranked.': 'Đăng nhập để chơi xếp hạng.',
  'The match could not start. Try again.': 'Không thể bắt đầu trận đấu. Hãy thử lại.',
  'You joined the queue from another tab.': 'Bạn đã vào hàng chờ từ một tab khác.',
  'Lost the connection to the match server.': 'Mất kết nối với máy chủ trận đấu.',
  'Your opponent left the match.': 'Đối thủ đã rời trận.',
  'You left the match.': 'Bạn đã rời trận.',
  'Your opponent stopped responding.': 'Đối thủ không còn phản hồi.',
  'Your game stopped reaching the server.': 'Trò chơi của bạn không còn kết nối tới máy chủ.',
  "The server rejected your opponent's inputs.": 'Máy chủ đã từ chối thao tác của đối thủ.',
  'The server rejected your inputs.': 'Máy chủ đã từ chối thao tác của bạn.',
  'Connection lost, reconnecting…': 'Mất kết nối, đang kết nối lại…',
  '{name} lost connection, waiting for them…': '{name} bị mất kết nối, đang chờ…',
  'Waiting for the server…': 'Đang chờ máy chủ…',
  'Your opponent has gone.': 'Đối thủ đã rời đi.',
  'Waiting for your opponent to accept…': 'Đang chờ đối thủ đồng ý…',
  '{name} wants a rematch!': '{name} muốn đấu lại!',
  'Rating {before} → {after}': 'Điểm {before} → {after}',

  // ---- results
  'Retry (R)': 'Chơi lại (R)',
  'Menu (Esc)': 'Menu (Esc)',
  'Download replay': 'Tải bản xem lại',
  'New personal best!': 'Kỷ lục cá nhân mới!',
  'Finished': 'Hoàn thành',
  '{pieces} pieces · {pps} pieces per second': '{pieces} khối · {pps} khối mỗi giây',
  ' · best {time}': ' · kỷ lục {time}',
  'Topped out': 'Chạm đỉnh',
  '{lines}/{goal} lines': '{lines}/{goal} hàng',
  'after {time}': 'sau {time}',
  'Player {n} wins!': 'Người chơi {n} thắng!',
  'Last round: P1 sent {a} lines, P2 sent {b} lines': 'Hiệp cuối: P1 gửi {a} hàng, P2 gửi {b} hàng',
  'Rematch (Enter)': 'Đấu lại (Enter)',
  'You beat the {level} bot!': 'Bạn đã thắng máy {level}!',
  'The {level} bot wins': 'Máy {level} thắng',
  'Gauntlet complete: all 5 bots beaten!': 'Hoàn thành Vượt ải: đã thắng cả 5 máy!',
  'Run it again (Enter)': 'Chơi lại từ đầu (Enter)',
  'Bot {n} of 5 beaten!': 'Đã thắng máy {n}/5!',
  'Next: {level} bot (Enter)': 'Tiếp theo: máy {level} (Enter)',
  'Gauntlet over at bot {n} of 5 ({level})': 'Vượt ải dừng ở máy {n}/5 ({level})',
  'Start over (Enter)': 'Bắt đầu lại (Enter)',
  'Last round: you sent {a} lines, the bot sent {b}': 'Hiệp cuối: bạn gửi {a} hàng, máy gửi {b}',
  'You win!': 'Bạn thắng!',
  '{name} wins': '{name} thắng',
  'Play ranked again (Enter)': 'Chơi xếp hạng tiếp (Enter)',

  // ---- in game (drawn on the board)
  'HOLD': 'GIỮ',
  'NEXT': 'TIẾP',
  'TIME': 'THỜI GIAN',
  'LINES': 'HÀNG',
  'PIECES': 'KHỐI',
  'SENT': 'ĐÃ GỬI',
  'APM · ATTACK/MIN': 'APM · TẤN CÔNG/PHÚT',
  'PPS · PIECES/SEC': 'PPS · KHỐI/GIÂY',
  'PLAYER 1': 'NGƯỜI CHƠI 1',
  'PLAYER 2': 'NGƯỜI CHƠI 2',
  'YOU': 'BẠN',
  '{level} BOT': 'MÁY {level}',
  'DRAW': 'HÒA',
  'YOU WIN!': 'BẠN THẮNG!',
  'YOU TAKE THE ROUND': 'BẠN THẮNG HIỆP NÀY',
  'THE BOT WINS': 'MÁY THẮNG',
  'THE BOT TAKES THE ROUND': 'MÁY THẮNG HIỆP NÀY',
  '{name} WINS!': '{name} THẮNG!',
  '{name} WINS': '{name} THẮNG',
  '{name} TAKES THE ROUND': '{name} THẮNG HIỆP NÀY',
  '+{n} SENT': '+{n} ĐÃ GỬI',
  'BLOCKED': 'ĐÃ CHẶN',
  'PERFECT CLEAR': 'XÓA SẠCH BẢNG',
};

const TABLES: Record<Language, Record<string, string>> = { en: {}, vi: VI };

/** The text in the chosen language, with `{name}` filled in from `vars`. */
export function t(english: string, vars: Record<string, string | number> = {}): string {
  const text = TABLES[language][english] ?? english;
  return text.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all));
}

/**
 * Translates the page's own text once at startup: every text node and the
 * placeholder, title and aria-label attributes. Text set later by code goes
 * through t() itself.
 */
export function translatePage(root: HTMLElement = document.body): void {
  document.documentElement.lang = language;
  if (language === 'en') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const raw = node.nodeValue ?? '';
    const text = raw.trim();
    if (text && TABLES[language][text]) node.nodeValue = raw.replace(text, t(text));
  }
  root.querySelectorAll<HTMLElement>('[placeholder], [title], [aria-label]').forEach((el) => {
    for (const attr of ['placeholder', 'title', 'aria-label']) {
      const value = el.getAttribute(attr);
      if (value) el.setAttribute(attr, t(value));
    }
  });
}
