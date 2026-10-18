// Contract comparison between a real-signer record and a mock record of the same parity step.
// Equal: exit code, stdout format (human / json / empty), field NAMES and ORDER, every deterministic value, the
// stderr (usage text, or error code + message), the header-file line prefix and mode. Random-but-shaped values
// (keys, thumbprints, signatures, nonces, iat) must have the same SHAPE. One documented deviation: the header
// VALUE is the run's FAKE-SP6-CANARY-HDR- canary instead of base64(envelope) (see PROVENANCE.md).

// Values that are fresh per key / per call on BOTH sides; compared by shape, never literally.
const SHAPED = new Set(["x", "jkt", "agent_key_jkt", "agentKeyJkt", "pop_signature", "nonce", "iat", "signature"]);
// The one deliberate deviation: the credential itself is the planted canary.
const DEVIATION = new Set(["header_value"]);

/** A value's shape: type, plus length and alphabet for strings. */
export function shape(v) {
  if (typeof v === "string") {
    const alpha = /^[A-Za-z0-9_-]*$/.test(v) ? "b64url" : /^0x[0-9a-f]*$/.test(v) ? "hex0x" : "text";
    return `string:${alpha}:${v.length}`;
  }
  if (Number.isInteger(v)) return "integer";
  return typeof v;
}

/** Parse a human (`key: value`) or json stdout into an ordered entry list, with the format. */
export function parseStdout(s) {
  if (s === "") return { format: "empty", entries: [] };
  if (s.startsWith("{")) return { format: "json", entries: Object.entries(JSON.parse(s)) };
  const entries = s.replace(/\n$/, "").split("\n").map((line) => {
    const at = line.indexOf(": ");
    const raw = line.slice(at + 2);
    let value = raw;
    // toHuman() JSON-stringifies every non-string value; a string that merely looks like JSON stays a string.
    if (/^[[{]/.test(raw) || raw === "true" || raw === "false" || /^-?\d+$/.test(raw)) {
      try { value = JSON.parse(raw); } catch { value = raw; }
    }
    return [line.slice(0, at), value];
  });
  return { format: "human", entries };
}

function cmpValue(path, real, mock, diffs) {
  const key = path[path.length - 1];
  if (DEVIATION.has(key)) return;
  if (SHAPED.has(key)) { if (shape(real) !== shape(mock)) diffs.push(`${path.join(".")}: shape ${shape(real)} != ${shape(mock)}`); return; }
  if (real && typeof real === "object" && mock && typeof mock === "object") {
    const rk = Object.keys(real); const mk = Object.keys(mock);
    if (rk.join(",") !== mk.join(",")) { diffs.push(`${path.join(".")}: keys [${rk}] != [${mk}]`); return; }
    for (const k of rk) cmpValue([...path, k], real[k], mock[k], diffs);
    return;
  }
  if (JSON.stringify(real) !== JSON.stringify(mock)) diffs.push(`${path.join(".")}: ${JSON.stringify(real)} != ${JSON.stringify(mock)}`);
}

/** Differences between a real record and a mock record (empty = contract parity). */
export function compareRecord(real, mock) {
  const diffs = [];
  if (real.exitCode !== mock.exitCode) diffs.push(`exitCode ${real.exitCode} != ${mock.exitCode}`);
  const r = parseStdout(real.stdout); const m = parseStdout(mock.stdout);
  if (r.format !== m.format) diffs.push(`stdout format ${r.format} != ${m.format}`);
  else {
    const rk = r.entries.map(([k]) => k); const mk = m.entries.map(([k]) => k);
    if (rk.join(",") !== mk.join(",")) diffs.push(`stdout fields [${rk}] != [${mk}]`);
    else r.entries.forEach(([k, v], i) => cmpValue([k], v, m.entries[i][1], diffs));
  }
  if (real.stderr.startsWith("{")) {
    const re = JSON.parse(real.stderr); const me = mock.stderr.startsWith("{") ? JSON.parse(mock.stderr) : null;
    if (!me || JSON.stringify(re) !== JSON.stringify(me)) diffs.push(`stderr ${real.stderr.trim()} != ${mock.stderr.trim()}`);
  } else if (real.stderr !== mock.stderr) diffs.push(`stderr ${JSON.stringify(real.stderr)} != ${JSON.stringify(mock.stderr)}`);
  if (Boolean(real.header) !== Boolean(mock.header)) diffs.push(`header file ${Boolean(real.header)} != ${Boolean(mock.header)}`);
  else if (real.header) {
    const prefix = (l) => l.slice(0, l.indexOf(": ") + 2);
    if (prefix(real.header.line) !== prefix(mock.header.line) || !mock.header.line.endsWith("\n")) diffs.push("header line shape differs");
    if (real.header.mode !== mock.header.mode) diffs.push(`header mode ${real.header.mode} != ${mock.header.mode}`);
  }
  return diffs;
}
