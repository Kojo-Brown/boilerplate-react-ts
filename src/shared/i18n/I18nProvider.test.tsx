import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, renderHook, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useIntl } from "react-intl";
import { I18nProvider, useI18n } from "@/shared/i18n/I18nProvider";
import { EN_GB_MESSAGES } from "@/shared/i18n/messages/en-GB";
import { AR_EG_MESSAGES } from "@/shared/i18n/messages/ar-EG";
import { LiveRegions } from "@/shared/a11y/LiveRegions";
import { announcer } from "@/shared/a11y/announcer";
import type { Catalog } from "@/shared/i18n/messages";
import type { LocaleTag } from "@/shared/i18n/locales";
import type { ReactNode } from "react";

/** Reports everything `useI18n` publishes, and lets a test drive `setLocale`. */
function Probe() {
  const { locale, direction, isSwitching, setLocale } = useI18n();
  const intl = useIntl();

  return (
    <div>
      <p data-testid="locale">{locale}</p>
      <p data-testid="direction">{direction}</p>
      <p data-testid="switching">{String(isSwitching)}</p>
      <p data-testid="nav-home">{intl.formatMessage({ id: "nav.home" })}</p>
      <button
        type="button"
        onClick={() => {
          setLocale("ar-EG");
        }}
      >
        to arabic
      </button>
      <button
        type="button"
        onClick={() => {
          setLocale("en-GB");
        }}
      >
        to english
      </button>
    </div>
  );
}

function renderProvider(
  options: {
    locale?: LocaleTag;
    messages?: Catalog;
    onError?: (error: unknown) => void;
    children?: ReactNode;
  } = {},
) {
  const { locale = "en-GB", messages = EN_GB_MESSAGES, onError, children = <Probe /> } = options;

  return render(
    <I18nProvider
      initialLocale={locale}
      initialMessages={messages}
      {...(onError === undefined ? {} : { onError })}
    >
      {children}
    </I18nProvider>,
  );
}

describe("I18nProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the locale it was handed, with no intermediate commit", () => {
    // The whole reason the catalogue is resolved before `render()` in `main.tsx`:
    // an Arabic reader must not see one frame of English, still less one frame of
    // a mirrored layout drawn the other way round.
    renderProvider({ locale: "ar-EG", messages: AR_EG_MESSAGES });
    expect(screen.getByTestId("nav-home")).toHaveTextContent("الرئيسية");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("sets `<html lang>` and `<html dir>` from the locale", () => {
    renderProvider({ locale: "ar-EG", messages: AR_EG_MESSAGES });
    expect(document.documentElement.lang).toBe("ar-EG");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("publishes the direction so a component can read it without a media query", () => {
    renderProvider({ locale: "ar-EG", messages: AR_EG_MESSAGES });
    expect(screen.getByTestId("direction")).toHaveTextContent("rtl");
  });

  describe("switching", () => {
    it("loads the catalogue and commits the new language and direction together", async () => {
      const user = userEvent.setup();
      renderProvider();

      expect(document.documentElement.dir).toBe("ltr");
      await user.click(screen.getByRole("button", { name: "to arabic" }));

      await waitFor(() => {
        expect(screen.getByTestId("locale")).toHaveTextContent("ar-EG");
      });
      // Both, and in the same assertion: a switch that changed the direction
      // without the messages, or the reverse, is the one outcome worse than no
      // switch at all.
      expect(screen.getByTestId("nav-home")).toHaveTextContent("الرئيسية");
      expect(document.documentElement.dir).toBe("rtl");
      expect(document.documentElement.lang).toBe("ar-EG");
    });

    it("records the choice, so the next visit does not negotiate it away", async () => {
      const user = userEvent.setup();
      renderProvider();
      await user.click(screen.getByRole("button", { name: "to arabic" }));

      await waitFor(() => {
        expect(localStorage.getItem("locale")).toBe("ar-EG");
      });
    });

    it("does not record the locale it was merely handed", () => {
      /*
       * A stored preference means "this reader overrode their browser". Writing
       * the negotiated locale on mount would make a first visit permanent and
       * silently stop honouring a changed browser setting.
       */
      renderProvider({ locale: "ar-EG", messages: AR_EG_MESSAGES });
      expect(localStorage.getItem("locale")).toBeNull();
    });

    it("is a no-op for the current locale", async () => {
      const user = userEvent.setup();
      renderProvider();
      await user.click(screen.getByRole("button", { name: "to english" }));
      expect(localStorage.getItem("locale")).toBeNull();
      expect(screen.getByTestId("locale")).toHaveTextContent("en-GB");
    });

    it("keeps the current locale when the catalogue cannot be loaded", async () => {
      const onError = vi.fn();
      const user = userEvent.setup();

      render(
        <I18nProvider
          initialLocale="en-GB"
          initialMessages={EN_GB_MESSAGES}
          onError={onError}
          loadMessages={() => Promise.reject(new Error("chunk 404"))}
        >
          <Probe />
        </I18nProvider>,
      );

      await user.click(screen.getByRole("button", { name: "to arabic" }));

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "chunk 404" }));
      });
      // A half-applied switch — direction changed, messages not — is the one
      // outcome worse than no switch at all.
      expect(screen.getByTestId("locale")).toHaveTextContent("en-GB");
      expect(screen.getByTestId("nav-home")).toHaveTextContent("Home");
      expect(document.documentElement.dir).toBe("ltr");
    });

    it("announces the change in the language it changed to", async () => {
      /*
       * Without this a switch is silent to a screen reader: every string on the
       * page has been replaced and the reader is told none of it. The
       * announcement is in the *new* language because a reader who chose it is
       * the one person guaranteed to understand it.
       */
      const user = userEvent.setup();
      render(
        <>
          <LiveRegions />
          <I18nProvider initialLocale="en-GB" initialMessages={EN_GB_MESSAGES}>
            <Probe />
          </I18nProvider>
        </>,
      );

      await user.click(screen.getByRole("button", { name: "to arabic" }));

      await waitFor(() => {
        // Either half of the alternating pair may be holding it; the pair is
        // how a repeated announcement stays a real DOM mutation.
        expect(screen.getByTestId("live-regions")).toHaveTextContent("تم تغيير اللغة إلى العربية");
      });
    });

    it("says nothing on the first commit", () => {
      // A reader arriving on an Arabic page is not told that it is Arabic.
      render(
        <>
          <LiveRegions />
          <I18nProvider initialLocale="ar-EG" initialMessages={AR_EG_MESSAGES}>
            <Probe />
          </I18nProvider>
        </>,
      );
      expect(announcer.getState().polite.text).toBe("");
    });
  });

  describe("error handling", () => {
    it("reports a formatting error to the injected reporter", () => {
      const onError = vi.fn();
      renderProvider({
        messages: { ...EN_GB_MESSAGES, "nav.home": "{unclosed" },
        onError,
        children: <Probe />,
      });
      expect(onError).toHaveBeenCalled();
    });

    it("throws outside production when nothing is listening", () => {
      /*
       * The default that makes the type-level guarantees enforceable at runtime:
       * a malformed ICU string or a missing placeholder value fails the test
       * that rendered it rather than printing a warning nobody reads. In
       * production `main.tsx` passes the reporter, and an unreported formatting
       * error is better than a blank page.
       */
      expect(() => {
        renderProvider({ messages: { ...EN_GB_MESSAGES, "nav.home": "{unclosed" } });
      }).toThrow();
    });
  });

  it("throws when `useI18n` is used outside the provider", () => {
    // Defaulting would let a component render in one direction in a test and
    // the other in the application, with nothing red.
    expect(() => render(<Probe />)).toThrow(/within an I18nProvider/);
  });
});

describe("React Compiler memoization", () => {
  /*
   * `I18nProvider` carries `"use memo"` and has no `useMemo` around its context
   * value or `useCallback` around `setLocale` — the compiler derives both. A
   * provider's context value is the one object where a lost identity is
   * expensive, since every consumer in the tree re-renders, so the replacement
   * memoization is asserted rather than assumed.
   *
   * These pass only because `vitest.config.ts` runs the suite through the
   * compiler; `tooling/reactCompiler.audit.test.ts` is what pins the opt-in.
   */
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider initialLocale="en-GB" initialMessages={EN_GB_MESSAGES}>
      {children}
    </I18nProvider>
  );

  it("keeps the context value referentially stable across re-renders", () => {
    const { result, rerender } = renderHook(() => useI18n(), { wrapper });
    const first = result.current;

    rerender();
    rerender();

    expect(result.current).toBe(first);
  });

  it("produces a new context value when the locale actually changes", async () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    const first = result.current;

    act(() => {
      result.current.setLocale("ar-EG");
    });
    // The switch awaits a catalogue, so the commit is a tick away even when the
    // loader resolves synchronously.
    await waitFor(() => {
      expect(result.current.locale).toBe("ar-EG");
    });

    expect(result.current).not.toBe(first);
    expect(result.current.locale).toBe("ar-EG");
    expect(result.current.direction).toBe("rtl");
  });
});

describe("isSwitching", () => {
  it("is false once a switch settles", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en-GB" initialMessages={EN_GB_MESSAGES}>
        <Probe />
      </I18nProvider>,
    );

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "to arabic" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("switching")).toHaveTextContent("false");
    });
  });
});
