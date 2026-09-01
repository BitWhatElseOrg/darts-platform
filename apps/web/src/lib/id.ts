/**
 * `crypto.randomUUID()` is only exposed in secure contexts (HTTPS, or
 * http://localhost). Board devices are frequently reached over plain HTTP on
 * a local network (e.g. `http://192.168.x.x:3000`), which is not a secure
 * context, so `crypto.randomUUID` is undefined there and throws
 * `crypto.randomUUID is not a function`.
 *
 * `crypto.getRandomValues()` has no such restriction, so it is used as the
 * primary fallback to build an RFC 4122 v4 UUID. Score-/Match-Commands rely
 * on this id for idempotency (AGENTS.md §11), so it must never fail.
 */
export function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  }
  // Defensive last resort; not cryptographically strong, but never reached in
  // any modern browser (getRandomValues has been universally supported since
  // well before crypto.randomUUID existed).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = (Math.random() * 16) | 0;
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
