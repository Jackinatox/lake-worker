import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CoreModule } from './core/core.module';
import { ProvisioningModule } from './modules/provisoning/provisioning.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    CoreModule,
    BullModule.forRoot({
      connection: {
        host: '10.1.17.5',
        port: 6379,
      },
      defaultJobOptions: { attempts: 3, delay: 5000 },
    }),
    ProvisioningModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
