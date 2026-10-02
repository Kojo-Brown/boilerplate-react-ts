import { cn } from "@/shared/lib/cn";
import type { SafeHtml } from "@/shared/lib/sanitizeHtml";

/**
 * The one component in this application allowed to parse HTML.
 *
 * `security/no-dangerous-html` reports `dangerouslySetInnerHTML` everywhere
 * else, and this file is named in that rule's `allow` list in
 * `eslint.config.ts` — not exempted here by a disable comment. The difference
 * is who can grant the exemption: a `// eslint-disable-next-line` is available
 * to anyone editing any file, and a reviewer has to notice one line in a diff
 * that is mostly about something else, whereas widening the allow list is a
 * change to the lint configuration, in a file whose entire contents are rules,
 * and it shows up as a rule change in the pull request.
 *
 * The props carry the other half. `html` is {@link SafeHtml}, which only
 * `sanitizeHtml()` returns, so there is no way to render an unsanitised string
 * through this component without writing a cast. `docs/xss.md` has the rest.
 */
export interface RichTextProps {
  /** Sanitised markup. Call `sanitizeHtml()` on the untrusted string first. */
  html: SafeHtml;
  /**
   * The wrapper element.
   *
   * Constrained to containers with no phrasing-content restriction, because the
   * policy permits `<p>`, `<ul>` and `<blockquote>` and every one of those is
   * invalid inside a `<span>` — a combination the browser silently reparents,
   * producing a DOM that no longer matches the sanitised string.
   */
  as?: "div" | "section" | "article" | "aside" | "figure" | "td" | "li";
  className?: string;
}

/**
 * Baseline typography for authored prose.
 *
 * The policy strips `class` and `style`, so content cannot style itself and
 * everything it needs has to come from here. These are descendant selectors
 * rather than Tailwind's typography plugin so the styling stays inside the
 * design system's tokens. Every inset is `ps-*` rather than `pl-*`, which is
 * what keeps `i18n/logical-properties` satisfied and the prose mirrored under
 * `dir="rtl"` — a list indented from the left is indented from the wrong side
 * in Arabic.
 */
const PROSE_CLASSES = [
  "text-[var(--color-fg)]",
  "[&_p]:my-2",
  "[&_a]:text-[var(--color-primary-strong)] [&_a]:underline",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:ps-5",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:ps-5",
  "[&_li]:my-0.5",
  "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold",
  "[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-base [&_h3]:font-semibold",
  "[&_blockquote]:my-2 [&_blockquote]:border-s-2 [&_blockquote]:border-[var(--color-border)] [&_blockquote]:ps-3 [&_blockquote]:text-[var(--color-muted-fg)]",
  "[&_code]:rounded-[var(--radius-sm)] [&_code]:bg-[var(--color-surface-raised)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-sm",
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-[var(--radius-md)] [&_pre]:bg-[var(--color-surface-raised)] [&_pre]:p-3",
  "[&_hr]:my-4 [&_hr]:border-[var(--color-border)]",
].join(" ");

export function RichText({ html, as = "div", className }: RichTextProps) {
  const Component = as;

  return (
    <Component
      className={cn(PROSE_CLASSES, className)}
      /*
       * The sanctioned sink, and the only one. There is deliberately no
       * `eslint-disable` comment here: the exemption is the `allow` entry in
       * `eslint.config.ts`, so renaming or moving this component fails the lint
       * run instead of carrying its own permission along with it.
       */
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
