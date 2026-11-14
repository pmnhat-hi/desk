// Plan B decryption. Same derivation as planb.py: HKDF-SHA256(secret, salt "desk-planb-v1", info label).
// Works in browsers and in Node (globalThis.crypto.subtle).
const enc = new TextEncoder();
const SALT = enc.encode("desk-planb-v1");
const subtle = globalThis.crypto.subtle;

async function hkdfBits(secret, label, bits = 256) {
  const k = await subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode(label) }, k, bits));
}
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deskKeys(appToken, dataPath) {
  const raw = await hkdfBits(appToken, "aes-gcm key");
  const aes = await subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  const nameRaw = await hkdfBits(appToken, "file names");
  const hmac = await subtle.importKey("raw", nameRaw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const folder = hex(await hkdfBits(dataPath, "public folder", 128));
  return { aes, hmac, folder };
}

async function fileId(keys, mint) {
  return hex(new Uint8Array(await subtle.sign("HMAC", keys.hmac, enc.encode(mint)))).slice(0, 32);
}

async function openEnvelope(keys, name, env) {
  if (!env || env.v !== 1) throw new Error("bad envelope");
  const pt = await subtle.decrypt({ name: "AES-GCM", iv: unb64(env.iv), additionalData: enc.encode(name) }, keys.aes, unb64(env.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

if (typeof module !== "undefined") module.exports = { deskKeys, fileId, openEnvelope };
else Object.assign(globalThis, { deskKeys, fileId, openEnvelope });
