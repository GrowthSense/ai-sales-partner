// Custom Socket.io adapter that uses Redis pub/sub for multi-instance WS fan-out.
// Required when running 3+ NestJS replicas behind a load balancer.
//
// Uses: @socket.io/redis-adapter + ioredis
//
// In main.ts:
//   const redisIoAdapter = new RedisIoAdapter(app);
//   await redisIoAdapter.connectToRedis();
//   app.useWebSocketAdapter(redisIoAdapter);
//
// When instance A streams a token to room 'conversation:<id>',
// Redis pub/sub fans it out to all instances so the visitor's connection
// (which may be on instance B) receives the token.
export class RedisIoAdapter {}
