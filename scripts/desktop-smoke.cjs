const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { execFileSync } = require("node:child_process");
const { app, BrowserWindow } = require("electron");

process.env.BENANA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "benana-smoke-"));
process.env.BENANA_AUTOOPEN = "0";
delete process.env.BENANA_DEV;
delete process.env.BENANA_SCREENSHOT;
const output = path.resolve(__dirname, "../.audit/screenshots");
fs.mkdirSync(output, { recursive: true });
require("../electron/lib/github.cjs").openIssues = async () => [];
require("../electron/lib/artifacts.cjs").configured = () => false;
require("../electron/main.cjs");

app.whenReady().then(async () => {
  // main.cjs opens its window after tracing initializes, so it may not exist yet.
  const window = BrowserWindow.getAllWindows()[0] || (await once(app, "browser-window-created"))[1];
  const errors = [];
  window.webContents.on("console-message", (_event, level, message) => {
    if (level === 3) errors.push(message);
  });
  const read = (expression) => window.webContents.executeJavaScript(expression);
  const waitFor = async (expression) => {
    for (let count = 0; count < 100; count += 1) {
      if (await read(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for ${expression}`);
  };
  const click = async (text) => {
    await read(`(() => {
      const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === ${JSON.stringify(text)});
      if (!button) throw new Error('Missing button ' + ${JSON.stringify(text)});
      button.click();
    })()`);
  };
  const capture = async (name) => {
    fs.writeFileSync(path.join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG());
  };
  const fill = async (index, value) => {
    await read(`(() => {
      const input = document.querySelectorAll('.project-setup input')[${index}];
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  };
  try {
    if (window.webContents.isLoading()) await once(window.webContents, "did-finish-load");
    await waitFor("Boolean(window.benana?.invoke && document.body.innerText.includes('Open'))");
    assert.equal(await read("Boolean(document.querySelector('.project-setup'))"), true);
    await capture("desktop-setup");
    await fill(0, "https://example.com/owner/repository");
    await click("Open project");
    await waitFor("document.querySelector('.project-setup button.primary')?.textContent.trim() === 'Open project'");
    const visibleError = await read("document.querySelector('.project-setup [role=alert]')?.textContent || ''");
    assert.match(visibleError, /GitHub|owner\/name/, "Rejected repository input must show an error on the setup screen");
    console.log(`Setup error displayed: ${visibleError}`);
    await capture("desktop-setup-error");
    const checkout = path.join(process.env.BENANA_DATA_DIR, "checkout");
    fs.mkdirSync(checkout);
    execFileSync("git", ["init", checkout], { windowsHide: true });
    await fill(0, "https://github.com/Pratheek555/sporo");
    await fill(1, checkout);
    await click("Open project");
    await waitFor("Boolean(document.querySelector('.workspace'))");
    const opened = await read("window.benana.invoke('project:summary')");
    assert.equal(opened.ok, true);
    assert.equal(opened.data.repo, "Pratheek555/sporo");
    assert.equal(opened.data.repoPath, checkout);
    assert.equal(JSON.parse(fs.readFileSync(path.join(process.env.BENANA_DATA_DIR, "config.json"), "utf8")).last.repo, "Pratheek555/sporo");
    console.log(`Project opened: ${opened.data.repo}`);
    await capture("desktop-opened-project");
    for (const repo of ["Pratheek555/sporo", "https://github.com/Pratheek555/sporo.git/"]) {
      const result = await read(`window.benana.invoke('project:open', ${JSON.stringify({ repo, repoPath: checkout })})`);
      assert.equal(result.ok, true, result.error);
      assert.equal(result.data.repo, "Pratheek555/sporo");
    }
    for (const repo of ["https://example.com/Pratheek555/sporo", "https://github.com/Pratheek555/sporo/issues", "https://github.com/Pratheek555/sporo?tab=readme", "https://user@github.com/Pratheek555/sporo"]) {
      const result = await read(`window.benana.invoke('project:open', ${JSON.stringify({ repo, repoPath: checkout })})`);
      assert.equal(result.ok, false, `Unexpectedly accepted ${repo}`);
      assert.equal((await read("window.benana.invoke('project:summary')")).data.repo, "Pratheek555/sporo");
    }
    await window.loadFile(path.resolve(__dirname, "../dist/index.html"), { query: { demo: "1" } });
    await waitFor("document.body.innerText.includes('What needs fixing?')");
    await click("Make checkout recovery safe after a failed verificationAttempt 1 | failed");
    await waitFor("document.body.innerText.includes('Apply and retry')");
    assert.equal(await read("Boolean(document.querySelector('.composer[aria-disabled=true]'))"), true);
    await read("document.querySelector('.messages').scrollTop = document.querySelector('.messages').scrollHeight");
    await read("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await capture("recovery-preview");
    await click("Apply and retry");
    await waitFor("document.querySelector('.run-actions')?.innerText.includes('Running')");
    assert.equal(await read("Boolean(document.querySelector('.success-card'))"), false);
    await waitFor("document.querySelector('.run-actions')?.innerText.includes('Verifying')");
    assert.equal(await read("Boolean(document.querySelector('.success-card'))"), false);
    await waitFor("Boolean(document.querySelector('.success-card'))");
    assert.equal(await read("document.querySelector('.attempt-timeline').innerText.includes('#1 failed')"), true);
    await click("checks");
    await capture("verified-attempt");
    await click("#1 failed");
    await waitFor("document.body.innerText.includes('Apply and retry')");
    assert.equal(await read("Boolean(document.querySelector('.success-card'))"), false);
    await click("Entire graph");
    await waitFor("document.querySelectorAll('canvas').length > 0");
    await capture("repository-graph");
    await click("History");
    await waitFor("document.body.innerText.includes('Before retry refactor')");
    await capture("checkpoint-history");
    await click("Connections");
    await waitFor("document.body.innerText.includes('Linked execution evidence')");
    await capture("partner-connections");
    assert.deepEqual(errors, []);
    console.log(`Desktop smoke passed. Screenshots saved to ${output}`);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
