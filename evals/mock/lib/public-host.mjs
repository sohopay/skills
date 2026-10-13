// The host the mock world ADVERTISES to the agent (merchant URL, signer endpoint, consent URL). Every mock server still
// BINDS 127.0.0.1. On Linux, Claude Code's sandbox gives Bash its own network namespace, so 127.0.0.1 there is the
// sandbox's own loopback and the agent's calls were refused (live run 38324799614); the live workflow maps a hostname
// to 127.0.0.1 in the runner's /etc/hosts and sets SP6_MOCK_HOST to it, so the sandbox's egress proxy (which allows
// only that name) carries the agent's calls to the mock. Unset, the mock stays plain 127.0.0.1.

/** A single DNS label: it flows into URLs and the sandbox's allowedDomains, so nothing else is accepted. */
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const LOOPBACK = "127.0.0.1";

/** SP6_MOCK_HOST when it is a bare hostname, else 127.0.0.1; a malformed value throws rather than widening egress. */
export function publicHost(env = process.env) {
  const v = env.SP6_MOCK_HOST;
  if (v === undefined || v === "") return LOOPBACK;
  if (!LABEL_RE.test(v)) throw new Error(`SP6_MOCK_HOST must be a bare hostname (one DNS label), got ${JSON.stringify(v)}`);
  return v;
}
