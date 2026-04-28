import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AppService } from '../src/app.service';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  const appServiceMock = {
    getPresence: jest.fn(),
    getPresenceBatch: jest.fn(),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AppService)
      .useValue(appServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    jest.clearAllMocks();
  });

  it('/presence/:userId (GET)', () => {
    appServiceMock.getPresence.mockResolvedValue({
      userId: 'user-1',
      status: 'online',
      last_seen: null,
    });

    return request(app.getHttpServer())
      .get('/presence/user-1')
      .set('x-tenant-id', 'tenant-a')
      .expect(200)
      .expect({
        userId: 'user-1',
        status: 'online',
        last_seen: null,
      });
  });

  it('/presence/batch (POST)', () => {
    appServiceMock.getPresenceBatch.mockResolvedValue([
      { userId: 'user-1', status: 'online', last_seen: null },
    ]);

    return request(app.getHttpServer())
      .post('/presence/batch')
      .set('x-api-key', 'tenant:tenant-a')
      .send({ userIds: ['user-1'] })
      .expect(201)
      .expect([{ userId: 'user-1', status: 'online', last_seen: null }]);
  });

  afterEach(async () => {
    await app.close();
  });
});
