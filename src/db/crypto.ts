import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

let keyCache: Map<number, Buffer> | null = null;
let currentVersion: number | null = null;

function loadKeys(): { keys: Map<number, Buffer>; currentVersion: number } {
  if (keyCache && currentVersion !== null) {
    return { keys: keyCache, currentVersion };
  }

  const keys = new Map<number, Buffer>();

  // Load keys: CREDENTIALS_KEY_V1, CREDENTIALS_KEY_V2, etc.
  for (let v = 1; v <= 10; v++) {
    const envKey = process.env[`CREDENTIALS_KEY_V${v}`];
    if (envKey) {
      const keyBuffer = Buffer.from(envKey, "base64");
      if (keyBuffer.length !== 32) {
        throw new Error(`CREDENTIALS_KEY_V${v} must be 32 bytes base64`);
      }
      keys.set(v, keyBuffer);
    }
  }

  if (keys.size === 0) {
    throw new Error("No CREDENTIALS_KEY_V* environment variables set");
  }

  const versionStr = process.env.CREDENTIALS_CURRENT_KEY_VERSION;
  const version = versionStr
    ? parseInt(versionStr, 10)
    : Math.max(...keys.keys());

  if (!keys.has(version)) {
    throw new Error(`CREDENTIALS_CURRENT_KEY_VERSION=${version} key not found`);
  }

  keyCache = keys;
  currentVersion = version;

  return { keys, currentVersion: version };
}

function getKey(version: number): Buffer {
  const { keys } = loadKeys();
  const key = keys.get(version);
  if (!key) {
    throw new Error(`Encryption key version ${version} not found`);
  }
  return key;
}

export interface EncryptedData {
  ciphertext: Buffer;
  iv: Buffer;
  keyVersion: number;
}

export function encryptCredentials(
  plaintext: Record<string, unknown>
): EncryptedData {
  const { keys, currentVersion } = loadKeys();
  const key = keys.get(currentVersion)!;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const json = JSON.stringify(plaintext);
  const encrypted = Buffer.concat([
    cipher.update(json, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();
  const ciphertext = Buffer.concat([encrypted, authTag]);

  return { ciphertext, iv, keyVersion: currentVersion };
}

export function decryptCredentials(
  data: EncryptedData
): Record<string, unknown> {
  const key = getKey(data.keyVersion);

  const authTag = data.ciphertext.subarray(-AUTH_TAG_LENGTH);
  const encrypted = data.ciphertext.subarray(0, -AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, data.iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString("utf8"));
}

export function rotateCredentials(data: EncryptedData): EncryptedData | null {
  const { currentVersion } = loadKeys();
  if (data.keyVersion === currentVersion) {
    return null;
  }
  const plaintext = decryptCredentials(data);
  return encryptCredentials(plaintext);
}

export function getCurrentKeyVersion(): number {
  const { currentVersion } = loadKeys();
  return currentVersion;
}
