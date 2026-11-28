import RedisMock from 'ioredis-mock';
import { RedisService, redisCacheHits, redisCacheMisses } from './redis.service';

describe('RedisService', () => {
  let client: RedisMock;
  let service: RedisService;

  beforeEach(() => {
    client = new RedisMock();
    service = new RedisService(client as unknown as never);
  });

  afterEach(async () => {
    await client.flushall();
    await client.quit();
  });

  it('sets and gets a typed value with TTL', async () => {
    await service.set('user:1', { id: 1, name: 'Ada' }, 60);
    const value = await service.get<{ id: number; name: string }>('user:1');
    expect(value).toEqual({ id: 1, name: 'Ada' });
    const ttl = await client.ttl('user:1');
    expect(ttl).toBeGreaterThan(0);
  });

  it('returns null and increments miss counter on missing key', async () => {
    const before = (await redisCacheMisses.get()).values[0].value;
    const value = await service.get('missing');
    expect(value).toBeNull();
    const after = (await redisCacheMisses.get()).values[0].value;
    expect(after).toBe(before + 1);
  });

  it('increments hit counter on existing key', async () => {
    await service.set('hit', 'value');
    const before = (await redisCacheHits.get()).values[0].value;
    await service.get('hit');
    const after = (await redisCacheHits.get()).values[0].value;
    expect(after).toBe(before + 1);
  });

  it('deletes keys', async () => {
    await service.set('a', 1);
    await service.set('b', 2);
    const removed = await service.del('a', 'b');
    expect(removed).toBe(2);
  });

  it('publishes and subscribes to a channel', async () => {
    const received: string[] = [];
    await service.subscribe('events', (msg) => received.push(msg));
    await service.publish('events', { hello: 'world' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toContain(JSON.stringify({ hello: 'world' }));
  });
});
