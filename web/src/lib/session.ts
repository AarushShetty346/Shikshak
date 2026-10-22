// A short code that links this browser tab to the voice call. It is passed to Bolna in
// userData, and Bolna fills it into every tool call, so the server knows which screen to update.

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

export function getSessionCode(): string {
  const key = "kalam.sessionCode";
  try {
    const saved = sessionStorage.getItem(key);
    if (saved) return saved;
  } catch {
    // storage blocked; a fresh code per load is fine
  }
  let code = "";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
  try {
    sessionStorage.setItem(key, code);
  } catch {
    // ignore
  }
  return code;
}

export const isDev = new URLSearchParams(location.search).has("dev");
