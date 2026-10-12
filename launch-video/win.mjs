// node win.mjs <normal|maximized|fullscreen>  sets the Benana window state over the browser-level CDP target.
const state = process.argv[2] || 'fullscreen';
const v = await (await fetch('http://127.0.0.1:9333/json/version')).json();
const page = (await (await fetch('http://127.0.0.1:9333/json/list')).json()).find((t) => t.type === 'page' && /5199/.test(t.url));
const ws = new WebSocket(v.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const wait = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); wait.get(d.id)?.(d); };
const send = (method, params) => new Promise((r) => { const n = ++id; wait.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const { result } = await send('Browser.getWindowForTarget', { targetId: page.id });
if (state !== 'normal') await send('Browser.setWindowBounds', { windowId: result.windowId, bounds: { windowState: 'normal' } });
console.log(JSON.stringify(await send('Browser.setWindowBounds', { windowId: result.windowId, bounds: { windowState: state } })));
ws.close();
