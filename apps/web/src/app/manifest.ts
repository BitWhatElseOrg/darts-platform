import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dart Ost - Plattform",
    short_name: "Dart Ost",
    description: "Turniere und Matches zuverlässig vor Ort durchführen.",
    start_url: "/",
    display: "standalone",
    background_color: "#020617",
    theme_color: "#059669",
    lang: "de-CH",
    icons: [
      { src: "/pwa-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/pwa-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
