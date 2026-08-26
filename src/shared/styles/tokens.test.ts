import { describe, it, expect } from "vitest";
import {
  color,
  colorNeutral,
  colorPrimary,
  colorDanger,
  colorSuccess,
  colorWarning,
  spacing,
  radius,
  shadow,
  fontSize,
  fontWeight,
  leading,
  tracking,
  zIndex,
  duration,
  ease,
  tokens,
} from "@/shared/styles/tokens";

function isCssVar(value: string): boolean {
  return value.startsWith("var(--") && value.endsWith(")");
}

describe("Design tokens", () => {
  describe("color semantic tokens", () => {
    it("every value is a valid CSS var reference", () => {
      for (const [key, value] of Object.entries(color)) {
        expect(isCssVar(value), `color.${key} = "${value}"`).toBe(true);
      }
    });

    it("covers all required semantic categories", () => {
      expect(color.bg).toBeDefined();
      expect(color.fg).toBeDefined();
      expect(color.border).toBeDefined();
      expect(color.primary).toBeDefined();
      expect(color.danger).toBeDefined();
      expect(color.success).toBeDefined();
      expect(color.warning).toBeDefined();
      expect(color.muted).toBeDefined();
      expect(color.surface).toBeDefined();
    });

    it("each semantic category has hover and subtle variants", () => {
      const semantics = ["primary", "danger", "success", "warning"] as const;
      for (const s of semantics) {
        const key = `${s}Hover` as keyof typeof color;
        const subtleKey = `${s}Subtle` as keyof typeof color;
        const fgKey = `${s}Fg` as keyof typeof color;
        expect(color[key], `color.${key}`).toBeDefined();
        expect(color[subtleKey], `color.${subtleKey}`).toBeDefined();
        expect(color[fgKey], `color.${fgKey}`).toBeDefined();
      }
    });
  });

  describe("color primitive palettes", () => {
    const palettes = { colorNeutral, colorPrimary, colorDanger, colorSuccess, colorWarning };
    const expectedShades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

    for (const [name, palette] of Object.entries(palettes)) {
      it(`${name} has all 11 shades (50–950)`, () => {
        for (const shade of expectedShades) {
          const value = palette[shade];
          expect(value, `${name}[${shade}]`).toBeDefined();
          expect(isCssVar(value), `${name}[${shade}] = "${value}"`).toBe(true);
        }
      });
    }
  });

  describe("spacing tokens", () => {
    it("every value is a valid CSS var reference", () => {
      for (const [key, value] of Object.entries(spacing)) {
        expect(isCssVar(value), `spacing["${key}"] = "${value}"`).toBe(true);
      }
    });

    it("contains common spacing steps", () => {
      expect(spacing[4]).toBe("var(--spacing-4)");
      expect(spacing[8]).toBe("var(--spacing-8)");
      expect(spacing[16]).toBe("var(--spacing-16)");
    });

    it("has at least 20 entries for a full scale", () => {
      expect(Object.keys(spacing).length).toBeGreaterThanOrEqual(20);
    });
  });

  describe("radius tokens", () => {
    it("every value is a valid CSS var reference", () => {
      for (const [key, value] of Object.entries(radius)) {
        expect(isCssVar(value), `radius.${key} = "${value}"`).toBe(true);
      }
    });

    it("has none, sm, md, lg, and full", () => {
      expect(radius.none).toBe("var(--radius-none)");
      expect(radius.sm).toBe("var(--radius-sm)");
      expect(radius.md).toBe("var(--radius-md)");
      expect(radius.lg).toBe("var(--radius-lg)");
      expect(radius.full).toBe("var(--radius-full)");
    });
  });

  describe("shadow tokens", () => {
    it("every value is a valid CSS var reference", () => {
      for (const [key, value] of Object.entries(shadow)) {
        expect(isCssVar(value), `shadow.${key} = "${value}"`).toBe(true);
      }
    });

    it("has none through 2xl plus inner", () => {
      expect(shadow.none).toBe("var(--shadow-none)");
      expect(shadow.xs).toBe("var(--shadow-xs)");
      expect(shadow.sm).toBe("var(--shadow-sm)");
      expect(shadow.md).toBe("var(--shadow-md)");
      expect(shadow.lg).toBe("var(--shadow-lg)");
      expect(shadow.xl).toBe("var(--shadow-xl)");
      expect(shadow["2xl"]).toBe("var(--shadow-2xl)");
      expect(shadow.inner).toBe("var(--shadow-inner)");
    });
  });

  describe("typography tokens", () => {
    it("font sizes are all CSS var references", () => {
      for (const [key, value] of Object.entries(fontSize)) {
        expect(isCssVar(value), `fontSize.${key}`).toBe(true);
      }
    });

    it("font weights are all CSS var references", () => {
      for (const [key, value] of Object.entries(fontWeight)) {
        expect(isCssVar(value), `fontWeight.${key}`).toBe(true);
      }
    });

    it("leading values are all CSS var references", () => {
      for (const [key, value] of Object.entries(leading)) {
        expect(isCssVar(value), `leading.${key}`).toBe(true);
      }
    });

    it("tracking values are all CSS var references", () => {
      for (const [key, value] of Object.entries(tracking)) {
        expect(isCssVar(value), `tracking.${key}`).toBe(true);
      }
    });

    it("has expected font size steps from xs to 6xl", () => {
      expect(fontSize.xs).toBe("var(--font-size-xs)");
      expect(fontSize.base).toBe("var(--font-size-base)");
      expect(fontSize["6xl"]).toBe("var(--font-size-6xl)");
    });

    it("has expected font weight steps", () => {
      expect(fontWeight.normal).toBe("var(--font-weight-normal)");
      expect(fontWeight.semibold).toBe("var(--font-weight-semibold)");
      expect(fontWeight.bold).toBe("var(--font-weight-bold)");
    });
  });

  describe("z-index tokens", () => {
    it("every value is a valid CSS var reference", () => {
      for (const [key, value] of Object.entries(zIndex)) {
        expect(isCssVar(value), `zIndex.${key}`).toBe(true);
      }
    });

    it("has all layering contexts", () => {
      expect(zIndex.base).toBeDefined();
      expect(zIndex.dropdown).toBeDefined();
      expect(zIndex.sticky).toBeDefined();
      expect(zIndex.overlay).toBeDefined();
      expect(zIndex.modal).toBeDefined();
      expect(zIndex.popover).toBeDefined();
      expect(zIndex.toast).toBeDefined();
    });
  });

  describe("transition tokens", () => {
    it("duration values are all CSS var references", () => {
      for (const [key, value] of Object.entries(duration)) {
        expect(isCssVar(value), `duration.${key}`).toBe(true);
      }
    });

    it("ease values are all CSS var references", () => {
      for (const [key, value] of Object.entries(ease)) {
        expect(isCssVar(value), `ease.${key}`).toBe(true);
      }
    });
  });

  describe("tokens aggregate export", () => {
    it("contains all token groups", () => {
      expect(tokens.color).toBeDefined();
      expect(tokens.spacing).toBeDefined();
      expect(tokens.radius).toBeDefined();
      expect(tokens.shadow).toBeDefined();
      expect(tokens.fontSize).toBeDefined();
      expect(tokens.fontWeight).toBeDefined();
      expect(tokens.leading).toBeDefined();
      expect(tokens.tracking).toBeDefined();
      expect(tokens.zIndex).toBeDefined();
      expect(tokens.duration).toBeDefined();
      expect(tokens.ease).toBeDefined();
    });
  });
});
