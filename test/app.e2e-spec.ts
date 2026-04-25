import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import { AppController } from './../src/app.controller';
import { AppService } from './../src/app.service';
import request from 'supertest';
import { App } from 'supertest/types';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  const appService = {
    getHello: jest.fn(() => 'Hello World!'),
    getVersion: jest.fn(() => '1.8.0'),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: appService }],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({
      defaultVersion: '1',
      type: VersioningType.URI,
    });
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/v1/version (GET)', () => {
    return request(app.getHttpServer())
      .get('/v1/version')
      .expect(200)
      .expect({ version: '1.8.0' });
  });
});
