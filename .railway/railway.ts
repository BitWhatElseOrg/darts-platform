import {
  defineRailway,
  github,
  group,
  postgres,
  project,
  redis,
  service,
} from "railway/iac";

export default defineRailway((context) => {
  const database = postgres("postgres");
  const cache = redis("redis");
  const source = github("BitWhatElse/darts-platform", { branch: "main" });

  const api = service("api", {
    source,
    healthcheck: "/api/v1/health",
    healthcheckTimeout: 120,
    replicas: 1,
    domains: ["api.dartbase.ch"],
    env: {
      NODE_ENV: "production",
      LOG_LEVEL: "log",
      RAILWAY_DOCKERFILE_PATH: "/Dockerfile.api",
      DATABASE_URL: database.env.DATABASE_URL,
      REDIS_URL: cache.env.REDIS_URL,
      BETTER_AUTH_SECRET: context.shared.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: context.shared.BETTER_AUTH_URL,
      WEB_ORIGIN: context.shared.WEB_ORIGIN,
    },
  });

  const web = service("web", {
    source,
    healthcheck: "/",
    healthcheckTimeout: 120,
    replicas: 1,
    domains: ["app.dartbase.ch"],
    env: {
      NODE_ENV: "production",
      RAILWAY_DOCKERFILE_PATH: "/Dockerfile.web",
      NEXT_PUBLIC_API_URL: context.shared.NEXT_PUBLIC_API_URL,
    },
  });

  const worker = service("worker", {
    source,
    replicas: 1,
    env: {
      NODE_ENV: "production",
      LOG_LEVEL: "log",
      RAILWAY_DOCKERFILE_PATH: "/Dockerfile.worker",
      DATABASE_URL: database.env.DATABASE_URL,
      REDIS_URL: cache.env.REDIS_URL,
      BETTER_AUTH_SECRET: context.shared.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: context.shared.BETTER_AUTH_URL,
    },
  });

  return project("darts-platform", {
    resources: [
      group("Applications", [web, api, worker]),
      group("Data", [database, cache]),
    ],
  });
});
