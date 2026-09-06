/**
 * `trustProxy` als reine Hop-Zahl wird von der in diesem Repository
 * gepinnten Fastify-Version (`^5.12.3`, siehe `infrastructure/railway.md`
 * Abschnitt "Abhaengigkeiten") nicht mehr unterstuetzt: `getTrustProxyFn` in
 * `fastify/lib/request.js` behandelt jede Zahl als "nicht vertrauen" —
 * Kommentar dort: "Hop-count-only trust cannot validate the immediate peer.
 * Fail closed so direct clients cannot spoof X-Forwarded-* values by
 * supplying enough hops." Diese Funktion baut die Hop-Zaehlung deshalb
 * bewusst selbst als `TrustProxyFunction` nach (`(address, hop) => boolean`,
 * von `@fastify/proxy-addr` fuer jede Adresse in der `X-Forwarded-For`-Kette
 * aufgerufen, beginnend bei der direkten Verbindung als Hop 0).
 *
 * Sicherheitsannahme (gehoert in PR-Beschreibung/ADR): die einzige Stelle,
 * die ueberhaupt eine direkte TCP-Verbindung zu diesem Prozess aufbauen
 * kann, ist Railways eigener Reverse Proxy — kein Client erreicht den
 * Container direkt. `TRUST_PROXY_HOPS=1` vertraut deshalb genau dieser
 * einen, durch die Plattform garantierten Zwischenstation und verwendet den
 * ersten `X-Forwarded-For`-Eintrag als Client-Adresse. Ein zu hoher Wert
 * hoehlt genau diese Annahme aus: ein Client koennte dann per gefaelschtem
 * `X-Forwarded-For` eine beliebige Adresse als eigene ausgeben (Audit I-6).
 */
export function resolveTrustProxyOption(
  hops: number,
): false | ((address: string, hop: number) => boolean) {
  if (hops <= 0) {
    return false;
  }

  return (_address: string, hop: number): boolean => hop < hops;
}
