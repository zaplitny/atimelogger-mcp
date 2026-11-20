import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const read = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), "utf8"));
const pkg = read("package.json");
const server = read("server.json");

test("the MCP Registry manifest tracks the package version", () => {
  assert.equal(server.version, pkg.version, "server.json version drifted from package.json");
  assert.equal(server.packages[0].version, pkg.version, "server.json packages[0].version drifted");
  assert.equal(server.packages[0].identifier, pkg.name);
  assert.equal(server.name, pkg.mcpName, "registry name must match the mcpName npm verifies");
});

test("the changelog documents the version being shipped", () => {
  const changelog = readFileSync(fileURLToPath(new URL("../CHANGELOG.md", import.meta.url)), "utf8");
  assert.ok(changelog.includes(`## [${pkg.version}]`), `CHANGELOG.md has no section for ${pkg.version}`);
  assert.ok(changelog.includes(`[${pkg.version}]: https://`), `CHANGELOG.md has no compare link for ${pkg.version}`);
});

test("both binaries and the library entry point exist in the build", () => {
  for (const [name, rel] of [...Object.entries(pkg.bin), ["main", pkg.main], ["types", pkg.types]]) {
    assert.ok(existsSync(fileURLToPath(new URL(`../${rel}`, import.meta.url))), `${name} -> ${rel} is missing`);
  }
});

test("the export map resolves to files that exist and stays require()-able", () => {
  const entry = pkg.exports["."];
  assert.ok(entry.default, 'the "." export needs a default condition so require() works, not just import');
  for (const target of Object.values(entry)) {
    assert.ok(existsSync(fileURLToPath(new URL(`../${target}`, import.meta.url))), `${target} is missing`);
  }
});

test("the tarball holds only what src/ compiles to, besides the README, the license and package.json", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  // --ignore-scripts: list the build `npm test` just made instead of building again
  const [pack] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8" }));
  const sources = readdirSync(new URL("../src", import.meta.url), { recursive: true })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => f.split("\\").join("/").replace(/\.ts$/, ""));
  const expected = [
    "LICENSE", "README.md", "package.json",
    ...sources.flatMap((f) => [`dist/${f}.js`, `dist/${f}.d.ts`]),
  ].sort();
  assert.deepEqual(pack.files.map((f) => f.path).sort(), expected, "a file in the tarball that no source in src/ builds");
});
