import { createEndpoint, createRouter, defineRoom, defineServer } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { BATTLE_ROOM, QUEUE_ROOM } from '@line-battle/engine';
import { Api, apiEndpoint } from './api';
import { BattleRoom } from './BattleRoom';
import { QueueRoom } from './QueueRoom';
import { setStore } from './services';
import { Store } from './store';

// Settings come from environment variables, so the same image runs anywhere.
const port = Number(process.env.PORT ?? 2567);
const host = process.env.HOST ?? '0.0.0.0';
/** Accounts, ratings and match history. In Docker this sits on a volume. */
const dbPath = process.env.DB_PATH ?? 'data/line-battle.db';

const store = new Store(dbPath);
setStore(store);

const server = defineServer({
  rooms: {
    [BATTLE_ROOM]: defineRoom(BattleRoom),
    [QUEUE_ROOM]: defineRoom(QueueRoom),
  },
  routes: createRouter({
    // For Docker and load balancer health checks.
    health: createEndpoint('/health', { method: 'GET' }, async () => 'ok'),
    api: apiEndpoint(new Api(store)),
  }),
  transport: new WebSocketTransport(),
  greet: false,
});

await server.listen(port, host);
console.log(`Line Battle match server listening on ${host}:${port}, data in ${dbPath}`);

// Colyseus shuts down gracefully on SIGTERM and then exits; the database closes last.
process.once('exit', () => store.close());
