// Stub "model" (T15 fix N6): leaves a process behind in its OWN session (setsid), which a process-group kill cannot
// reach. Its cwd is the workspace HOME and its environment carries HOME=<workspace>, so the post-run sweep must find
// and kill it.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export const costUsd = 0.01;

export default async function setsid(agent, ctx) {
  const r = agent.bash(`perl -e 'use POSIX qw(setsid); my $p = fork; if ($p) { print "$p\\n"; exit 0 } setsid(); open STDIN, "</dev/null"; open STDOUT, ">/dev/null"; open STDERR, ">/dev/null"; sleep 300'`);
  writeFileSync(join(ctx.recordDir, "setsid.json"), JSON.stringify({ pid: Number(r.stdout.trim()) }));
  agent.say("Done.");
}
