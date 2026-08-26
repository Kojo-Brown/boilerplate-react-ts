import { z } from "zod";
import type { PaymentDetails, ShippingDetails } from "@/features/checkout/checkoutApi";

/**
 * Validation for the checkout steps, kept separate from both the machine and
 * the components.
 *
 * The machine needs these as plain functions it can call inside a guard, and a
 * guard must be synchronous and pure — it is re-evaluated whenever XState needs
 * to know whether a transition is eligible, including during
 * `getNextSnapshot`, and a guard that reached for the DOM or a ref would give a
 * different answer each time it was asked.
 */

export const SHIPPING_FIELDS = ["fullName", "line1", "city", "postcode"] as const;
export const PAYMENT_FIELDS = ["cardholder", "cardNumber", "expiry", "cvc"] as const;

export type ShippingField = (typeof SHIPPING_FIELDS)[number];
export type PaymentField = (typeof PAYMENT_FIELDS)[number];

/** What the inputs hold: strings, including the ones that are not valid yet. */
export type ShippingDraft = Readonly<Record<ShippingField, string>>;
export type PaymentDraft = Readonly<Record<PaymentField, string>>;

export const EMPTY_SHIPPING_DRAFT: ShippingDraft = {
  fullName: "",
  line1: "",
  city: "",
  postcode: "",
};

export const EMPTY_PAYMENT_DRAFT: PaymentDraft = {
  cardholder: "",
  cardNumber: "",
  expiry: "",
  cvc: "",
};

/** UK-ish, loose on purpose: a postcode regex that rejects real addresses is worse than none. */
const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

export const shippingSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the recipient's name."),
  line1: z.string().trim().min(4, "Enter the street address."),
  city: z.string().trim().min(2, "Enter the town or city."),
  postcode: z.string().trim().regex(POSTCODE, "Enter a valid UK postcode, for example SW1A 1AA."),
});

/**
 * The Luhn checksum.
 *
 * Worth doing in the browser precisely because it is the one card check the
 * client can make for itself: a mistyped digit is caught before the number
 * leaves the machine, and everything else — expired, declined, insufficient
 * funds — is the server's to answer. That split is the whole reason the
 * checkout machine has both a `fieldErrors` context slot and a rejection path
 * that lands back on the payment step.
 */
export function isLuhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;

  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    // Every character is a digit — the regex above rules out `NaN` here.
    let value = digits.charCodeAt(index) - 48;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/** `MM/YY` → the last instant of that month, or `null` if it is not a month. */
export function expiryEndOfMonth(expiry: string): Date | null {
  const match = /^(\d{2})\/(\d{2})$/.exec(expiry.trim());
  if (match === null) return null;

  const month = Number(match[1]);
  const year = Number(match[2]);
  if (month < 1 || month > 12) return null;

  // A two-digit year is 20xx here. The alternative — a sliding window around
  // the current year — buys nothing for a card that cannot be issued more than
  // a decade out, and is a source of off-by-one bugs every new century.
  return new Date(Date.UTC(2000 + year, month, 1) - 1);
}

/**
 * The payment schema takes its clock as an argument rather than calling
 * `new Date()`.
 *
 * "Is this card expired?" is the one rule here that changes answer over time,
 * so a schema that read the wall clock would make its own tests expire: a fixed
 * `12/26` fixture passes today and fails in 2027, on a day nobody touched this
 * file. The lab page passes the real clock; tests pass a frozen one.
 */
export function createPaymentSchema(now: Date) {
  return z.object({
    cardholder: z.string().trim().min(2, "Enter the name on the card."),
    cardNumber: z
      .string()
      .transform((value) => value.replace(/[\s-]/g, ""))
      .refine((digits) => digits.length >= 12 && digits.length <= 19, "Enter a 12–19 digit number.")
      .refine(isLuhnValid, "That card number does not look right — check the digits."),
    expiry: z
      .string()
      .trim()
      .refine((value) => expiryEndOfMonth(value) !== null, "Enter the expiry as MM/YY.")
      .refine((value) => {
        const end = expiryEndOfMonth(value);
        return end === null || end.getTime() >= now.getTime();
      }, "That card has expired."),
    cvc: z
      .string()
      .trim()
      .regex(/^\d{3,4}$/, "Enter the 3 or 4 digit security code."),
  });
}

/** The parsed shapes the schemas produce, which are what the server is sent. */
export type ParsedShipping = ShippingDetails;
export type ParsedPayment = PaymentDetails;
