import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global() // Makes PrismaService available everywhere without importing CoreModule
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class CoreModule {}
