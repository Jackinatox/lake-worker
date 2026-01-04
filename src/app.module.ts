import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BullModule } from '@nestjs/bullmq';
import { PrismaService } from './core/prisma.service';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: '10.1.17.5',
        port: 6379,
      },
      defaultJobOptions: { attempts: 3, delay: 5000 },
    }),
    BullModule.registerQueue({
      name: 'free-provisioning-queue',
    }),
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
