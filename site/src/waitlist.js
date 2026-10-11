// Waitlist: stores emails in Supabase (table public.waitlist, insert-only for anon via RLS).
const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const wl = document.querySelector('.wl');
const form = wl.querySelector('form');
const msg = wl.querySelector('.wl-msg');
const input = form.elements.email;
const go = form.querySelector('.wl-go');

const open = () => { wl.hidden = false; setTimeout(() => input.focus(), 50); };
const close = () => { wl.hidden = true; msg.textContent = ''; msg.className = 'wl-msg'; };

document.querySelectorAll('[data-open-waitlist]').forEach((el) => el.addEventListener('click', open));
wl.querySelector('.wl-x').addEventListener('click', close);
wl.addEventListener('click', (e) => { if (e.target === wl) close(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !wl.hidden) close(); });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = input.value.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) {
    msg.textContent = 'that email looks off.'; msg.className = 'wl-msg err'; return;
  }
  if (!URL || !KEY) {
    msg.textContent = 'waitlist is not configured yet.'; msg.className = 'wl-msg err'; return;
  }
  go.disabled = true;
  try {
    const res = await fetch(`${URL}/rest/v1/waitlist`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ email }),
    });
    if (res.status === 201 || res.status === 204) {
      msg.textContent = "you're on the list."; msg.className = 'wl-msg ok'; input.value = '';
    } else if (res.status === 409 || (await res.text()).includes('duplicate')) {
      msg.textContent = "you're already on the list."; msg.className = 'wl-msg ok';
    } else {
      throw new Error(res.status);
    }
  } catch {
    msg.textContent = 'something broke. try again.'; msg.className = 'wl-msg err';
  } finally {
    go.disabled = false;
  }
});
