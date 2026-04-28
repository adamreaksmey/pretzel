import { Logger } from "@nestjs/common";

const serviceName = "ws-service";
const bootstrapMessage = "WebSocket service scaffold is ready";

async function bootstrapWsService(): Promise<void> {
  Logger.log(bootstrapMessage, serviceName);
}

void bootstrapWsService();
