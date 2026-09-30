// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createIntl } from "react-intl";
import {
  isArgumentElement,
  isDateElement,
  isNumberElement,
  isPluralElement,
  isSelectElement,
  isStructurallySame,
  isTagElement,
  isTimeElement,
  parse,
  type MessageFormatElement,
  type PluralElement,
} from "@formatjs/icu-messageformat-parser";
import { SUPPORTED_LOCALES, SUPPORTED_TAGS, type LocaleTag } from "@/shared/i18n/locales";
import { EN_GB_MESSAGES, type MessageId } from "@/shared/i18n/messages/en-GB";
import { AR_EG_MESSAGES } from "@/shared/i18n/messages/ar-EG";
import { DEFAULT_CATALOG, isMessageId, loadCatalog } from "@/shared/i18n/messages";

/**
 * The gate the type system cannot be.
 *
 * `Record<MessageId, string>` already guarantees that every catalogue has every
 * id and no extra ones — a missing translation is a compile error, and that is
 * the largest class of i18n defect closed at the cheapest price. What a type
 * says nothing about is the *contents* of those strings, and every remaining way
 * a catalogue is wrong lives there:
 *
 * - An ICU string that does not parse. react-intl returns the raw message, so
 *   the page looks translated and reads `{count, plural, one {#…`.
 * - A translation that renames, drops or invents a placeholder. `{page}` where
 *   the source says `{pageName}` throws from `formatMessage` at render time, in
 *   the one language nobody on the team reads.
 * - A plural message missing a category the locale actually uses. ICU falls
 *   through to `other`, which is grammatical in no particular language, and the
 *   sentence is wrong for a range of numbers nobody tested.
 *
 * All three are properties of the parsed message rather than of the string, so
 * this file parses every message in every locale with the same parser react-intl
 * uses at runtime — pinned to the version react-intl itself depends on, because
 * a gate reading a different AST than the renderer is a gate that can be wrong
 * in both directions.
 */

const CATALOGS: Record<LocaleTag, Record<string, string>> = {
  "en-GB": EN_GB_MESSAGES,
  "ar-EG": AR_EG_MESSAGES,
};

const MESSAGE_IDS = Object.keys(EN_GB_MESSAGES) as MessageId[];
const TRANSLATED_TAGS = SUPPORTED_TAGS.filter((tag) => tag !== "en-GB");

function messageOf(locale: LocaleTag, id: MessageId): string {
  return CATALOGS[locale][id] ?? "";
}

describe("catalogues", () => {
  it("covers every supported locale", () => {
    // A locale added to the list with no catalogue fails at runtime, on the
    // first visit from a reader who prefers it.
    expect(Object.keys(CATALOGS).sort()).toEqual([...SUPPORTED_TAGS].sort());
  });

  it("declares the same ids in every locale", () => {
    // Already true by construction: every non-source catalogue is typed
    // `Record<MessageId, string>`. Asserted because an index signature would
    // satisfy that type too, and this is the property everything below assumes.
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      expect(Object.keys(catalog).sort(), locale).toEqual([...MESSAGE_IDS].sort());
    }
  });

  it.each(SUPPORTED_TAGS)("%s parses as ICU and is never blank", (locale) => {
    const problems: string[] = [];

    for (const id of MESSAGE_IDS) {
      const message = messageOf(locale, id);
      if (message.trim() === "") {
        problems.push(`${id}: empty`);
        continue;
      }
      try {
        parse(message);
      } catch (error) {
        problems.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // One list rather than a failure per message, so a translator sees every id
    // that needs attention from a single run.
    expect(problems).toEqual([]);
  });

  it.each(TRANSLATED_TAGS)("%s keeps the source message's structure", (locale) => {
    /*
     * `isStructurallySame` is formatjs's own check — the one `@formatjs/cli`
     * runs — and it is stricter than comparing placeholder names: it also
     * rejects a `{count}` that became `{count, number}`, or a plural argument
     * rendered as a bare interpolation. Both of those keep the name and change
     * what the sentence does with it.
     *
     * Different *branches* are allowed, and have to be: the Arabic plurals here
     * deliberately carry six categories where the English carry two, and the
     * ordinal collapses to `other`.
     */
    const mismatches: string[] = [];

    for (const id of MESSAGE_IDS) {
      const result = isStructurallySame(parse(EN_GB_MESSAGES[id]), parse(messageOf(locale, id)));
      if (!result.success) {
        mismatches.push(`${id}: ${result.error?.message ?? "structure differs"}`);
      }
    }

    expect(mismatches).toEqual([]);
  });

  it.each(SUPPORTED_TAGS)("%s declares every plural category the locale uses", (locale) => {
    /*
     * The categories come from `Intl.PluralRules` rather than from a list in
     * this file, so a locale added later is checked against its own grammar
     * instead of against Arabic's.
     *
     * Only cardinal plurals are checked. `selectordinal` categories are the
     * ordinal set, which `Intl.PluralRules` reports only when constructed with
     * `{ type: "ordinal" }` — demanding the cardinal ones of it would require
     * Arabic branches CLDR never selects, since Arabic ordinals have only
     * `other`.
     */
    const required = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
    const gaps: string[] = [];

    for (const id of MESSAGE_IDS) {
      for (const element of pluralElements(parse(messageOf(locale, id)))) {
        if (element.pluralType !== "cardinal") continue;
        // `=0` and friends are exact matches, chosen ahead of any category, and
        // are not a substitute for one: a message with `=0` and no `zero` is
        // still missing the category for every other number that selects it.
        const declared = new Set(
          Object.keys(element.options).filter((key) => !key.startsWith("=")),
        );
        const missing = required.filter((category) => !declared.has(category));
        if (missing.length > 0) gaps.push(`${id}: missing ${missing.join(", ")}`);
      }
    }

    expect(gaps).toEqual([]);
  });

  it("formats every message without an error", () => {
    /*
     * The end-to-end pass, through `createIntl` rather than through the ICU
     * formatter directly — the same object the application renders with, so what
     * passes here is what will render.
     *
     * `I18nProvider` turns a formatting error into a throw outside production,
     * so a message that parses but cannot render with plausible values would
     * fail whichever page used it. That page might be one no test renders; this
     * makes it this file's failure instead.
     *
     * Every argument gets a number, and every message is formatted once per
     * plural sample. One count would leave five of Arabic's six branches
     * unselected: a syntax error inside a branch is caught by `parse` above, but
     * an error raised *while formatting* a branch belongs to the branch that was
     * chosen.
     */
    const failures: string[] = [];

    for (const locale of SUPPORTED_TAGS) {
      const intl = createIntl({
        locale,
        defaultLocale: "en-GB",
        messages: CATALOGS[locale],
        onError: (error) => {
          throw error;
        },
      });

      for (const id of MESSAGE_IDS) {
        const names = argumentNames(parse(messageOf(locale, id)));
        for (const sample of PLURAL_SAMPLES) {
          const values = Object.fromEntries(names.map((name) => [name, sample]));
          try {
            intl.formatMessage({ id }, values);
          } catch (error) {
            failures.push(
              `${locale} ${id} @${String(sample)}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });
});

/**
 * Counts that select between them every cardinal plural category CLDR defines
 * for the locales here: Arabic's `zero`, `one`, `two`, `few`, `many` and
 * `other`, which is a superset of English's two.
 */
const PLURAL_SAMPLES = [0, 1, 2, 3, 11, 100] as const;

/** Every cardinal or ordinal plural element in an AST, at any depth. */
function pluralElements(ast: readonly MessageFormatElement[]): PluralElement[] {
  const found: PluralElement[] = [];

  function walk(elements: readonly MessageFormatElement[]): void {
    for (const element of elements) {
      if (isPluralElement(element)) {
        found.push(element);
        for (const option of Object.values(element.options)) walk(option.value);
      } else if (isSelectElement(element)) {
        for (const option of Object.values(element.options)) walk(option.value);
      } else if (isTagElement(element)) {
        walk(element.children);
      }
    }
  }

  walk(ast);
  return found;
}

/**
 * Every argument name an AST reads, at any depth.
 *
 * The element guards are the parser's own, which is the only version of this
 * that stays correct: every element type below carries its argument name in
 * `value`, and so does a literal — whose `value` is its *text*. Matching on the
 * guards rather than on the presence of a `value` is what keeps the word "Home"
 * out of the argument list.
 */
function argumentNames(ast: readonly MessageFormatElement[]): string[] {
  const names = new Set<string>();

  function walk(elements: readonly MessageFormatElement[]): void {
    for (const element of elements) {
      if (
        isArgumentElement(element) ||
        isNumberElement(element) ||
        isDateElement(element) ||
        isTimeElement(element)
      ) {
        names.add(element.value);
      } else if (isPluralElement(element) || isSelectElement(element)) {
        names.add(element.value);
        for (const option of Object.values(element.options)) walk(option.value);
      } else if (isTagElement(element)) {
        // A rich-text tag (`<bdi>…</bdi>`) is supplied as a value too, named
        // after the tag, so it belongs in this list.
        names.add(element.value);
        walk(element.children);
      }
    }
  }

  walk(ast);
  return [...names];
}

describe("loadCatalog", () => {
  it("resolves the default locale without a chunk", async () => {
    // The fallback catalogue has to be present, not fetchable: it is what
    // react-intl reaches for when something has already gone wrong.
    await expect(loadCatalog("en-GB")).resolves.toBe(DEFAULT_CATALOG);
  });

  it("loads a non-default catalogue", async () => {
    await expect(loadCatalog("ar-EG")).resolves.toEqual(AR_EG_MESSAGES);
  });
});

describe("isMessageId", () => {
  it("accepts a declared id", () => {
    expect(isMessageId("route.home.title")).toBe(true);
  });

  it.each([
    ["a plausible but unknown id", "route.nope.title"],
    ["an empty string", ""],
    ["a number", 42],
    ["null", null],
    ["undefined", undefined],
    ["an object", {}],
  ])("rejects %s", (_name, value) => {
    expect(isMessageId(value)).toBe(false);
  });
});

describe("locale coverage", () => {
  it("has a catalogue for every direction the application claims to support", () => {
    // Paired with `locales.test.ts`: that file asserts the list contains both
    // directions, this one that both are actually translated.
    const directions = new Set(
      SUPPORTED_LOCALES.filter((locale) => locale.tag in CATALOGS).map((locale) => locale.dir),
    );
    expect([...directions].sort()).toEqual(["ltr", "rtl"]);
  });
});
