import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RichText } from "@/shared/ui/RichText";
import { sanitizeHtml } from "@/shared/lib/sanitizeHtml";

describe("RichText", () => {
  it("renders sanitised markup as markup", () => {
    render(<RichText html={sanitizeHtml("<p>hello <strong>world</strong></p>")} />);

    expect(screen.getByText("world").tagName).toBe("STRONG");
  });

  it("renders the payload corpus inert", () => {
    // The end-to-end version of `sanitizeHtml.test.ts`: the string goes through
    // the policy and then through React into a real DOM, which is where an
    // `onerror` would actually fire. `queryByRole("img")` is the assertion that
    // matters — no element, so no handler to run.
    const { container } = render(
      <RichText
        html={sanitizeHtml(`<p>intro</p><img src=x onerror="alert(1)"><script>alert(2)</script>`)}
      />,
    );

    expect(screen.getByText("intro")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
  });

  it("renders a javascript: link with no href rather than dropping the text", () => {
    render(<RichText html={sanitizeHtml(`<a href="javascript:alert(1)">read more</a>`)} />);

    const link = screen.getByText("read more");
    expect(link.tagName).toBe("A");
    expect(link.hasAttribute("href")).toBe(false);
  });

  it("defaults to a div and honours `as`", () => {
    const { container } = render(<RichText html={sanitizeHtml("<p>x</p>")} />);
    expect(container.firstElementChild?.tagName).toBe("DIV");

    const { container: aside } = render(<RichText as="aside" html={sanitizeHtml("<p>x</p>")} />);
    expect(aside.firstElementChild?.tagName).toBe("ASIDE");
  });

  it("merges a caller's className with the prose styling", () => {
    const { container } = render(
      <RichText className="max-w-prose" html={sanitizeHtml("<p>x</p>")} />,
    );

    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("max-w-prose");
    expect(wrapper?.className).toContain("[&_a]:underline");
  });

  it("styles content it cannot let content style itself", () => {
    // The policy strips `class` and `style`, so every rule the prose needs has
    // to arrive on the wrapper. This is the test that fails if the two halves
    // drift — a policy that started allowing `class`, or a wrapper that stopped
    // providing list markers.
    const { container } = render(
      <RichText html={sanitizeHtml(`<ul class="list-none"><li>a</li></ul>`)} />,
    );

    expect(container.querySelector("ul")?.hasAttribute("class")).toBe(false);
    expect(container.firstElementChild?.className).toContain("[&_ul]:list-disc");
  });
});
