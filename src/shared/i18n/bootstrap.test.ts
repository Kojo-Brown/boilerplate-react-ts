import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { resolveI18n } from "@/shared/i18n/bootstrap";
import { writeStoredLocale } from "@/shared/i18n/localePreference";
import { DEFAULT_CATALOG } from "@/shared/i18n/messages";
import { AR_EG_MESSAGES } from "@/shared/i18n/messages/ar-EG";

describe("resolveI18n", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("negotiates from the browser's list when nothing is stored", async () => {
    await expect(resolveI18n({ preferred: ["ar"] })).resolves.toEqual({
      locale: "ar-EG",
      messages: AR_EG_MESSAGES,
    });
  });

  it("returns the default catalogue by reference for the default locale", async () => {
    // Not merely equal: the default catalogue is statically linked, and a copy
    // would mean the fallback had been fetched after all.
    const { locale, messages } = await resolveI18n({ preferred: ["en-GB"] });
    expect(locale).toBe("en-GB");
    expect(messages).toBe(DEFAULT_CATALOG);
  });

  it("falls back when the browser offers nothing we ship", async () => {
    await expect(resolveI18n({ preferred: ["fr-FR"] })).resolves.toMatchObject({
      locale: "en-GB",
    });
  });

  it("lets a stored choice override the browser entirely", async () => {
    /*
     * Not "stored first in the list" — the whole list. Choosing a language
     * explicitly is the reader saying their browser is wrong about them, and a
     * negotiation that still considered `navigator.languages` could find a more
     * exact match there and overrule them.
     */
    writeStoredLocale("en-GB");
    await expect(resolveI18n({ preferred: ["ar-EG"] })).resolves.toMatchObject({
      locale: "en-GB",
    });
  });

  it("ignores a stored choice this build no longer supports", async () => {
    localStorage.setItem("locale", "fr-FR");
    await expect(resolveI18n({ preferred: ["ar-EG"] })).resolves.toMatchObject({
      locale: "ar-EG",
    });
  });

  it("starts in the default locale when the catalogue cannot be loaded", async () => {
    /*
     * A stale `index.html` against a new deploy is the ordinary way a locale
     * chunk 404s, and it resolves itself on the next load. A blank page for a
     * reader whose only offence was preferring Arabic is not a defensible
     * response to a transient error — but the error is reported, so it does not
     * resolve itself silently either.
     */
    const onError = vi.fn();
    const result = await resolveI18n({
      preferred: ["ar-EG"],
      loadMessages: () => Promise.reject(new Error("chunk 404")),
      onError,
    });

    expect(result).toEqual({ locale: "en-GB", messages: DEFAULT_CATALOG });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "chunk 404" }));
  });

  it("does not call the loader at all for the default locale", async () => {
    // The fallback catalogue is statically linked; asking a loader for it would
    // put the thing that runs when something has failed behind a fetch.
    const loadMessages = vi.fn();
    await resolveI18n({ preferred: ["en-GB"], loadMessages });
    expect(loadMessages).not.toHaveBeenCalled();
  });

  it("reads the browser's list when none is passed", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["ar-EG"]);
    await expect(resolveI18n()).resolves.toMatchObject({ locale: "ar-EG" });
  });

  it("falls back to the singular `navigator.language`", async () => {
    // `navigator.languages` is absent in a few embedded WebViews, where the
    // singular is all there is.
    vi.spyOn(navigator, "languages", "get").mockReturnValue([]);
    vi.spyOn(navigator, "language", "get").mockReturnValue("ar-EG");
    await expect(resolveI18n()).resolves.toMatchObject({ locale: "ar-EG" });
  });

  it("falls back to the default when the browser offers no language at all", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([]);
    vi.spyOn(navigator, "language", "get").mockReturnValue("");
    await expect(resolveI18n()).resolves.toMatchObject({ locale: "en-GB" });
  });
});
