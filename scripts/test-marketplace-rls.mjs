// Live security test for the marketplace schema (supabase/migrations/20261011120000_marketplace.sql).
// Creates throwaway users, checks every row-level rule, then deletes them. Needs the supabase CLI
// logged in and the project linked. Run: node scripts/test-marketplace-rls.mjs
import { execFileSync } from 'node:child_process';
const ref = 'rqoponeauoiodaanbjxe';
const URL = `https://${ref}.supabase.co`;
const keys = JSON.parse(execFileSync('supabase', ['projects', 'api-keys', '--project-ref', ref, '-o', 'json'], { encoding: 'utf8' }));
const ANON = keys.find((k) => k.name === 'anon').api_key;
const SR = keys.find((k) => k.name === 'service_role').api_key;
const sql = (q) => execFileSync('supabase', ['db', 'query', '--linked', q], { cwd: process.env.HOME + '/code-projects/benana', encoding: 'utf8' });
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

const admin = (path, init = {}) => fetch(`${URL}${path}`, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
const stamp = Date.now();
const users = {};
for (const name of ['owner', 'voter', 'r1', 'r2', 'mod']) {
  const email = `rls-${name}-${stamp}@example.com`;
  const r = await (await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password: 'Test-pass-12345', email_confirm: true }) })).json();
  const t = await (await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Test-pass-12345' }) })).json();
  users[name] = { id: r.id, token: t.access_token };
}
const as = (who) => (path, init = {}) => fetch(`${URL}${path}`, { ...init, headers: { apikey: ANON, Authorization: `Bearer ${who ? users[who].token : ANON}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers || {}) } });
const anon = as(null);
const post = (who, table, body) => as(who)(`/rest/v1/${table}`, { method: 'POST', body: JSON.stringify(body) });

try {
  // Listings
  let r = await post('owner', 'listings', { slug: `sky-${stamp}`, name: 'Sky Launcher', summary: 'test', source_repo_url: 'https://github.com/x/y' });
  const listing = (await r.json())[0];
  check('owner can create a listing', r.status === 201);
  check('profile created from new user', JSON.parse(sql(`select count(*)::int as n from public.profiles where id='${users.owner.id}'`).match(/\{[\s\S]*\}/)[0]).rows?.[0]?.n === 1 || /"n": 1/.test(sql(`select count(*)::int as n from public.profiles where id='${users.owner.id}'`)));
  r = await anon(`/rest/v1/listings?id=eq.${listing.id}&select=id`);
  check('anyone can read a live listing', (await r.json()).length === 1);
  r = await as('voter')(`/rest/v1/listings?id=eq.${listing.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'hacked' }) });
  check('another user cannot edit it', (await r.json()).length === 0);

  // Versions
  const v = { listing_id: listing.id, number: 1, jar_path: `${users.owner.id}/${listing.id}/Mod.jar`, jar_sha256: 'a'.repeat(64), jar_bytes: 1000, commit_sha: 'b'.repeat(40) };
  r = await post('voter', 'versions', v);
  check('another user cannot add a version', r.status >= 400);
  r = await post('owner', 'versions', v);
  check('owner can add a version', r.status === 201);

  // Votes: 7-day rule, one vote, no self-vote
  r = await post('voter', 'votes', { listing_id: listing.id });
  check('a new account cannot vote (7-day rule)', r.status >= 400);
  sql(`update auth.users set created_at = now() - interval '8 days' where id in ('${users.voter.id}','${users.owner.id}')`);
  r = await post('voter', 'votes', { listing_id: listing.id });
  check('an 8-day-old account can vote', r.status === 201);
  r = await post('voter', 'votes', { listing_id: listing.id });
  check('a second vote is refused', r.status === 409);
  r = await post('owner', 'votes', { listing_id: listing.id });
  check('an owner cannot vote for their own listing', r.status >= 400);

  // Reviews and replies
  r = await post('voter', 'reviews', { listing_id: listing.id, stars: 4, body: 'works great' });
  const review = (await r.json())[0];
  check('a user can review', r.status === 201);
  r = await post('voter', 'reviews', { listing_id: listing.id, stars: 1, body: 'again' });
  check('a second review is refused', r.status === 409);
  r = await post('owner', 'reviews', { listing_id: listing.id, stars: 5, body: 'self' });
  check('an owner cannot review their own listing', r.status >= 400);
  r = await post('voter', 'review_replies', { review_id: review.id, body: 'reply' });
  check('a non-owner cannot reply to a review', r.status >= 400);
  r = await post('owner', 'review_replies', { review_id: review.id, body: 'thanks' });
  check('the owner can reply', r.status === 201);
  r = await anon(`/rest/v1/listing_stats?listing_id=eq.${listing.id}`);
  const stats = (await r.json())[0];
  check('stats show 1 vote and 4.00 stars', stats?.votes === 1 && Number(stats?.stars) === 4, JSON.stringify(stats));

  // Reports: hidden after 3
  for (const who of ['voter', 'r1', 'r2']) await post(who, 'reports', { listing_id: listing.id, category: 'spam', reason: 'test report' });
  r = await anon(`/rest/v1/listings?id=eq.${listing.id}&select=id`);
  check('3 reports hide the listing from the public', (await r.json()).length === 0);
  r = await as('owner')(`/rest/v1/listings?id=eq.${listing.id}&select=status`);
  check('the owner still sees it as hidden', (await r.json())[0]?.status === 'hidden');
  r = await as('r1')(`/rest/v1/reports?listing_id=eq.${listing.id}`);
  check('a reporter sees only their own report', (await r.json()).length === 1);
  r = await as('owner')(`/rest/v1/listings?id=eq.${listing.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'live' }) });
  check('the owner cannot reinstate a hidden listing', r.status >= 400);
  sql(`insert into public.moderators (user_id) values ('${users.mod.id}')`);
  r = await as('mod')(`/rest/v1/listings?id=eq.${listing.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'live' }) });
  check('a moderator can reinstate it', r.status === 200 && (await r.json())[0]?.status === 'live');

  // Cap of 10
  for (let i = 0; i < 9; i++) await post('owner', 'listings', { slug: `cap-${stamp}-${i}`, name: `Cap ${i}`, source_repo_url: 'https://github.com/x/y' });
  r = await post('owner', 'listings', { slug: `cap-${stamp}-x`, name: 'Eleventh', source_repo_url: 'https://github.com/x/y' });
  check('an 11th listing is refused', r.status >= 400);

  // Storage: own folder only
  const up = (who, path) => fetch(`${URL}/storage/v1/object/jars/${path}`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${users[who].token}`, 'Content-Type': 'application/java-archive' }, body: 'jar' });
  r = await up('owner', `${users.owner.id}/${listing.id}/Mod.jar`);
  globalThis.uploaded = `${users.owner.id}/${listing.id}/Mod.jar`;
  check('owner can upload to their own folder', r.status === 200);
  r = await up('voter', `${users.owner.id}/${listing.id}/Evil.jar`);
  check("a user cannot upload into someone else's folder", r.status >= 400);
} finally {
  if (globalThis.uploaded) await admin('/storage/v1/object/jars', { method: 'DELETE', body: JSON.stringify({ prefixes: [globalThis.uploaded] }) });
  for (const u of Object.values(users)) if (u.id) await admin(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' });
  console.log(`\n${pass} passed, ${fail} failed; test users deleted`);
}
