// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseLockfile, splitPackageKey } from "./lockfile.ts";

const lockfile = (body: string): string => `lockfileVersion: "9.0"\n${body}`;

const minimal = lockfile(`
importers:
  .:
    dependencies:
      react:
        specifier: ^19.0.0
        version: 19.2.7
    devDependencies:
      vitest:
        specifier: ^4.1.11
        version: 4.1.11
packages:
  react@19.2.7:
    resolution: { integrity: sha512-aaa== }
  "@types/react@19.2.17":
    resolution: { integrity: sha512-bbb== }
  vitest@4.1.11:
    resolution: { integrity: sha512-ccc== }
`);

describe("splitPackageKey", () => {
  it("splits an unscoped and a scoped key on the last @", () => {
    expect(splitPackageKey("react@19.2.7")).toEqual({ name: "react", version: "19.2.7" });
    expect(splitPackageKey("@types/react@19.2.17")).toEqual({
      name: "@types/react",
      version: "19.2.17",
    });
  });

  it("rejects a key with no version rather than inventing one", () => {
    // `@scope/name` has an `@` at index 0, which is a scope marker. Reading it
    // as a separator would yield a package with an empty name and a version of
    // "scope/name", and the registry request for it would 404 — reported as a
    // missing package rather than as the malformed lockfile it is.
    expect(() => splitPackageKey("@scope/name")).toThrow(/not name@version/);
    expect(() => splitPackageKey("react")).toThrow(/not name@version/);
  });
});

describe("parseLockfile", () => {
  it("reads name, version and integrity for every package", () => {
    const packages = parseLockfile(minimal, "lock");
    expect(packages).toHaveLength(3);
    expect(packages.map((p) => `${p.name}@${p.version}`)).toEqual([
      "@types/react@19.2.17",
      "react@19.2.7",
      "vitest@4.1.11",
    ]);
    expect(packages.find((p) => p.name === "react")?.integrity).toBe("sha512-aaa==");
  });

  it("marks what the root importer depends on directly", () => {
    const packages = parseLockfile(minimal, "lock");
    const byName = new Map(packages.map((p) => [p.name, p]));
    expect(byName.get("react")).toMatchObject({ production: true, development: false });
    expect(byName.get("vitest")).toMatchObject({ production: false, development: true });
    // A transitive package is neither, which is the common case.
    expect(byName.get("@types/react")).toMatchObject({ production: false, development: false });
  });

  it("classifies resolutions that carry no publisher signature", () => {
    const packages = parseLockfile(
      lockfile(`
packages:
  forked@1.0.0:
    resolution:
      { type: git, repo: https://github.com/someone/forked.git, commit: abc123 }
  vendored@1.0.0:
    resolution: { tarball: https://example.test/vendored-1.0.0.tgz }
  local@1.0.0:
    resolution: { type: directory, directory: ../local }
`),
      "lock",
    );
    expect(packages.map((p) => [p.name, p.kind])).toEqual([
      ["forked", "git"],
      ["local", "directory"],
      ["vendored", "tarball"],
    ]);
    expect(packages.find((p) => p.name === "forked")?.location).toBe(
      "https://github.com/someone/forked.git",
    );
  });

  it("refuses a lockfile version whose shape it has not been read against", () => {
    // The two keys this reads are `packages:` and `importers:`. A format that
    // renamed either would parse fine and yield nothing, and a gate that
    // verifies zero packages reports success. Failing closed on an unknown
    // version is the only reading that cannot go quiet.
    expect(() =>
      parseLockfile('lockfileVersion: "7.0"\npackages:\n  a@1.0.0: {}\n', "lock"),
    ).toThrow(/lockfileVersion "7.0" is not supported/);
  });

  it("refuses a lockfile with no packages at all", () => {
    expect(() => parseLockfile(lockfile("packages: {}\n"), "lock")).toThrow(/is empty/);
  });

  it("reports a package whose resolution has no integrity instead of skipping it", () => {
    const packages = parseLockfile(
      lockfile("packages:\n  odd@1.0.0:\n    resolution: {}\n"),
      "lock",
    );
    expect(packages[0]).toMatchObject({ name: "odd", integrity: null, kind: "unknown" });
  });

  it("fails on input that is not a mapping", () => {
    expect(() => parseLockfile("- a\n- b\n", "lock")).toThrow(/must be a mapping/);
    expect(() => parseLockfile("{{{", "lock")).toThrow(/not valid YAML/);
  });
});
