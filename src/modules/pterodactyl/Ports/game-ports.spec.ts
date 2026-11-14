import { ServerOptionsBuilder } from 'src/modules/provisoning/builders/server-options.builder';
import { allocationLimitFor, getGamePortConfig } from './game-ports';

describe('allocationLimitFor', () => {
  it('uses the purchased ports when they cover the game', () => {
    expect(allocationLimitFor(5, 'minecraft')).toBe(5);
    expect(allocationLimitFor(3, 'valheim')).toBe(3);
  });

  it('never goes below what the game needs', () => {
    expect(allocationLimitFor(1, 'satisfactory')).toBe(2);
    expect(allocationLimitFor(0, 'minecraft')).toBe(1);
  });

  it('falls back to one port for unknown games', () => {
    expect(getGamePortConfig('unknown').requiredAllocations).toBe(1);
    expect(allocationLimitFor(0, 'unknown')).toBe(1);
  });
});

describe('ServerOptionsBuilder allocation limit', () => {
  const base = () =>
    new ServerOptionsBuilder()
      .setName('Test')
      .setUser(1)
      .setEgg(1)
      .setDockerImage('image')
      .setLocation(1)
      .setEnvironment({ environment: {}, startup: 'start' })
      .setResources(100, 1024, 2048, 3);

  it('sends the configured allocation limit and backups', () => {
    const options = base().setAllocationLimit(4).build() as unknown as {
      featureLimits: { allocations: number; backups: number };
    };
    expect(options.featureLimits.allocations).toBe(4);
    expect(options.featureLimits.backups).toBe(3);
  });
});
