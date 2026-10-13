// Live run 38324799614: on Linux, Claude Code's sandbox gives Bash its own network namespace (bwrap --unshare-net), so
// the agent's curl to the mock merchant and its signer client's POST to the signer host — both 127.0.0.1 — were
// "Connection refused". The mock world therefore ADVERTISES a configurable public host (SP6_MOCK_HOST, e.g. a runner
// /etc/hosts name for 127.0.0.1) that the sandbox's egress proxy can reach, while every server still BINDS 127.0.0.1.
// Unset, nothing changes.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { publicHost } from "../mock/lib/public-host.mjs";
import { runSettings } from "./adapters/cc-world.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("publicHost: 127.0.0.1 unless SP6_MOCK_HOST names a bare hostname", () => {
  assert.equal(publicHost({}), "127.0.0.1");
  assert.equal(publicHost({ SP6_MOCK_HOST: "" }), "127.0.0.1");
  assert.equal(publicHost({ SP6_MOCK_HOST: "sp6-mock" }), "sp6-mock");
  for (const bad of ["sp6-mock:8080", "http://sp6-mock", "a b", "sp6-mock/x", "-x", "x".repeat(64), "evil.com\nx"]) {
    assert.throws(() => publicHost({ SP6_MOCK_HOST: bad }), /SP6_MOCK_HOST/, bad);
  }
});

test("runSettings: the sandbox allows the advertised mock host (and keeps loopback)", () => {
  const confine = { sandboxTmp: "/tmp/sbx", mktempGlobs: [], denyRead: [], denyWrite: [], allowRead: [] };
  const domains = (env) => runSettings({ runRoot: "/r", home: "/h", hookWrapper: "/w", node: "/n", confine, env }).sandbox.network.allowedDomains;
  const d = domains({ SP6_MOCK_HOST: "sp6-mock" });
  assert.ok(d.includes("sp6-mock") && d.includes("127.0.0.1"), JSON.stringify(d));
  assert.ok(!domains({}).includes("sp6-mock"));
});

test("signer client: a non-loopback endpoint goes through http_proxy (absolute URI); loopback stays direct", async () => {
  const seen = [];
  const proxy = createServer((req, res) => { seen.push({ url: req.url, host: req.headers.host, client: req.headers["x-signer-client"] }); res.end(JSON.stringify({ stdout: "ok\n", stderr: "", exitCode: 0 })); });
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  const dir = mkdtempSync(join(tmpdir(), "sp6-client-"));
  try {
    const src = readFileSync(join(HERE, "adapters", "cc-signer-client.mjs"), "utf8");
    const client = join(dir, "client.mjs");
    writeFileSync(client, src.replace("__SIGNER_ENDPOINT__", "http://sp6-mock:4567").replace("__SIGNER_CLIENT__", "tok"));
    // Async spawn: the proxy above runs on this event loop, so a blocking spawnSync would deadlock it.
    const r = await new Promise((done) => {
      const c = spawn(process.execPath, [client, "capabilities"], { env: { HOME: dir, http_proxy: `http://127.0.0.1:${proxy.address().port}` } });
      let stdout = ""; let stderr = "";
      c.stdout.on("data", (b) => { stdout += b; });
      c.stderr.on("data", (b) => { stderr += b; });
      c.on("close", (status) => done({ status, stdout, stderr }));
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "ok\n");
    assert.deepEqual(seen, [{ url: "http://sp6-mock:4567/exec", host: "sp6-mock:4567", client: "tok" }]);
  } finally {
    proxy.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
