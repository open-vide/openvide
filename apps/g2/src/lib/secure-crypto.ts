/**
 * Client-side encryption for locally persisted secrets.
 *
 * Mirrors the even-kitchen approach:
 * - AES-GCM encryption with a non-extractable key stored in IndexedDB
 * - ciphertext persisted in bridge-backed app storage
 * - graceful migration from older plaintext values
 *
 * This protects secrets at rest from casual app-storage inspection.
 * It does not protect against same-origin JavaScript execution.
 */

const DB_NAME = 'openvide-g2-crypto';
const STORE_NAME = 'keys';
const CRYPTO_KEY_ID = 'master';

let secureCryptoDisabledForSession = false;
let secureCryptoWarned = false;

class SecureCryptoUnavailableError extends Error {
  constructor() {
    super('Secure browser crypto is unavailable');
    this.name = 'SecureCryptoUnavailableError';
  }
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getOrCreateMasterKey(): Promise<CryptoKey> {
  if (secureCryptoDisabledForSession) throw new SecureCryptoUnavailableError();

  let db: IDBDatabase | null = null;
  try {
    db = await openDB();

    const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
      const tx = db!.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(CRYPTO_KEY_ID);
      req.onsuccess = () => resolve(req.result as CryptoKey | undefined);
      req.onerror = () => reject(req.error);
    });

    if (existing) {
      return existing;
    }

    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );

    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).put(key, CRYPTO_KEY_ID);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    return key;
  } catch (error) {
    secureCryptoDisabledForSession = true;
    if (!secureCryptoWarned) {
      secureCryptoWarned = true;
      console.warn('OpenVide secure storage is unavailable for this browser session; encrypted bridge/STT secrets will stay untouched until access is restored.', error);
    }
    throw new SecureCryptoUnavailableError();
  } finally {
    db?.close();
  }
}

export type SecureCryptoResult<T> = {
  value: T;
  secure: boolean;
  available: boolean;
};

export function isSecureCryptoDisabledForSession(): boolean {
  return secureCryptoDisabledForSession;
}

export async function encryptValue(plaintext: string): Promise<string> {
  return (await encryptValueDetailed(plaintext)).value;
}

export async function encryptValueDetailed(plaintext: string): Promise<SecureCryptoResult<string>> {
  if (!plaintext) {
    return {
      value: '',
      secure: false,
      available: true,
    };
  }
  try {
    const key = await getOrCreateMasterKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoded,
    );

    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return {
      value: btoa(String.fromCharCode(...combined)),
      secure: true,
      available: true,
    };
  } catch {
    // Fallback keeps existing behavior for the current runtime without destroying stored ciphertext.
    return {
      value: plaintext,
      secure: false,
      available: false,
    };
  }
}

export async function decryptValue(encrypted: string): Promise<string> {
  return (await decryptValueDetailed(encrypted)).value;
}

export async function decryptValueDetailed(encrypted: string): Promise<SecureCryptoResult<string>> {
  if (!encrypted) {
    return {
      value: '',
      secure: false,
      available: true,
    };
  }
  try {
    const key = await getOrCreateMasterKey();
    const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext,
    );
    return {
      value: new TextDecoder().decode(decrypted),
      secure: true,
      available: true,
    };
  } catch {
    if (secureCryptoDisabledForSession) {
      return {
        value: '',
        secure: false,
        available: false,
      };
    }
    // Migration path from older plaintext persistence.
    return {
      value: encrypted,
      secure: false,
      available: true,
    };
  }
}

export async function encryptJson<T>(value: T): Promise<string> {
  return encryptValue(JSON.stringify(value));
}

export async function encryptJsonDetailed<T>(value: T): Promise<SecureCryptoResult<string>> {
  return encryptValueDetailed(JSON.stringify(value));
}

export async function decryptJson<T>(encrypted: string, fallback: T): Promise<T> {
  return (await decryptJsonDetailed(encrypted, fallback)).value;
}

export async function decryptJsonDetailed<T>(encrypted: string, fallback: T): Promise<SecureCryptoResult<T>> {
  if (!encrypted) {
    return {
      value: fallback,
      secure: false,
      available: true,
    };
  }
  try {
    const raw = await decryptValueDetailed(encrypted);
    if (!raw.available) {
      return {
        value: fallback,
        secure: false,
        available: false,
      };
    }
    return {
      value: JSON.parse(raw.value) as T,
      secure: raw.secure,
      available: true,
    };
  } catch {
    return {
      value: fallback,
      secure: false,
      available: true,
    };
  }
}
