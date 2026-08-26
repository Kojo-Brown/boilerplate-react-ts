import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Divider } from "@/shared/ui/layout/Divider";

describe("Divider", () => {
  describe("horizontal (default)", () => {
    it("renders an hr element by default", () => {
      const { container } = render(<Divider />);
      expect(container.querySelector("hr")).toBeInTheDocument();
    });

    it("applies border and background classes", () => {
      const { container } = render(<Divider />);
      const hr = container.querySelector("hr") as HTMLElement;
      expect(hr.className).toContain("h-px");
      expect(hr.className).toContain("border-0");
      expect(hr.className).toContain("bg-[var(--color-border)]");
    });

    it("is aria-hidden by default (decorative)", () => {
      const { container } = render(<Divider />);
      const hr = container.querySelector("hr") as HTMLElement;
      expect(hr.getAttribute("aria-hidden")).toBe("true");
    });

    it("exposes separator role when decorative=false", () => {
      const { container } = render(<Divider decorative={false} />);
      const hr = container.querySelector("hr") as HTMLElement;
      expect(hr.getAttribute("role")).toBe("separator");
      expect(hr.getAttribute("aria-hidden")).toBeNull();
    });

    it("merges custom className", () => {
      const { container } = render(<Divider className="my-divider" />);
      expect((container.querySelector("hr") as HTMLElement).className).toContain("my-divider");
    });
  });

  describe("horizontal with label", () => {
    it("renders the label text", () => {
      render(<Divider label="OR" />);
      expect(screen.getByText("OR")).toBeInTheDocument();
    });

    it("renders a div (not hr) when label is provided", () => {
      const { container } = render(<Divider label="OR" />);
      expect(container.querySelector("hr")).not.toBeInTheDocument();
      expect(container.querySelector("div")).toBeInTheDocument();
    });

    it("applies flex layout for label variant", () => {
      const { container } = render(<Divider label="OR" />);
      expect((container.firstChild as HTMLElement).className).toContain("flex");
      expect((container.firstChild as HTMLElement).className).toContain("items-center");
    });

    it("is aria-hidden by default when labeled", () => {
      const { container } = render(<Divider label="OR" />);
      expect((container.firstChild as HTMLElement).getAttribute("aria-hidden")).toBe("true");
    });
  });

  describe("vertical", () => {
    it("renders a div for vertical orientation", () => {
      const { container } = render(<Divider orientation="vertical" />);
      expect(container.querySelector("hr")).not.toBeInTheDocument();
      expect(container.querySelector("div")).toBeInTheDocument();
    });

    it("applies vertical width and background classes", () => {
      const { container } = render(<Divider orientation="vertical" />);
      const el = container.firstChild as HTMLElement;
      expect(el.className).toContain("w-px");
      expect(el.className).toContain("bg-[var(--color-border)]");
    });

    it("is aria-hidden by default", () => {
      const { container } = render(<Divider orientation="vertical" />);
      expect((container.firstChild as HTMLElement).getAttribute("aria-hidden")).toBe("true");
    });

    it("exposes separator role and aria-orientation when decorative=false", () => {
      const { container } = render(<Divider orientation="vertical" decorative={false} />);
      const el = container.firstChild as HTMLElement;
      expect(el.getAttribute("role")).toBe("separator");
      expect(el.getAttribute("aria-orientation")).toBe("vertical");
    });

    it("merges custom className", () => {
      const { container } = render(<Divider orientation="vertical" className="my-divider" />);
      expect((container.firstChild as HTMLElement).className).toContain("my-divider");
    });
  });
});
