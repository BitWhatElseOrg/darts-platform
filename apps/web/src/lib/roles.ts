const roleLabels: Readonly<Record<string, string>> = {
  OWNER: "Inhaber",
  ADMIN: "Administration",
  TOURNAMENT_DIRECTOR: "Turnierleitung",
  SCORER: "Scorer",
  MEMBER: "Mitglied",
  VIEWER: "Zuschauer",
};

export function roleLabel(role: string): string {
  return roleLabels[role] ?? role;
}
