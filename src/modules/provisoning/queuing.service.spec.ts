import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QueueProvisionService } from './queuing.service';

// Mock PrismaService before importing to avoid loading the real Prisma client
jest.mock('../../core/prisma.service', () => ({
  PrismaService: jest.fn().mockImplementation(() => ({
    gameServerOrder: {
      findUnique: jest.fn(),
    },
  })),
}));

import { PrismaService } from '../../core/prisma.service';

describe('ProvisioningService', () => {
  let service: QueueProvisionService;
  let prismaService: PrismaService;
  let mockQueue: Partial<Queue>;

  // Mock data for testing
  const mockOrder = {
    id: 1,
    status: 'PAID',
    creationGameData: { id: 1, name: 'Minecraft' },
    creationLocation: { id: 1, name: 'US-East' },
    user: { id: 1, username: 'testuser' },
  };

  const mockJob = {
    id: 'job-123',
    data: { orderId: 1 },
  };

  beforeEach(async () => {
    // Create mock queue with spy functions
    mockQueue = {
      add: jest.fn().mockResolvedValue(mockJob),
    };

    // Create testing module with mocked dependencies
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueProvisionService,
        {
          provide: PrismaService,
          useValue: {
            gameServerOrder: {
              findUnique: jest.fn(),
            },
          },
        },
        {
          provide: getQueueToken('provisioning'),
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<QueueProvisionService>(QueueProvisionService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createProvisioningJob', () => {
    it('should successfully queue a provisioning job for a PAID order', async () => {
      // Arrange: Set up the mock to return our test order
      jest
        .spyOn(prismaService.gameServerOrder, 'findUnique')
        .mockResolvedValue(mockOrder as any);

      // Act: Call the method we're testing
      const result = await service.createProvisioningJob('1');

      // Assert: Verify the results
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prismaService.gameServerOrder.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: {
          creationGameData: true,
          creationLocation: true,
          user: true,
        },
      });

      expect(mockQueue.add).toHaveBeenCalledWith(
        'provision-server',
        { orderId: 1 },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      );

      expect(result).toEqual({
        success: true,
        message: 'Provisioning job queued',
        jobId: 'job-123',
        orderId: 1,
      });
    });

    it('should throw NotFoundException when order does not exist', async () => {
      // Arrange: Mock findUnique to return null (order not found)
      jest
        .spyOn(prismaService.gameServerOrder, 'findUnique')
        .mockResolvedValue(null);

      // Act & Assert: Expect the method to throw
      await expect(service.createProvisioningJob('999')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.createProvisioningJob('999')).rejects.toThrow(
        'Order with ID 999 not found',
      );
    });

    it('should throw BadRequestException when order status is not PAID', async () => {
      // Arrange: Mock an order with PENDING status
      const pendingOrder = { ...mockOrder, status: 'PENDING' };
      jest
        .spyOn(prismaService.gameServerOrder, 'findUnique')
        .mockResolvedValue(pendingOrder as any);

      // Act & Assert: Expect the method to throw
      await expect(service.createProvisioningJob('1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createProvisioningJob('1')).rejects.toThrow(
        'Order must be in PAID status',
      );
    });
  });
});
