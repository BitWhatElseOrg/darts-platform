import { describe, expect, it } from "vitest";

import { escapeHtml } from "./html.js";

describe("escapeHtml", () => {
  it("entschaerft die fuenf HTML-Sonderzeichen", () => {
    expect(escapeHtml(`<b>"Tom" & 'Jerry'</b>`)).toBe(
      "&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;",
    );
  });

  it("laesst normalen Text unveraendert", () => {
    expect(escapeHtml("Beispielverein Zürich")).toBe("Beispielverein Zürich");
  });
});
