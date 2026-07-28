import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/context/ThemeContext";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Input } from "./Input";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";
import { Skeleton } from "./Skeleton";
import { DarkModeToggle } from "./DarkModeToggle";
import { ToastProvider } from "./Toast";

function ThemeWrapper({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

beforeEach(() => {
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  });
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList);
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("UI system snapshots", () => {
  describe("Badge", () => {
    it("default variant", () => {
      const { asFragment } = render(<Badge>Default</Badge>);
      expect(asFragment()).toMatchSnapshot();
    });

    it("primary variant", () => {
      const { asFragment } = render(<Badge variant="primary">Primary</Badge>);
      expect(asFragment()).toMatchSnapshot();
    });

    it("success variant", () => {
      const { asFragment } = render(<Badge variant="success">Active</Badge>);
      expect(asFragment()).toMatchSnapshot();
    });

    it("warning variant", () => {
      const { asFragment } = render(<Badge variant="warning">Warning</Badge>);
      expect(asFragment()).toMatchSnapshot();
    });

    it("danger variant", () => {
      const { asFragment } = render(<Badge variant="danger">Error</Badge>);
      expect(asFragment()).toMatchSnapshot();
    });

    it("outline variant", () => {
      const { asFragment } = render(<Badge variant="outline">Tag</Badge>);
      expect(asFragment()).toMatchSnapshot();
    });

    it("sm size", () => {
      const { asFragment } = render(<Badge size="sm">Small</Badge>);
      expect(asFragment()).toMatchSnapshot();
    });
  });

  describe("Button", () => {
    it("default (primary/md)", () => {
      const { asFragment } = render(<Button>Submit</Button>);
      expect(asFragment()).toMatchSnapshot();
    });

    it("secondary variant", () => {
      const { asFragment } = render(<Button variant="secondary">Cancel</Button>);
      expect(asFragment()).toMatchSnapshot();
    });

    it("ghost variant", () => {
      const { asFragment } = render(<Button variant="ghost">Ghost</Button>);
      expect(asFragment()).toMatchSnapshot();
    });

    it("danger variant", () => {
      const { asFragment } = render(<Button variant="danger">Delete</Button>);
      expect(asFragment()).toMatchSnapshot();
    });

    it("sm size", () => {
      const { asFragment } = render(<Button size="sm">Small</Button>);
      expect(asFragment()).toMatchSnapshot();
    });

    it("lg size", () => {
      const { asFragment } = render(<Button size="lg">Large</Button>);
      expect(asFragment()).toMatchSnapshot();
    });

    it("loading state", () => {
      const { asFragment } = render(<Button loading>Saving</Button>);
      expect(asFragment()).toMatchSnapshot();
    });

    it("disabled state", () => {
      const { asFragment } = render(<Button disabled>Disabled</Button>);
      expect(asFragment()).toMatchSnapshot();
    });
  });

  describe("Input", () => {
    it("default", () => {
      const { asFragment } = render(<Input placeholder="Enter value" />);
      expect(asFragment()).toMatchSnapshot();
    });

    it("error state", () => {
      const { asFragment } = render(<Input error placeholder="Error input" />);
      expect(asFragment()).toMatchSnapshot();
    });

    it("disabled state", () => {
      const { asFragment } = render(<Input disabled placeholder="Disabled" />);
      expect(asFragment()).toMatchSnapshot();
    });

    it("with value", () => {
      const { asFragment } = render(<Input readOnly value="Hello world" />);
      expect(asFragment()).toMatchSnapshot();
    });
  });

  describe("Spinner", () => {
    it("default (md)", () => {
      const { asFragment } = render(<Spinner />);
      expect(asFragment()).toMatchSnapshot();
    });

    it("xs size", () => {
      const { asFragment } = render(<Spinner size="xs" />);
      expect(asFragment()).toMatchSnapshot();
    });

    it("sm size", () => {
      const { asFragment } = render(<Spinner size="sm" />);
      expect(asFragment()).toMatchSnapshot();
    });

    it("lg size", () => {
      const { asFragment } = render(<Spinner size="lg" />);
      expect(asFragment()).toMatchSnapshot();
    });

    it("xl size", () => {
      const { asFragment } = render(<Spinner size="xl" />);
      expect(asFragment()).toMatchSnapshot();
    });

    it("custom label", () => {
      const { asFragment } = render(<Spinner label="Saving changes…" />);
      expect(asFragment()).toMatchSnapshot();
    });
  });

  describe("Skeleton", () => {
    it("default (rect)", () => {
      const { asFragment } = render(<Skeleton />);
      expect(asFragment()).toMatchSnapshot();
    });

    it("text variant", () => {
      const { asFragment } = render(<Skeleton variant="text" />);
      expect(asFragment()).toMatchSnapshot();
    });

    it("circle variant", () => {
      const { asFragment } = render(<Skeleton variant="circle" width="48px" height="48px" />);
      expect(asFragment()).toMatchSnapshot();
    });

    it("with explicit dimensions", () => {
      const { asFragment } = render(<Skeleton width="240px" height="120px" />);
      expect(asFragment()).toMatchSnapshot();
    });
  });

  describe("Modal", () => {
    it("open with title and children", () => {
      const { baseElement } = render(
        <Modal open onClose={vi.fn()} title="Confirm Action">
          <p>Are you sure you want to proceed?</p>
        </Modal>,
      );
      expect(baseElement.querySelector("dialog")).toMatchSnapshot();
    });

    it("open with description", () => {
      const { baseElement } = render(
        <Modal
          open
          onClose={vi.fn()}
          title="Delete Item"
          description="This action cannot be undone."
        >
          <p>Confirm?</p>
        </Modal>,
      );
      expect(baseElement.querySelector("dialog")).toMatchSnapshot();
    });

    it("sm size", () => {
      const { baseElement } = render(
        <Modal open onClose={vi.fn()} title="Small Modal" size="sm">
          <p>Content</p>
        </Modal>,
      );
      expect(baseElement.querySelector("dialog")).toMatchSnapshot();
    });

    it("lg size", () => {
      const { baseElement } = render(
        <Modal open onClose={vi.fn()} title="Large Modal" size="lg">
          <p>Content</p>
        </Modal>,
      );
      expect(baseElement.querySelector("dialog")).toMatchSnapshot();
    });

    it("xl size", () => {
      const { baseElement } = render(
        <Modal open onClose={vi.fn()} title="XL Modal" size="xl">
          <p>Content</p>
        </Modal>,
      );
      expect(baseElement.querySelector("dialog")).toMatchSnapshot();
    });
  });

  describe("DarkModeToggle", () => {
    it("system mode (default)", () => {
      const { asFragment } = render(<DarkModeToggle />, { wrapper: ThemeWrapper });
      expect(asFragment()).toMatchSnapshot();
    });
  });

  describe("ToastProvider", () => {
    it("renders empty notification region", () => {
      const { baseElement } = render(
        <ToastProvider>
          <div>App content</div>
        </ToastProvider>,
      );
      expect(baseElement.querySelector('[role="region"]')).toMatchSnapshot();
    });
  });
});
