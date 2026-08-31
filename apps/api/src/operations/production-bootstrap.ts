import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";

import {
  accounts,
  auditEvents,
  memberships,
  organizationInvitations,
  organizations,
  sessions,
  users,
  type Database,
  type Membership,
  type Organization,
  type OrganizationInvitation,
  type User,
} from "@darts-platform/database";
import { createOrganizationSchema } from "@darts-platform/schemas";

export const PRODUCTION_BOOTSTRAP_USER_EMAIL =
  "production-bootstrap@system.dartbase.invalid";

export interface ProductionBootstrapInput {
  readonly ownerEmail: string;
  readonly organizationName: string;
  readonly organizationSlug: string;
  readonly timezone: string;
  readonly locale: string;
}

export interface ProductionBootstrapResult {
  readonly status: "created" | "pending" | "already-complete";
  readonly organizationId: string;
  readonly organizationSlug: string;
  readonly ownerEmail: string;
  readonly expiresAt: Date | null;
}

export type ProductionBootstrapErrorCode =
  | "BOOTSTRAP_ALREADY_INITIALIZED"
  | "BOOTSTRAP_STATE_INVALID";

export class ProductionBootstrapError extends Error {
  public constructor(
    public readonly code: ProductionBootstrapErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "ProductionBootstrapError";
  }
}

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

const productionBootstrapEnvironmentSchema = z.object({
  BOOTSTRAP_OWNER_EMAIL: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email())
    .refine((email) => email !== PRODUCTION_BOOTSTRAP_USER_EMAIL, {
      message: "The owner email is reserved for the bootstrap system principal.",
    }),
  BOOTSTRAP_ORGANIZATION_NAME: createOrganizationSchema.shape.name,
  BOOTSTRAP_ORGANIZATION_SLUG: createOrganizationSchema.shape.slug,
  BOOTSTRAP_TIMEZONE: createOrganizationSchema.shape.timezone,
  BOOTSTRAP_LOCALE: createOrganizationSchema.shape.locale,
});

export function parseProductionBootstrapInput(
  environment: EnvironmentSource,
): ProductionBootstrapInput {
  const parsed = productionBootstrapEnvironmentSchema.parse(environment);

  return {
    ownerEmail: parsed.BOOTSTRAP_OWNER_EMAIL,
    organizationName: parsed.BOOTSTRAP_ORGANIZATION_NAME,
    organizationSlug: parsed.BOOTSTRAP_ORGANIZATION_SLUG,
    timezone: parsed.BOOTSTRAP_TIMEZONE,
    locale: parsed.BOOTSTRAP_LOCALE,
  };
}

export function assertProductionBootstrapAllowed(input: {
  readonly nodeEnv: string;
  readonly allowProduction: boolean;
}): void {
  if (input.nodeEnv !== "production" || input.allowProduction !== true) {
    throw new Error(
      "Production bootstrap requires NODE_ENV=production and ALLOW_PRODUCTION_BOOTSTRAP=true.",
    );
  }
}

const PRODUCTION_BOOTSTRAP_USER_DISPLAY_NAME =
  "Dartbase Production Bootstrap";
const INVITATION_LIFETIME_MS = 48 * 60 * 60 * 1_000;

interface BootstrapState {
  readonly users: readonly User[];
  readonly organizations: readonly Organization[];
  readonly memberships: readonly Membership[];
  readonly invitations: readonly OrganizationInvitation[];
  readonly accountUserIds: readonly { readonly userId: string }[];
  readonly sessionUserIds: readonly { readonly userId: string }[];
}

function invalidState(message: string): never {
  throw new ProductionBootstrapError("BOOTSTRAP_STATE_INVALID", message);
}

function assertExactOrganization(
  organization: Organization,
  input: ProductionBootstrapInput,
): void {
  if (
    organization.name !== input.organizationName ||
    organization.slug !== input.organizationSlug ||
    organization.timezone !== input.timezone ||
    organization.locale !== input.locale
  ) {
    invalidState("The existing organization does not exactly match the request.");
  }
}

function assertExactSystemPrincipal(
  bootstrapUser: User,
  state: BootstrapState,
): void {
  if (
    bootstrapUser.displayName !== PRODUCTION_BOOTSTRAP_USER_DISPLAY_NAME ||
    bootstrapUser.emailVerified ||
    bootstrapUser.image !== null
  ) {
    invalidState("The bootstrap system principal has unexpected identity data.");
  }

  if (
    state.accountUserIds.some((account) => account.userId === bootstrapUser.id) ||
    state.sessionUserIds.some((session) => session.userId === bootstrapUser.id) ||
    state.memberships.some(
      (membership) => membership.userId === bootstrapUser.id,
    )
  ) {
    invalidState("The bootstrap system principal is not a non-login principal.");
  }
}

function assertOnlyBootstrapUsers(
  state: BootstrapState,
  input: ProductionBootstrapInput,
): void {
  if (
    state.users.some(
      (user) =>
        user.email !== PRODUCTION_BOOTSTRAP_USER_EMAIL &&
        user.email !== input.ownerEmail,
    )
  ) {
    invalidState("An unexpected user identity already exists.");
  }
}

function assertExactInvitationIdentity(
  invitations: readonly OrganizationInvitation[],
  input: ProductionBootstrapInput,
  organizationId: string,
  bootstrapUserId: string,
): void {
  if (
    invitations.some(
      (invitation) =>
        invitation.organizationId !== organizationId ||
        invitation.email !== input.ownerEmail ||
        invitation.role !== "OWNER" ||
        invitation.invitedByUserId !== bootstrapUserId,
    )
  ) {
    invalidState("An invitation does not match the bootstrap identity.");
  }
}

function assertCompletedInvitationState(
  invitations: readonly OrganizationInvitation[],
): void {
  const accepted = invitations.filter(
    (invitation) => invitation.status === "ACCEPTED",
  );
  const invalid = invitations.filter(
    (invitation) =>
      invitation.status !== "ACCEPTED" && invitation.status !== "EXPIRED",
  );

  if (accepted.length !== 1 || invalid.length > 0) {
    invalidState(
      "Completed bootstrap requires exactly one accepted invitation and only expired history.",
    );
  }
}

function pendingInvitationFrom(
  invitations: readonly OrganizationInvitation[],
): OrganizationInvitation | undefined {
  const pending = invitations.filter(
    (invitation) => invitation.status === "PENDING",
  );
  const invalid = invitations.filter(
    (invitation) =>
      invitation.status !== "PENDING" && invitation.status !== "EXPIRED",
  );

  if (pending.length > 1 || invalid.length > 0) {
    invalidState(
      "Pending bootstrap permits at most one pending invitation and only expired history.",
    );
  }

  return pending[0];
}

function matchingOrganization(
  state: BootstrapState,
  input: ProductionBootstrapInput,
): Organization | undefined {
  if (state.organizations.length > 1) {
    invalidState("More than one organization already exists.");
  }

  const organization = state.organizations[0];
  if (organization !== undefined) {
    assertExactOrganization(organization, input);
  }
  return organization;
}

function exactOwnerMembership(input: {
  readonly state: BootstrapState;
  readonly ownerUser: User | undefined;
  readonly organization: Organization | undefined;
}): Membership | undefined {
  if (input.ownerUser === undefined || input.organization === undefined) {
    return undefined;
  }

  return input.state.memberships.find(
    (membership) =>
      membership.userId === input.ownerUser?.id &&
      membership.organizationId === input.organization?.id &&
      membership.role === "OWNER" &&
      membership.status === "ACTIVE",
  );
}

export async function bootstrapProductionOwner(
  database: Database,
  input: ProductionBootstrapInput,
  now = new Date(),
): Promise<ProductionBootstrapResult> {
  if (input.ownerEmail === PRODUCTION_BOOTSTRAP_USER_EMAIL) {
    invalidState("The owner email is reserved for the bootstrap system principal.");
  }

  return database.transaction(async (transaction) => {
    await transaction.execute(sql`
      select pg_advisory_xact_lock(hashtextextended('dartbase:production-bootstrap', 0))
    `);

    const state: BootstrapState = {
      users: await transaction.select().from(users),
      organizations: await transaction.select().from(organizations),
      memberships: await transaction.select().from(memberships),
      invitations: await transaction.select().from(organizationInvitations),
      accountUserIds: await transaction
        .select({ userId: accounts.userId })
        .from(accounts),
      sessionUserIds: await transaction
        .select({ userId: sessions.userId })
        .from(sessions),
    };

    const bootstrapUser = state.users.find(
      (user) => user.email === PRODUCTION_BOOTSTRAP_USER_EMAIL,
    );
    const ownerUser = state.users.find(
      (user) => user.email === input.ownerEmail,
    );
    const organization = state.organizations.find(
      (candidate) => candidate.slug === input.organizationSlug,
    );
    const ownerMembership = exactOwnerMembership({
      state,
      ownerUser,
      organization,
    });

    if (ownerMembership !== undefined) {
      if (bootstrapUser === undefined || organization === undefined) {
        invalidState("The completed bootstrap identity is incomplete.");
      }
      assertExactOrganization(organization, input);
      assertExactSystemPrincipal(bootstrapUser, state);
      assertExactInvitationIdentity(
        state.invitations,
        input,
        organization.id,
        bootstrapUser.id,
      );
      assertCompletedInvitationState(state.invitations);

      return {
        status: "already-complete",
        organizationId: organization.id,
        organizationSlug: organization.slug,
        ownerEmail: input.ownerEmail,
        expiresAt: null,
      };
    }

    if (
      state.memberships.some((membership) => membership.status === "ACTIVE")
    ) {
      throw new ProductionBootstrapError(
        "BOOTSTRAP_ALREADY_INITIALIZED",
        "An active membership already exists.",
      );
    }

    if (state.memberships.length > 0) {
      invalidState("A non-active membership is not a resumable bootstrap state.");
    }

    assertOnlyBootstrapUsers(state, input);
    if (bootstrapUser !== undefined) {
      assertExactSystemPrincipal(bootstrapUser, state);
    }
    const exactOrganization = matchingOrganization(state, input);

    if (state.invitations.length > 0) {
      if (bootstrapUser === undefined || exactOrganization === undefined) {
        invalidState("An invitation exists without the exact bootstrap identity.");
      }
      assertExactInvitationIdentity(
        state.invitations,
        input,
        exactOrganization.id,
        bootstrapUser.id,
      );
    }
    const pendingInvitation = pendingInvitationFrom(state.invitations);

    if (
      pendingInvitation !== undefined &&
      pendingInvitation.expiresAt.getTime() > now.getTime()
    ) {
      if (exactOrganization === undefined) {
        invalidState("The pending invitation has no exact organization.");
      }
      return {
        status: "pending",
        organizationId: exactOrganization.id,
        organizationSlug: exactOrganization.slug,
        ownerEmail: input.ownerEmail,
        expiresAt: pendingInvitation.expiresAt,
      };
    }

    let ensuredBootstrapUser = bootstrapUser;
    if (ensuredBootstrapUser === undefined) {
      [ensuredBootstrapUser] = await transaction
        .insert(users)
        .values({
          email: PRODUCTION_BOOTSTRAP_USER_EMAIL,
          displayName: PRODUCTION_BOOTSTRAP_USER_DISPLAY_NAME,
          emailVerified: false,
          image: null,
        })
        .returning();
    }
    if (ensuredBootstrapUser === undefined) {
      throw new Error("Bootstrap system principal insert returned no row.");
    }

    let ensuredOrganization = exactOrganization;
    if (ensuredOrganization === undefined) {
      [ensuredOrganization] = await transaction
        .insert(organizations)
        .values({
          name: input.organizationName,
          slug: input.organizationSlug,
          timezone: input.timezone,
          locale: input.locale,
        })
        .returning();
    }
    if (ensuredOrganization === undefined) {
      throw new Error("Bootstrap organization insert returned no row.");
    }

    if (pendingInvitation !== undefined) {
      await transaction
        .update(organizationInvitations)
        .set({ status: "EXPIRED", updatedAt: now })
        .where(sql`${organizationInvitations.id} = ${pendingInvitation.id}`);
    }

    const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS);
    const [invitation] = await transaction
      .insert(organizationInvitations)
      .values({
        organizationId: ensuredOrganization.id,
        email: input.ownerEmail,
        role: "OWNER",
        status: "PENDING",
        invitedByUserId: ensuredBootstrapUser.id,
        expiresAt,
      })
      .returning();
    if (invitation === undefined) {
      throw new Error("Bootstrap invitation insert returned no row.");
    }

    await transaction.insert(auditEvents).values({
      organizationId: ensuredOrganization.id,
      actorUserId: ensuredBootstrapUser.id,
      action: "PRODUCTION_BOOTSTRAP_INVITATION_CREATED",
      entityType: "OrganizationInvitation",
      entityId: invitation.id,
      newValue: {
        email: input.ownerEmail,
        role: "OWNER",
        expiresAt: invitation.expiresAt,
      },
      ip: "127.0.0.1",
      userAgent: "production-bootstrap-cli",
      correlationId: randomUUID(),
    });

    return {
      status: "created",
      organizationId: ensuredOrganization.id,
      organizationSlug: ensuredOrganization.slug,
      ownerEmail: input.ownerEmail,
      expiresAt: invitation.expiresAt,
    };
  });
}
