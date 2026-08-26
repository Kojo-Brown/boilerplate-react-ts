import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { OptimizedImage } from "@/shared/ui/OptimizedImage";

describe("OptimizedImage", () => {
  it("renders an img with lazy loading by default", () => {
    render(<OptimizedImage src="/photo.jpg" alt="Test photo" />);
    const img = screen.getByAltText("Test photo");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
  });

  it("renders with eager loading when priority is true", () => {
    render(<OptimizedImage src="/photo.jpg" alt="Priority photo" priority />);
    expect(screen.getByAltText("Priority photo")).toHaveAttribute("loading", "eager");
  });

  it("starts with the main image hidden before load", () => {
    render(<OptimizedImage src="/photo.jpg" alt="Hidden initially" />);
    expect(screen.getByAltText("Hidden initially")).toHaveClass("opacity-0");
  });

  it("reveals main image after load event", () => {
    render(<OptimizedImage src="/photo.jpg" alt="Revealed after load" />);
    const img = screen.getByAltText("Revealed after load");
    expect(img).toHaveClass("opacity-0");
    fireEvent.load(img);
    expect(img).toHaveClass("opacity-100");
  });

  it("renders blur placeholder before image loads", () => {
    const blurDataURL = "data:image/png;base64,abc123";
    render(<OptimizedImage src="/photo.jpg" alt="Blur test" blurDataURL={blurDataURL} />);
    const placeholder = document.querySelector('img[aria-hidden="true"]') as HTMLImageElement;
    expect(placeholder).toBeInTheDocument();
    expect(placeholder).toHaveAttribute("src", blurDataURL);
    expect(placeholder).toHaveClass("blur-xl");
  });

  it("removes blur placeholder after image loads", () => {
    const blurDataURL = "data:image/png;base64,abc123";
    render(<OptimizedImage src="/photo.jpg" alt="Blur removed" blurDataURL={blurDataURL} />);
    const img = screen.getByAltText("Blur removed");
    fireEvent.load(img);
    expect(document.querySelector('img[aria-hidden="true"]')).not.toBeInTheDocument();
  });

  it("does not render blur placeholder when blurDataURL is omitted", () => {
    render(<OptimizedImage src="/photo.jpg" alt="No blur" />);
    expect(document.querySelector('img[aria-hidden="true"]')).not.toBeInTheDocument();
  });

  it("calls onLoad callback when image loads", () => {
    const onLoad = vi.fn();
    render(<OptimizedImage src="/photo.jpg" alt="Load callback" onLoad={onLoad} />);
    fireEvent.load(screen.getByAltText("Load callback"));
    expect(onLoad).toHaveBeenCalledOnce();
  });

  it("shows error fallback when image fails to load", () => {
    render(<OptimizedImage src="/broken.jpg" alt="Broken photo" />);
    fireEvent.error(screen.getByAltText("Broken photo"));
    expect(screen.getByRole("img", { name: "Failed to load: Broken photo" })).toBeInTheDocument();
  });

  it("removes blur placeholder on error", () => {
    const blurDataURL = "data:image/png;base64,abc123";
    render(<OptimizedImage src="/broken.jpg" alt="Error removes blur" blurDataURL={blurDataURL} />);
    fireEvent.error(screen.getByAltText("Error removes blur"));
    expect(document.querySelector('img[aria-hidden="true"]')).not.toBeInTheDocument();
  });

  it("calls onError callback when image fails", () => {
    const onError = vi.fn();
    render(<OptimizedImage src="/broken.jpg" alt="Error callback" onError={onError} />);
    fireEvent.error(screen.getByAltText("Error callback"));
    expect(onError).toHaveBeenCalledOnce();
  });

  it("applies aspectRatio style to wrapper", () => {
    const { container } = render(
      <OptimizedImage src="/photo.jpg" alt="Aspect ratio" aspectRatio="16/9" />,
    );
    expect(container.firstChild).toHaveStyle({ aspectRatio: "16/9" });
  });

  it("applies width as inline style on wrapper", () => {
    const { container } = render(<OptimizedImage src="/photo.jpg" alt="Width test" width={400} />);
    expect(container.firstChild).toHaveStyle({ width: "400px" });
  });

  it("forwards width and height attributes to img", () => {
    render(<OptimizedImage src="/photo.jpg" alt="Dimensions" width={800} height={600} />);
    const img = screen.getByAltText("Dimensions");
    expect(img).toHaveAttribute("width", "800");
    expect(img).toHaveAttribute("height", "600");
  });

  it("merges className onto wrapper div", () => {
    const { container } = render(
      <OptimizedImage src="/photo.jpg" alt="Custom wrapper" className="rounded-lg" />,
    );
    expect(container.firstChild).toHaveClass("rounded-lg");
  });

  it("merges imgClassName onto img element", () => {
    render(<OptimizedImage src="/photo.jpg" alt="Custom img" imgClassName="rounded-full" />);
    expect(screen.getByAltText("Custom img")).toHaveClass("rounded-full");
  });
});
