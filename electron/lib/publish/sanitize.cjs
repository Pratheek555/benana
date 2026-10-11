// Scrubs identity details out of text before it is published, and flags strings that look like
// secrets no scanner rule knows about. Runs before the secret gate (secrets.cjs).
const os = require('node:os');

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Shannon entropy in bits per character.
function entropy(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) || 0) + 1);
  let h = 0;
  for (const n of counts.values()) { const p = n / s.length; h -= p * Math.log2(p); }
  return h;
}

// Long, random-looking tokens (mixed case and digits, high entropy) that are not hashes we expect.
const TOKEN = /[A-Za-z0-9_\-+]{24,}={0,2}/g; // no "/": paths are not secrets
const EXPECTED = [/^[0-9a-f]{40}$/, /^[0-9a-f]{64}$/, /^[0-9A-Z]{26}$/, /^[0-9a-fA-F]{8}-[0-9a-fA-F-]{27}$/,
  /^(msg|toolu|srvtoolu|req|call|resp|run|thread|item)_[A-Za-z0-9]+$/]; // git sha, sha256, ULID, uuid, agent protocol IDs

function suspicious(text) {
  const out = [];
  for (const m of text.matchAll(TOKEN)) {
    const t = m[0];
    if (EXPECTED.some((re) => re.test(t))) continue;
    if (/^[A-Za-z_\-/]+$/.test(t)) continue; // words and paths, no digits
    if (!(/[a-z]/.test(t) && /[A-Z]/.test(t) && /[0-9]/.test(t))) continue;
    if (entropy(t) < 4.0) continue;
    const line = text.slice(0, m.index).split('\n').length;
    out.push({ line, length: t.length, preview: `${t.slice(0, 4)}…` });
  }
  return out;
}

// identity: { home, user, host, emails } — defaults to the current machine.
function sanitize(text, identity = {}) {
  const home = identity.home ?? os.homedir();
  const user = identity.user ?? os.userInfo().username;
  const host = identity.host ?? os.hostname();
  const emails = identity.emails ?? [];
  const replaced = { home: 0, user: 0, host: 0, email: 0 };
  let out = String(text);
  const swap = (re, to, key) => { out = out.replace(re, () => { replaced[key] += 1; return to; }); };

  if (home) swap(new RegExp(escape(home), 'g'), '~', 'home');
  // macOS / Linux / Windows home roots for any user, not just this one.
  swap(/\/(Users|home)\/[A-Za-z0-9._-]+/g, '/$HOME_OTHER', 'home');
  swap(/[A-Za-z]:\\\\?Users\\\\?[A-Za-z0-9._-]+/g, '%USERPROFILE%', 'home');
  for (const e of emails) if (e) swap(new RegExp(escape(e), 'gi'), '<email>', 'email');
  swap(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>', 'email');
  if (host && host.length > 3) swap(new RegExp(escape(host), 'gi'), '<host>', 'host');
  if (user && user.length > 2) swap(new RegExp(`\\b${escape(user)}\\b`, 'g'), '<user>', 'user');

  return { text: out, replaced, suspicious: suspicious(out) };
}

module.exports = { sanitize, suspicious, entropy };
