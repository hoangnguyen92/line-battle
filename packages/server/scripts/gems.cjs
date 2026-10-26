/**
 * Gives a player gems (or takes them, with a negative number), for testing
 * the shop and for support. Every change is written to the gem ledger.
 *
 * It runs inside the server container, like stats.cjs. From your own machine:
 *
 *   npm run gems -- <name> <gems> [reason]
 *
 * With only a name, it prints their balance, what they own and recent changes.
 */
const { DatabaseSync } = require('node:sqlite');

const [name, amount, ...why] = process.argv.slice(2);
if (!name) {
  console.error('Usage: npm run gems -- <name> [gems] [reason]');
  process.exit(1);
}
const db = new DatabaseSync(process.env.DB_PATH || '/data/line-battle.db');
db.exec('PRAGMA busy_timeout = 2000;');
const user = db.prepare('SELECT id, name, gems FROM users WHERE name = ? COLLATE NOCASE').get(name);
if (!user) {
  console.error(`No player called ${name}.`);
  process.exit(1);
}

if (amount !== undefined) {
  const delta = Number(amount);
  if (!Number.isInteger(delta)) {
    console.error('Gems must be a whole number, e.g. 500 or -200.');
    process.exit(1);
  }
  db.exec('BEGIN IMMEDIATE');
  const now = db.prepare('SELECT gems FROM users WHERE id = ?').get(user.id).gems;
  const balance = Math.max(0, now + delta);
  db.prepare('UPDATE users SET gems = ? WHERE id = ?').run(balance, user.id);
  db.prepare('INSERT INTO gem_ledger (user_id, delta, balance, reason, ref, at) VALUES (?, ?, ?, ?, NULL, ?)').run(
    user.id, balance - now, balance, `admin: ${why.join(' ') || 'manual'}`, Date.now(),
  );
  db.exec('COMMIT');
}

const gems = db.prepare('SELECT gems FROM users WHERE id = ?').get(user.id).gems;
const owned = db.prepare('SELECT item FROM owned WHERE user_id = ? ORDER BY at').all(user.id).map((r) => r.item);
console.log(`${user.name}: ${gems} gems`);
console.log(`Owns: ${owned.length ? owned.join(', ') : 'nothing bought yet'}`);
for (const r of db.prepare('SELECT * FROM gem_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 10').all(user.id)) {
  console.log(`  ${new Date(r.at).toISOString().slice(0, 16)}  ${r.delta > 0 ? '+' : ''}${r.delta}  = ${r.balance}  ${r.reason}`);
}
