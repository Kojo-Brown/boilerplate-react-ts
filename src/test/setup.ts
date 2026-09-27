import "@testing-library/jest-dom";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "@/shared/mocks/server";
import { announcer } from "@/shared/a11y/announcer";
import { installStorageFallback } from "@/test/localStorage";
import { installMatchMediaFallback } from "@/test/matchMedia";

installStorageFallback();
installMatchMediaFallback();

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
  /*
   * The announcer is a module singleton, so anything a test announced and did
   * not render regions for is still queued when the next test starts. Left
   * alone, a test that mounts `<LiveRegions>` drains the previous test's
   * messages and asserts on them — the kind of failure that only appears when
   * the suite runs in a particular order.
   */
  announcer.reset();
});
afterAll(() => {
  server.close();
});
