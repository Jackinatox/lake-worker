import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { LoggerService } from './core/logger.service';

@Injectable()
export class AppService {
  private packageVersion?: string;

  constructor(private readonly logger: LoggerService) {}

  getHello(): string {
    this.logger.log('getHello endpoint called');
    return 'Hello World!';
  }

  getVersion(): string {
    if (this.packageVersion) {
      return this.packageVersion;
    }

    try {
      const packageJson = JSON.parse(
        readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
      ) as { version?: string };

      if (!packageJson.version) {
        throw new Error('package.json does not contain a version');
      }

      this.packageVersion = packageJson.version;
      return this.packageVersion;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error('Failed to resolve application version', {
        error: message,
      });

      throw new InternalServerErrorException(
        'Unable to resolve application version',
      );
    }
  }
}
