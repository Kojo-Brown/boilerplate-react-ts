import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Skeleton } from "@/shared/ui/Skeleton";

function renderSkeleton(ui: React.ReactElement): HTMLElement {
  const { container } = render(ui);
  return container.firstElementChild as HTMLElement;
}

describe("Skeleton", () => {
  it("is hidden from the accessibility tree", () => {
    const el = renderSkeleton(<Skeleton />);
    expect(el).toHaveAttribute("aria-hidden", "true");
  });

  it("applies circle variant class", () => {
    expect(renderSkeleton(<Skeleton variant="circle" />)).toHaveClass("rounded-full");
  });

  it("applies text variant class", () => {
    expect(renderSkeleton(<Skeleton variant="text" />)).toHaveClass("h-4");
  });

  it("applies rect variant class by default", () => {
    expect(renderSkeleton(<Skeleton />)).toHaveClass("rounded-md");
  });

  it("forwards width and height as inline styles", () => {
    const el = renderSkeleton(<Skeleton width="120px" height="40px" />);
    expect(el).toHaveStyle({ width: "120px", height: "40px" });
  });

  it("merges custom className", () => {
    expect(renderSkeleton(<Skeleton className="w-32" />)).toHaveClass("w-32");
  });
});
