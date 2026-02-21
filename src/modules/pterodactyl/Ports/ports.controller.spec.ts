import { Test, TestingModule } from '@nestjs/testing';
import { PortsController } from './ports.controller';

describe('PortsControllerController', () => {
  let controller: PortsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PortsController],
    }).compile();

    controller = module.get<PortsController>(PortsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
