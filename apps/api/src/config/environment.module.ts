import { Global, Module } from "@nestjs/common";

import { parseApplicationEnvironment } from "@darts-platform/config";

export const APPLICATION_ENVIRONMENT = Symbol("APPLICATION_ENVIRONMENT");

@Global()
@Module({
  providers: [
    {
      provide: APPLICATION_ENVIRONMENT,
      useFactory: () => parseApplicationEnvironment(process.env),
    },
  ],
  exports: [APPLICATION_ENVIRONMENT],
})
export class EnvironmentModule {}
