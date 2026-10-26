/**
 * Prints player and match counts from the game database, read-only.
 *
 * It runs inside the server container, which has the database and a Node
 * with node:sqlite. From your own machine, `npm run stats` pipes it there
 * over SSH. On the server itself:
 *
 *   docker exec -i line-battle-server-1 node - < stats.cjs
 *
 * "Active" means a signed-in player whose session was used in that window.
 * Guests don't have accounts, so they only show up in the match counts.
 */
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(process.env.DB_PATH || '/data/line-battle.db', { readOnly: true });
const count = (sql, ...args) => db.prepare(sql).get(...args).n;
const DAY = 24 * 60 * 60 * 1000;
const since = (days) => Date.now() - days * DAY;

const rows = [
  ['Accounts', count('SELECT count(*) n FROM users')],
  ['New accounts, last 24h', count('SELECT count(*) n FROM users WHERE created_at > ?', since(1))],
  ['New accounts, last 7d', count('SELECT count(*) n FROM users WHERE created_at > ?', since(7))],
  ['Active players, last 24h', count('SELECT count(DISTINCT user_id) n FROM sessions WHERE last_seen > ?', since(1))],
  ['Active players, last 7d', count('SELECT count(DISTINCT user_id) n FROM sessions WHERE last_seen > ?', since(7))],
  ['Matches', count('SELECT count(*) n FROM matches')],
  ['Matches, last 24h', count('SELECT count(*) n FROM matches WHERE ended_at > ?', since(1))],
  ['Matches, last 7d', count('SELECT count(*) n FROM matches WHERE ended_at > ?', since(7))],
];
const width = Math.max(...rows.map(([label]) => label.length));
for (const [label, n] of rows) console.log(`${label.padEnd(width)}  ${n}`);

const byMode = db.prepare('SELECT mode, count(*) n FROM matches GROUP BY mode ORDER BY n DESC').all();
if (byMode.length) console.log(`\nMatches by mode: ${byMode.map((r) => `${r.mode} ${r.n}`).join(', ')}`);
const byRegion = db.prepare('SELECT region, count(*) n FROM users GROUP BY region ORDER BY n DESC').all();
if (byRegion.length) console.log(`Accounts by region: ${byRegion.map((r) => `${r.region} ${r.n}`).join(', ')}`);
