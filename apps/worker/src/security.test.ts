import { describe, expect, it } from "vitest";
import {
  decrypt,
  encrypt,
  pkceChallenge,
  randomToken,
  sha256,
} from "./security";

const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
describe("credential security", () => {
  it("encrypts with a fresh IV and authenticates ciphertext", async () => {
    const first = await encrypt("secret-token", key);
    const second = await encrypt("secret-token", key);
    expect(first).not.toBe(second);
    expect(first).not.toContain("secret-token");
    expect(await decrypt(first, key)).toBe("secret-token");
    const separator = first.indexOf(".") + 4;
    const tampered = `${first.slice(0, separator)}${first[separator] === "A" ? "B" : "A"}${first.slice(separator + 1)}`;
    await expect(decrypt(tampered, key)).rejects.toThrow();
  });
  it("creates opaque tokens, stable hashes, and an S256 challenge", async () => {
    const token = randomToken();
    expect(token).toMatch(/^[\w-]+$/);
    expect(await sha256(token)).toBe(await sha256(token));
    expect(await pkceChallenge("verifier")).toBe(await sha256("verifier"));
  });
});
