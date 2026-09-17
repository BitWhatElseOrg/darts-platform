import { avatarTone, playerInitials } from "@/lib/player-avatar";
import { publicEnvironment } from "@/lib/environment";

export interface AvatarPlayer {
  readonly id: string;
  readonly displayName: string;
  readonly avatarChecksum: string | null;
}

/**
 * Das Profilbild eines Spielers, oder die Initialen.
 *
 * `decorative` ist zu setzen, wo der Name daneben steht: eine Vorlesehilfe
 * liest ihn sonst zweimal. Allein stehend trägt das Bild den Namen — das
 * Foto über `alt`, die Initialen-Fläche über `aria-label` (ihr Textknoten
 * "AM" wäre sonst alles, was eine Vorlesehilfe im Lesefluss findet).
 *
 * Die Prüfsumme steht als `?v=` in der Adresse. Der Endpunkt antwortet mit
 * `immutable`, der Browser lädt jedes Bild also genau einmal — und eine
 * Änderung bricht den Cache von selbst, weil sich die Adresse ändert. Diese
 * Zeile ist die einzige Stelle im Code, die die Bildadresse zusammensetzt;
 * niemand darf sie daneben noch einmal von Hand bauen.
 */
export function PlayerAvatar({
  organizationId,
  player,
  size = 40,
  decorative = false,
}: {
  readonly organizationId: string;
  readonly player: AvatarPlayer;
  readonly size?: number;
  readonly decorative?: boolean;
}) {
  const dimension = { width: size, height: size };
  if (player.avatarChecksum === null) {
    return (
      <span
        aria-hidden={decorative ? true : undefined}
        aria-label={decorative ? undefined : player.displayName}
        className="inline-flex shrink-0 items-center justify-center rounded-full font-plate font-semibold text-chalk"
        style={{
          ...dimension,
          backgroundColor: `hsl(${avatarTone(player.id)} 55% 32%)`,
          fontSize: Math.round(size * 0.4),
        }}
        title={decorative ? undefined : player.displayName}
      >
        {playerInitials(player.displayName)}
      </span>
    );
  }
  return (
    <img
      alt={decorative ? "" : player.displayName}
      className="inline-block shrink-0 rounded-full object-cover"
      loading="lazy"
      referrerPolicy="no-referrer"
      src={`${publicEnvironment.NEXT_PUBLIC_API_URL}/organizations/${organizationId}/players/${player.id}/avatar?v=${player.avatarChecksum}`}
      style={dimension}
      {...dimension}
    />
  );
}
