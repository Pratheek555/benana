const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const secrets = require("../electron/lib/publish/secrets.cjs");

// AWS access key IDs: "AKIA" plus 16 characters. Fake values only.
const PLANTED = "aws_access_key_id = AKIAQWERTYUIOPASDFGH\n";

test("clean text passes the scan", async () => {
  const res = await secrets.scanText("note.txt", "hello world\n");
  assert.equal(res.clean, true);
  assert.deepEqual(res.findings, []);
  assert.equal(res.error, null);
});

test("a planted key blocks the scan, and findings never include the secret", async () => {
  const res = await secrets.scanText("transcript.jsonl", PLANTED);
  assert.equal(res.clean, false);
  assert.equal(res.findings.length, 1);
  assert.equal(res.findings[0].rule, "aws-access-token");
  assert.equal(res.findings[0].line, 1);
  assert.ok(!JSON.stringify(res).includes("AKIAQWERTYUIOPASDFGH"));
});

test("a missing scanner fails closed", async () => {
  const res = await secrets.scanText("note.txt", "hello\n", { bin: "/nonexistent/gitleaks" });
  assert.equal(res.clean, false);
  assert.match(res.error, /not installed/);
});

test("a checkpoint with a secret in its transcript blocks the publish gate", async () => {
  const execute = async (args) => {
    if (args.includes("--json")) return { ok: true, out: '{"checkpoint_id":"ck1","files_touched":["a.js"]}' };
    if (args.includes("--transcript")) return { ok: true, out: `{"text":"${PLANTED.trim()}"}\n` };
    return { ok: false, out: "" };
  };
  const gate = await secrets.publishGate("/tmp", ["ck1"], { execute });
  assert.equal(gate.ok, false);
  assert.equal(gate.blocked[0].checkpointId, "ck1");
  assert.equal(gate.blocked[0].findings[0].rule, "aws-access-token");
});

test("a clean checkpoint passes the publish gate", async () => {
  const execute = async (args) => ({ ok: true, out: args.includes("--json") ? '{"checkpoint_id":"ck2"}' : '{"text":"hello"}\n' });
  const gate = await secrets.publishGate("/tmp", ["ck2"], { execute });
  assert.equal(gate.ok, true);
});

test("an unreadable checkpoint blocks the gate rather than passing", async () => {
  const execute = async () => ({ ok: false, out: "" });
  const gate = await secrets.publishGate("/tmp", ["ck3"], { execute });
  assert.equal(gate.ok, false);
  assert.match(gate.blocked[0].error, /could not read/);
});
