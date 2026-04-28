import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;
  const appServiceMock = {
    getPresence: jest.fn(),
    getPresenceBatch: jest.fn(),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: appServiceMock }],
    }).compile();

    appController = app.get<AppController>(AppController);
    jest.clearAllMocks();
  });

  it('returns presence using tenant header', async () => {
    const expectedPresence = {
      userId: 'alice',
      status: 'online',
      last_seen: null,
    };
    appServiceMock.getPresence.mockResolvedValue(expectedPresence);

    const response = await appController.getPresence(
      'tenant-a',
      undefined,
      'alice',
    );

    expect(appServiceMock.getPresence).toHaveBeenCalledWith(
      'tenant-a',
      'alice',
    );
    expect(response).toEqual(expectedPresence);
  });

  it('returns batch presence using api key fallback', async () => {
    const expectedPresence = [
      { userId: 'alice', status: 'online', last_seen: null },
      { userId: 'bob', status: 'offline', last_seen: null },
    ];
    appServiceMock.getPresenceBatch.mockResolvedValue(expectedPresence);

    const response = await appController.getPresenceBatch(
      undefined,
      'tenant:dev',
      {
        userIds: ['alice', 'bob'],
      },
    );

    expect(appServiceMock.getPresenceBatch).toHaveBeenCalledWith('dev', [
      'alice',
      'bob',
    ]);
    expect(response).toEqual(expectedPresence);
  });
});
