import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  clearStoredLocale,
  readStoredLocale,
  writeStoredLocale,
} from "@/shared/i18n/localePreference";

const KEY = "locale";

describe("localePreference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trips a supported locale", () => {
    writeStoredLocale("ar-EG");
    expect(readStoredLocale()).toBe("ar-EG");
  });

  it("returns null when nothing is stored", () => {
    expect(readStoredLocale()).toBeNull();
  });

  it("rejects a stored value this build no longer supports", () => {
    /*
     * The case that makes validating the read worth writing. A locale dropped
     * from `SUPPORTED_LOCALES` is still in the browser of everybody who chose
     * it, so the visit *after* the removal is the one that breaks — and it
     * breaks in two places at once: `Intl` throws a `RangeError` on the tag, and
     * the catalogue loader calls `undefined`.
     */
    localStorage.setItem(KEY, "fr-FR");
    expect(readStoredLocale()).toBeNull();
  });

  it("rejects junk", () => {
    localStorage.setItem(KEY, "{}");
    expect(readStoredLocale()).toBeNull();
  });

  it("clears the preference", () => {
    writeStoredLocale("ar-EG");
    clearStoredLocale();
    expect(readStoredLocale()).toBeNull();
  });

  it("reads as 'no preference' when storage throws", () => {
    // The getter itself throws under private browsing and inside a sandboxed
    // iframe, which is a case a `try` around the value cannot cover.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(readStoredLocale()).toBeNull();
  });

  it("swallows a failed write, because the language has already changed", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(() => {
      writeStoredLocale("ar-EG");
    }).not.toThrow();
  });

  it("swallows a failed clear", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(() => {
      clearStoredLocale();
    }).not.toThrow();
  });
});
