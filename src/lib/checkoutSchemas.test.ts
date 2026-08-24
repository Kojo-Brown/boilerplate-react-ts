import { describe, it, expect } from "vitest";
import {
  EMPTY_PAYMENT_DRAFT,
  EMPTY_SHIPPING_DRAFT,
  PAYMENT_FIELDS,
  SHIPPING_FIELDS,
  createPaymentSchema,
  expiryEndOfMonth,
  isLuhnValid,
  shippingSchema,
  type PaymentDraft,
  type ShippingDraft,
} from "@/lib/checkoutSchemas";
import { fieldErrorsFromZod } from "@/lib/formState";

const NOW = new Date("2026-06-15T00:00:00.000Z");

const shipping = (overrides: Partial<ShippingDraft> = {}): ShippingDraft => ({
  fullName: "Grace Hopper",
  line1: "12 Navy Yard",
  city: "Arlington",
  postcode: "SW1A 1AA",
  ...overrides,
});

const payment = (overrides: Partial<PaymentDraft> = {}): PaymentDraft => ({
  cardholder: "G Hopper",
  cardNumber: "4242 4242 4242 4242",
  expiry: "12/26",
  cvc: "123",
  ...overrides,
});

describe("empty drafts", () => {
  it("cover every declared field", () => {
    expect(Object.keys(EMPTY_SHIPPING_DRAFT).sort()).toEqual([...SHIPPING_FIELDS].sort());
    expect(Object.keys(EMPTY_PAYMENT_DRAFT).sort()).toEqual([...PAYMENT_FIELDS].sort());
  });
});

describe("shippingSchema", () => {
  it("accepts a filled address and trims it", () => {
    const parsed = shippingSchema.parse(shipping({ fullName: "  Grace Hopper " }));
    expect(parsed.fullName).toBe("Grace Hopper");
  });

  it("accepts a postcode written without a space", () => {
    expect(shippingSchema.safeParse(shipping({ postcode: "sw1a1aa" })).success).toBe(true);
  });

  it("reports one message per empty field", () => {
    const result = shippingSchema.safeParse(EMPTY_SHIPPING_DRAFT);
    expect(result.success).toBe(false);
    if (result.success) return;

    const errors = fieldErrorsFromZod(result.error, SHIPPING_FIELDS);
    expect(Object.keys(errors).sort()).toEqual(["city", "fullName", "line1", "postcode"]);
  });

  it("rejects a postcode that is not one", () => {
    const result = shippingSchema.safeParse(shipping({ postcode: "not a postcode" }));
    expect(result.success).toBe(false);
  });
});

describe("isLuhnValid", () => {
  it("accepts the well-known test numbers", () => {
    expect(isLuhnValid("4242424242424242")).toBe(true);
    expect(isLuhnValid("4000000000000002")).toBe(true);
  });

  it("rejects a single mistyped digit", () => {
    expect(isLuhnValid("4242424242424243")).toBe(false);
  });

  it("rejects anything that is not all digits", () => {
    expect(isLuhnValid("4242 4242 4242 4242")).toBe(false);
    expect(isLuhnValid("")).toBe(false);
  });
});

describe("expiryEndOfMonth", () => {
  it("returns the last instant of the month", () => {
    expect(expiryEndOfMonth("12/26")?.toISOString()).toBe("2026-12-31T23:59:59.999Z");
  });

  it("rejects a month outside 1–12", () => {
    expect(expiryEndOfMonth("00/26")).toBeNull();
    expect(expiryEndOfMonth("13/26")).toBeNull();
  });

  it("rejects anything that is not MM/YY", () => {
    expect(expiryEndOfMonth("1/26")).toBeNull();
    expect(expiryEndOfMonth("12-26")).toBeNull();
    expect(expiryEndOfMonth("")).toBeNull();
  });
});

describe("createPaymentSchema", () => {
  const schema = createPaymentSchema(NOW);

  it("strips separators from the card number", () => {
    expect(schema.parse(payment()).cardNumber).toBe("4242424242424242");
    expect(schema.parse(payment({ cardNumber: "4242-4242-4242-4242" })).cardNumber).toBe(
      "4242424242424242",
    );
  });

  it("accepts a card expiring in the current month", () => {
    // The boundary is the *end* of the month, not its start: a card marked
    // 06/26 is good for all of June 2026, and rejecting it on the 15th is the
    // off-by-one every hand-rolled expiry check ships with.
    expect(schema.safeParse(payment({ expiry: "06/26" })).success).toBe(true);
  });

  it("rejects a card that expired last month", () => {
    const result = schema.safeParse(payment({ expiry: "05/26" }));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldErrorsFromZod(result.error, PAYMENT_FIELDS).expiry).toBe("That card has expired.");
  });

  it("does not read the wall clock", () => {
    // The same draft, judged by two clocks. A schema that called `new Date()`
    // could not tell these apart, and its tests would start failing on a date
    // nobody chose.
    expect(
      createPaymentSchema(new Date("2026-01-01T00:00:00.000Z")).safeParse(payment()).success,
    ).toBe(true);
    expect(
      createPaymentSchema(new Date("2030-01-01T00:00:00.000Z")).safeParse(payment()).success,
    ).toBe(false);
  });

  it("rejects a mistyped card number", () => {
    const result = schema.safeParse(payment({ cardNumber: "4242 4242 4242 4243" }));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldErrorsFromZod(result.error, PAYMENT_FIELDS).cardNumber).toContain("check the");
  });

  it("rejects a number that is too short to be a card", () => {
    const result = schema.safeParse(payment({ cardNumber: "4242" }));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldErrorsFromZod(result.error, PAYMENT_FIELDS).cardNumber).toContain("12–19");
  });

  it("accepts three and four digit security codes and nothing else", () => {
    expect(schema.safeParse(payment({ cvc: "123" })).success).toBe(true);
    expect(schema.safeParse(payment({ cvc: "1234" })).success).toBe(true);
    expect(schema.safeParse(payment({ cvc: "12" })).success).toBe(false);
    expect(schema.safeParse(payment({ cvc: "12x" })).success).toBe(false);
  });

  it("reports one message per empty field", () => {
    const result = schema.safeParse(EMPTY_PAYMENT_DRAFT);
    expect(result.success).toBe(false);
    if (result.success) return;

    const errors = fieldErrorsFromZod(result.error, PAYMENT_FIELDS);
    expect(Object.keys(errors).sort()).toEqual(["cardNumber", "cardholder", "cvc", "expiry"]);
  });
});
