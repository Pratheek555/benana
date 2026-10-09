const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function randomToken(byteLength = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256(value: string): Promise<string> {
  return bytesToBase64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  );
}

async function encryptionKey(encodedKey: string): Promise<CryptoKey> {
  const key = base64UrlToBytes(encodedKey);
  if (key.byteLength !== 32)
    throw new Error("TOKEN_ENCRYPTION_KEY must contain 32 bytes");
  return crypto.subtle.importKey("raw", key, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encrypt(
  value: string,
  encodedKey: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(encodedKey),
    encoder.encode(value),
  );
  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`;
}

export async function decrypt(
  value: string,
  encodedKey: string,
): Promise<string> {
  const [iv, ciphertext, extra] = value.split(".");
  if (!iv || !ciphertext || extra) throw new Error("Invalid encrypted value");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(iv) },
    await encryptionKey(encodedKey),
    base64UrlToBytes(ciphertext),
  );
  return decoder.decode(plaintext);
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return sha256(verifier);
}
