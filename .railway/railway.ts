import {
  defineRailway,
  github,
  group,
  postgres,
  project,
  redis,
  service,
} from "railway/iac";

// Beide Ports stehen bewusst fest auf 8080, statt sich auf Railways
// Vorgabewert zu verlassen:
// - Das SDK bildet eine als String angegebene Domain fest auf Zielport 8080
//   ab (railway/dist/iac/index.js, normalizeNetworking). Eine portlose
//   Variante existiert nicht.
// - `next start --port ...` (apps/web/package.json) hat Vorrang vor der
//   Umgebungsvariable PORT, die Railway injiziert. Ohne explizites WEB_PORT
//   bliebe der Web-Container für immer auf 3000, während die Domain auf 8080
//   routet -> 502 "Application failed to respond".
// Beide Services erhalten deshalb denselben Zielport in Env und Domain, statt
// sich auf Railways von-sich-aus injizierten Wert zu verlassen.
export default defineRailway((context) => {
  const database = postgres("postgres");
  const cache = redis("redis");
  const source = github("BitWhatElse/darts-platform", { branch: "main" });

  const api = service("api", {
    source,
    healthcheck: "/api/v1/health",
    healthcheckTimeout: 120,
    replicas: 1,
    domains: [{ domain: "api.dartbase.ch", port: 8080 }],
    env: {
      NODE_ENV: "production",
      LOG_LEVEL: "log",
      RAILWAY_DOCKERFILE_PATH: "/Dockerfile.api",
      PORT: "8080",
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
    domains: [{ domain: "app.dartbase.ch", port: 8080 }],
    env: {
      NODE_ENV: "production",
      RAILWAY_DOCKERFILE_PATH: "/Dockerfile.web",
      WEB_PORT: "8080",
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
