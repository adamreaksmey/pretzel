import { Logger } from "@nestjs/common";

const serviceName = "query-service";
const bootstrapMessage = "Query service scaffold is ready";

async function bootstrapQueryService(): Promise<void> {
  Logger.log(bootstrapMessage, serviceName);
}

void bootstrapQueryService();
