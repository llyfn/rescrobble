/** One approval of rescrobble by one Last.fm account. */
export interface UserSession {
  username: string;
  sessionKey: string;
}

const NONCE_BYTES = 12;

/**
 * Encrypts and authenticates the session with AES-256-GCM, as base64url(nonce ‖ ciphertext ‖ tag).
 * The Web App's cookie and the Extension's bearer token carry the same value. A value that fails
 * to decrypt (tampered, truncated, or made with another key) reads as no session at all.
 */
export class SessionCodec {
  private readonly key: Promise<CryptoKey>;

  constructor(rawKey: Uint8Array) {
    this.key = crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  async encode(session: UserSession): Promise<string> {
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    const plain = new TextEncoder().encode(JSON.stringify({ username: session.username, sessionKey: session.sessionKey }));
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, await this.key, plain));
    const bytes = new Uint8Array(NONCE_BYTES + sealed.length);
    bytes.set(nonce);
    bytes.set(sealed, NONCE_BYTES);
    return toBase64Url(bytes);
  }

  async decode(value: string): Promise<UserSession | null> {
    try {
      const bytes = fromBase64Url(value);
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, NONCE_BYTES) }, await this.key, bytes.subarray(NONCE_BYTES));
      const parsed = JSON.parse(new TextDecoder().decode(plain)) as Partial<UserSession>;
      return typeof parsed.username === "string" && typeof parsed.sessionKey === "string"
        ? { username: parsed.username, sessionKey: parsed.sessionKey }
        : null;
    } catch {
      return null;
    }
  }
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
}
