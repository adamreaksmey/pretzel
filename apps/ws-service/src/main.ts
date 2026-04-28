import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const DEFAULT_WS_PORT = 3001;
const SERVICE_NAME = 'ws-service';

function resolveWsPort(): number {
  const parsedPort = Number.parseInt(process.env.WS_SERVICE_PORT ?? '', 10);
  return Number.isNaN(parsedPort) ? DEFAULT_WS_PORT : parsedPort;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const wsPort = resolveWsPort();
  await app.listen(wsPort);
  Logger.log(`WebSocket service listening on ${wsPort}`, SERVICE_NAME);
}

void bootstrap();
