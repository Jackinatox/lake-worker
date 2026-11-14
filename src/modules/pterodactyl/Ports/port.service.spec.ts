import { Test, TestingModule } from '@nestjs/testing';
import { PterodactylPrismaService } from 'src/core/pterodactyl-prisma.service';
import { loggingTestProviders } from 'src/core/testing/logging.testing';
import { PterodactylPortService } from './port.service';

describe('PterodactylPortService', () => {
  let service: PterodactylPortService;
  const findUnique = jest.fn();
  const fetchMock = jest.fn();

  beforeEach(async () => {
    findUnique.mockReset();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PterodactylPortService,
        {
          provide: PterodactylPrismaService,
          useValue: { servers: { findUnique } },
        },
        ...loggingTestProviders,
      ],
    }).compile();

    service = module.get<PterodactylPortService>(PterodactylPortService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('ensureAllocationLimit', () => {
    const panelServer = {
      id: 42,
      allocation_id: 7,
      memory: 4096,
      swap: 512,
      disk: 10240,
      io: 500,
      cpu: 200,
      threads: null,
      oom_disabled: 1,
      allocation_limit: 1,
      database_limit: 0,
      backup_limit: 3,
    };

    it('raises a limit below the minimum and keeps the rest of the build', async () => {
      findUnique.mockResolvedValue(panelServer);
      fetchMock.mockResolvedValue({ ok: true });

      await service.ensureAllocationLimit('abcd1234', 2);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toMatch(/\/api\/application\/servers\/42\/build$/);
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(init.body as string)).toEqual({
        allocation: 7,
        memory: 4096,
        swap: 512,
        disk: 10240,
        io: 500,
        cpu: 200,
        threads: null,
        oom_disabled: true,
        feature_limits: { allocations: 2, databases: 0, backups: 3 },
      });
    });

    it('never lowers a limit', async () => {
      findUnique.mockResolvedValue({ ...panelServer, allocation_limit: 5 });
      await service.ensureAllocationLimit('abcd1234', 2);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('leaves an unlimited (null) limit alone', async () => {
      findUnique.mockResolvedValue({ ...panelServer, allocation_limit: null });
      await service.ensureAllocationLimit('abcd1234', 2);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws when the panel rejects the change', async () => {
      findUnique.mockResolvedValue(panelServer);
      fetchMock.mockResolvedValue({
        ok: false,
        status: 422,
        statusText: 'Unprocessable',
        text: () => Promise.resolve('bad'),
      });
      await expect(
        service.ensureAllocationLimit('abcd1234', 2),
      ).rejects.toThrow(/Failed to raise allocation limit/);
    });
  });
});
