declare const entityIdBrand: unique symbol;

export type EntityId<Entity extends string> = string & {
  readonly [entityIdBrand]: Entity;
};

export type OrganizationId = EntityId<"Organization">;
export type PlayerId = EntityId<"Player">;
export type UserId = EntityId<"User">;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createEntityId<Entity extends string>(
  value: string,
): EntityId<Entity> {
  if (!uuidPattern.test(value)) {
    throw new TypeError(`Invalid entity ID: ${value}`);
  }

  return value as EntityId<Entity>;
}
