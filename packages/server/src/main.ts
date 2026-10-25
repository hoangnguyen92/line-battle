import { createEndpoint, createRouter, defineRoom, defineServer } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { BATTLE_ROOM } from '@line-battle/engine';
import { BattleRoom } from './BattleRoom';

// Settings come from environment variables, so the same image runs anywhere.
const port = Number(process.env.PORT ?? 2567);
const host = process.env.HOST ?? '0.0.0.0';

const server = defineServer({
  rooms: { [BATTLE_ROOM]: defineRoom(BattleRoom).filterBy(['mode']) },
  // For Docker and load balancer health checks.
  routes: createRouter({ health: createEndpoint('/health', { method: 'GET' }, async () => 'ok') }),
  transport: new WebSocketTransport(),
  greet: false,
});

await server.listen(port, host);
console.log(`Line Battle match server listening on ${host}:${port}`);
