import {
  defineRailway,
  github,
  postgres,
  preserve,
  project,
  redis,
  service,
  volume,
} from "railway/iac";

const repository = "BitWhatElseOrg/darts-platform";
const region = "europe-west4-drams3a";

export default defineRailway(() => {
  const source = github(repository, { branch: "main", checkSuites: true });
  const database = postgres("Postgres", { region });
  const cache = redis("Redis", { region });
  cache.deploy = {
    startCommand:
      '/bin/sh -c "rm -rf $RAILWAY_VOLUME_MOUNT_PATH/lost+found/ && exec docker-entrypoint.sh redis-server --requirepass $REDIS_PASSWORD --save 60 1 --dir $RAILWAY_VOLUME_MOUNT_PATH"',
  };

  const databaseVolume = volume("postgres-volume", {
    alerts: { usage: { "80": {}, "95": {}, "100": {} } },
    allowOnlineResize: true,
    region,
    sizeMB: 5000,
  });
  const cacheVolume = volume("redis-volume", {
    alerts: { usage: { "80": {}, "95": {}, "100": {} } },
    allowOnlineResize: true,
    region,
    sizeMB: 5000,
  });

  const api = service("@darts-platform/api", {
    source,
    build: {
      buildCommand: "pnpm build:api",
      buildEnvironment: "V3",
      builder: "RAILPACK",
      watchPatterns: [
        "/apps/api/**",
        "/packages/config/**",
        "/packages/database/**",
        "/packages/domain/**",
        "/packages/league-engine/**",
        "/packages/scheduling-engine/**",
        "/packages/schemas/**",
        "/packages/scoring-engine/**",
        "/packages/statistics/**",
        "/packages/tournament-engine/**",
        "/scripts/start-api.mjs",
        "/package.json",
        "/pnpm-lock.yaml",
        "/pnpm-workspace.yaml",
        "/tsconfig.base.json",
        "/turbo.json",
      ],
    },
    start: "pnpm start:api:deploy",
    healthcheck: "/api/v1/health",
    healthcheckTimeout: 120,
    replicas: { [region]: 1 },
    deploy: { restartPolicyMaxRetries: 3 },
    domains: [{ domain: "api.dartbase.ch", port: 3001 }],
    networking: { privateNetworkEndpoint: "darts-platformapi" },
    env: {
      API_PORT: preserve(),
      BETTER_AUTH_SECRET: preserve(),
      BETTER_AUTH_URL: preserve(),
      DATABASE_URL: preserve(),
      LOG_LEVEL: preserve(),
      NODE_ENV: preserve(),
      PORT: preserve(),
      REDIS_URL: preserve(),
      WEB_ADDITIONAL_ORIGINS: preserve(),
      WEB_ORIGIN: preserve(),
    },
  });

  const worker = service("@darts-platform/worker", {
    source,
    build: {
      buildCommand: "pnpm build:worker",
      buildEnvironment: "V3",
      builder: "RAILPACK",
      watchPatterns: [
        "/apps/worker/**",
        "/packages/config/**",
        "/packages/database/**",
        "/packages/statistics/**",
        "/package.json",
        "/pnpm-lock.yaml",
        "/pnpm-workspace.yaml",
        "/tsconfig.base.json",
        "/turbo.json",
      ],
    },
    start: "pnpm start:worker:deploy",
    replicas: { [region]: 1 },
    deploy: { restartPolicyMaxRetries: 3 },
    networking: { privateNetworkEndpoint: "darts-platformworker" },
    env: {
      BETTER_AUTH_SECRET: preserve(),
      BETTER_AUTH_URL: preserve(),
      DATABASE_URL: preserve(),
      LOG_LEVEL: preserve(),
      NODE_ENV: preserve(),
      REDIS_URL: preserve(),
      WEB_ORIGIN: preserve(),
    },
  });

  const web = service("@darts-platform/web", {
    source,
    build: {
      buildCommand: "pnpm build:web",
      buildEnvironment: "V3",
      builder: "RAILPACK",
      watchPatterns: [
        "/apps/web/**",
        "/packages/config/**",
        "/packages/database/**",
        "/packages/domain/**",
        "/packages/schemas/**",
        "/packages/ui/**",
        "/package.json",
        "/pnpm-lock.yaml",
        "/pnpm-workspace.yaml",
        "/tsconfig.base.json",
        "/turbo.json",
      ],
    },
    start: "pnpm start:web:deploy",
    healthcheck: "/",
    healthcheckTimeout: 120,
    replicas: { [region]: 1 },
    domains: ["*.dartbase.ch", "dartbase.ch"],
    networking: { privateNetworkEndpoint: "darts-platformweb" },
    env: {
      NEXT_PUBLIC_API_URL: preserve(),
      NODE_ENV: preserve(),
      PORT: preserve(),
      WEB_ORIGIN: preserve(),
      WEB_PORT: preserve(),
    },
  });

  return project("dartbase", {
    resources: [api, worker, web, cache, database, databaseVolume, cacheVolume],
  });
});
