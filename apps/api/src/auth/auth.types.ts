export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

export interface AuthenticatedSession {
  readonly id: string;
  readonly expiresAt: Date;
}

export interface AuthContext {
  readonly user: AuthenticatedUser;
  readonly session: AuthenticatedSession;
}

declare module "fastify" {
  interface FastifyRequest {
    authContext?: AuthContext;
  }
}
