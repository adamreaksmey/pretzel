import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import type { AuthenticatedRequest } from './auth/authenticated-request';
import { PresenceService } from './app.service';

describe('AppController', () => {
  let appController: AppController;
  const appServiceMock = {
    getPresence: jest.fn(),
    getPresenceBatch: jest.fn(),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: PresenceService, useValue: appServiceMock }],
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

    const request = { tenantId: 'tenant-a' } as AuthenticatedRequest;
    const response = await appController.getPresence(request, 'alice');

    expect(appServiceMock.getPresence).toHaveBeenCalledWith(
      'tenant-a',
      'alice',
    );
    expect(response).toEqual(expectedPresence);
  });

  it('returns batch presence using resolved tenant context', async () => {
    const expectedPresence = [
      { userId: 'alice', status: 'online', last_seen: null },
      { userId: 'bob', status: 'offline', last_seen: null },
    ];
    appServiceMock.getPresenceBatch.mockResolvedValue(expectedPresence);

    const request = { tenantId: 'dev' } as AuthenticatedRequest;
    const response = await appController.getPresenceBatch(request, {
      userIds: ['alice', 'bob'],
    });

    expect(appServiceMock.getPresenceBatch).toHaveBeenCalledWith('dev', [
      'alice',
      'bob',
    ]);
    expect(response).toEqual(expectedPresence);
  });
});
