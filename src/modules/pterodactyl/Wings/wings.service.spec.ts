import { Test, TestingModule } from '@nestjs/testing';
import { PterodactylPrismaService } from 'src/core/pterodactyl-prisma.service';
import { WingsService } from './wings.service';

describe('WingsService', () => {
  let service: WingsService;
  const findMany = jest.fn();

  beforeEach(async () => {
    findMany.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WingsService,
        {
          provide: PterodactylPrismaService,
          useValue: { servers: { findMany } },
        },
      ],
    }).compile();
    service = module.get(WingsService);
  });

  it('maps servers to their wing and dedupes the ids', async () => {
    findMany.mockResolvedValue([
      { id: 7, nodes: { id: 1, name: 'wing-fra-1' } },
      { id: 9, nodes: { id: 2, name: 'wing-fra-2' } },
    ]);

    const result = await service.wingsForServers([7, 9, 7, 404]);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [7, 9, 404] } } }),
    );
    expect(result).toEqual({
      7: { id: 1, name: 'wing-fra-1' },
      9: { id: 2, name: 'wing-fra-2' },
    });
  });
});
