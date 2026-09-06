import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";

import { parseApplicationEnvironment } from "@darts-platform/config";

import { AppModule } from "./app.module.js";
import { configureApplication } from "./common/configure-application.js";
import { StructuredLogger } from "./common/structured-logger.js";
import { RealtimeService } from "./realtime/realtime.service.js";

async function bootstrap(): Promise<void> {
  const environment = parseApplicationEnvironment(process.env);
  const applicationLogger =
    environment.NODE_ENV === "production"
      ? new StructuredLogger("api", environment.LOG_LEVEL)
      : new Logger("API");
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: applicationLogger },
  );

  app.setGlobalPrefix("api/v1");
  await configureApplication(app, environment);
  app.enableShutdownHooks();

  const port = environment.PORT ?? environment.API_PORT;
  await app.listen(port, "0.0.0.0");
  await app.get(RealtimeService).attach(app.getHttpServer());
  Logger.log(
    {
      event: "api_started",
      port,
      environment: environment.NODE_ENV,
    },
    "Bootstrap",
  );
}

bootstrap().catch((error: unknown) => {
  const logger = new Logger("Bootstrap");
  logger.error("API failed to start", error);
  process.exitCode = 1;
});
