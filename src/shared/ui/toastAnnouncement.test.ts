import { describe, it, expect } from "vitest";
import { toastAnnouncement, toastPoliteness } from "@/shared/ui/toastAnnouncement";

describe("toastPoliteness", () => {
  it("interrupts only for the variants that mean something is wrong", () => {
    expect(toastPoliteness("danger")).toBe("assertive");
    expect(toastPoliteness("warning")).toBe("assertive");
  });

  it("does not interrupt for a result the user asked for", () => {
    // The reflex is assertive on success, which cuts off whatever the user was
    // reading to tell them the thing they requested happened.
    expect(toastPoliteness("success")).toBe("polite");
    expect(toastPoliteness("default")).toBe("polite");
  });
});

describe("toastAnnouncement", () => {
  it("is the title alone when there is no description", () => {
    expect(toastAnnouncement("Saved")).toBe("Saved");
  });

  it("joins title and description into one utterance", () => {
    expect(toastAnnouncement("Upload failed", "The file is larger than 10 MB")).toBe(
      "Upload failed. The file is larger than 10 MB",
    );
  });

  it("ignores a blank description rather than trailing a full stop", () => {
    expect(toastAnnouncement("Saved", "   ")).toBe("Saved");
  });
});
