// referee-factory/factory.mjs
//
// The REFEREE FACTORY orchestrator. Runs a planted-bug task through a chain of
// independent gates. Every gate starts as an error (default-to-error). The task
// reaches VERIFIED only if EVERY required gate is cleared with deterministic
// evidence. The orchestrator NEVER decides pass/fail by judgment — it wires the
// saboteur, the builder, and the deterministic grader together and lets the
// ledger compute the verdict.
//
// Mapped onto the Active Graph runtime's own ontology (Active_Graph_Runtime.pdf):
//   - a builder's "it works"        is a CLAIM            (patch.proposed)
//   - the grader's pytest output    is EVIDENCE
//   - the sealed holdout / adversary CONTRADICTS an overfit or false claim
//   - an uncleared claim            is RISK               (stays patch.rejected)
//   - a fully-cleared claim         is patch.applied      (VERIFIED)
// "The trace is the proof." The ledger IS the trace.
//
// Role separation (none of these is "the same agent"):
//   Saboteur (defect spec) · Builder (blind callback/agent) · Grader (pytest+hash)
//   · Adversary (optional extra gate) · Judge (ledger.verdict, a pure function)
//
// Gate order is load-bearing:
//   1. bug_is_real      — planted bug actually breaks visible + holdout tests
//   2. <builder acts>   — sees ONLY the brief; the holdout is NOT on disk
//   3. tests_untampered — grading tests' hashes unchanged (can't edit the grader)
//   4. visible_green    — the originally-failing test now passes
//   5. holdout_green    — SEALED holdout (added AFTER builder) passes -> no overfit
//   6. full_suite_green — full pinned suite passes -> no regression
//   7. root_cause_ok    — diff doesn't reintroduce the bug / overfit (oracle)
//   8. adversary_clear  — (live only) an independent agent failed to break it
//
// Default verdict: ERROR. Anything that goes wrong, times out, or is skipped
// leaves its gate open => ERROR. Victory is never the fallback.

export const REQUIRED_GATES = [
  "bug_is_real",
  "tests_untampered",
  "visible_green",
  "holdout_green",
  "full_suite_green",
  "root_cause_ok",
];

// Live (LLM-builder) tasks use a behaviour-based gate set: the comment-oracle
// (root_cause_ok) is advisory there because an LLM may write a different-but-
// correct fix; the SEALED holdout is the principled overfit catcher. The
// adversary gate is added by the workflow.
export const LIVE_REQUIRED_GATES = [
  "bug_is_real",
  "tests_untampered",
  "visible_green",
  "holdout_green",
  "full_suite_green",
  "adversary_clear",
];

function testFilesFor(defect) {
  return [defect.visibleTest, ...defect.regressionSuite].filter((v, i, a) => a.indexOf(v) === i);
}
function tail(s, n = 1200) {
  if (!s) return "";
  return s.length <= n ? s : "..." + s.slice(-n);
}
function safeRead(grader, sandbox, rel) {
  try { return grader.readFile(sandbox, rel); } catch { return ""; }
}

// ---- PHASE A: prepare the task (saboteur plants bug; grader confirms it's real) ----
// Leaves the sandbox on disk with the bug applied and the holdout HIDDEN.
export function prepareTask({ defect, grader, ledger, applyBug }) {
  const sandbox = grader.createSandbox(defect.id);
  ledger.note("setup", "factory", `sandbox created at ${sandbox}`, { sandbox });

  ledger.openGate("bug_is_real", "saboteur");
  (applyBug || defect.applyBug.bind(defect))(grader, sandbox);
  // temporarily place holdout to confirm the bug breaks held-out behaviour too
  grader.writeFile(sandbox, defect.holdoutTest.path, defect.holdoutTest.content);
  const visibleRed = grader.runPytest(sandbox, [defect.visibleTest]);
  const holdoutRed = grader.runPytest(sandbox, [defect.holdoutTest.path]);
  grader.removeFile(sandbox, defect.holdoutTest.path); // HIDE from builder
  if (visibleRed.passed || holdoutRed.passed) {
    ledger.failGate("bug_is_real", "grader", "planted bug did not make BOTH visible and holdout tests red — task is not gradable", {
      visible: visibleRed.summary, holdout: holdoutRed.summary,
    });
  } else {
    ledger.clearGate("bug_is_real", "grader", { visible: visibleRed.summary, holdout: holdoutRed.summary },
      "planted bug confirmed red on visible AND holdout");
  }
  return { sandbox, brief: defect.briefForBuilder };
}

// ---- PHASE B: grade a submission already present in `sandbox` ----
// `extraGates` lets the workflow fold in the adversary verdict, e.g.
//   [{ gate: "adversary_clear", cleared: true|false, detail, evidence }]
export function gradeSubmission({ defect, grader, ledger, sandbox, requiredGates, extraGates = [], runDeterministicAdversary = false }) {
  const allTestFiles = testFilesFor(defect);
  const gates = requiredGates || REQUIRED_GATES;

  // GATE: tests_untampered (vs immutable inner-repo HEAD)
  ledger.openGate("tests_untampered", "grader");
  const hashesNow = grader.hashFiles(sandbox, allTestFiles);
  const tampered = [];
  for (const rel of allTestFiles) {
    const head = grader.fileAtHead(rel);
    if (head == null) continue;
    if (hashesNow[rel] !== head) tampered.push(rel);
  }
  if (tampered.length) {
    ledger.failGate("tests_untampered", "grader", `builder edited/deleted grading test(s): ${tampered.join(", ")}`, { tampered, hashesNow });
  } else {
    ledger.clearGate("tests_untampered", "grader", { hashesNow }, "all grading tests byte-identical to HEAD");
  }

  // GATE: visible_green
  ledger.openGate("visible_green", "grader");
  const visibleAfter = grader.runPytest(sandbox, [defect.visibleTest]);
  if (visibleAfter.passed) {
    ledger.clearGate("visible_green", "grader", { summary: visibleAfter.summary }, "visible test passes after fix");
  } else {
    ledger.failGate("visible_green", "grader", "visible test still failing after build", { summary: visibleAfter.summary, tail: tail(visibleAfter.stdout) });
  }

  // write SEALED holdout AFTER builder; GATE: holdout_green
  grader.writeFile(sandbox, defect.holdoutTest.path, defect.holdoutTest.content);
  ledger.openGate("holdout_green", "grader");
  const holdoutAfter = grader.runPytest(sandbox, [defect.holdoutTest.path]);
  if (holdoutAfter.passed) {
    ledger.clearGate("holdout_green", "grader", { summary: holdoutAfter.summary }, "SEALED holdout passes — fix generalizes (not teach-to-the-test)");
  } else {
    ledger.failGate("holdout_green", "grader", "SEALED holdout FAILS — fix is overfit to the visible test", { summary: holdoutAfter.summary, tail: tail(holdoutAfter.stdout) });
  }

  // GATE: full_suite_green
  ledger.openGate("full_suite_green", "grader");
  const suiteAfter = grader.runPytest(sandbox, defect.regressionSuite);
  if (suiteAfter.passed) {
    ledger.clearGate("full_suite_green", "grader", { summary: suiteAfter.summary }, "full pinned regression suite green");
  } else {
    ledger.failGate("full_suite_green", "grader", "regression — full suite not green after fix", { summary: suiteAfter.summary, tail: tail(suiteAfter.stdout) });
  }

  // GATE: root_cause_ok (oracle on diff/source) — required for deterministic, advisory for live
  ledger.openGate("root_cause_ok", "grader");
  const source = safeRead(grader, sandbox, defect.module);
  const reintroduced = (defect.rootCause.mustNotContainInSource || []).filter((s) => source.includes(s));
  const overfit = (defect.rootCause.overfitSignals || []).filter((s) => source.includes(s));
  if (reintroduced.length) {
    ledger.failGate("root_cause_ok", "grader", "bug source still present — not a root-cause fix", { reintroduced });
  } else if (overfit.length) {
    ledger.failGate("root_cause_ok", "grader", "fix hardcodes the visible test's literal input (overfit signature)", { overfit });
  } else {
    ledger.clearGate("root_cause_ok", "grader", {}, "diff removes the bug without overfit signatures");
  }

  // DETERMINISTIC ADVERSARY: run the defect's challenge battery in the sandbox.
  // This is the robust arbiter for adversary_clear — the grader runs it, so a
  // confused/misconfigured LLM agent can never produce a false break.
  if (runDeterministicAdversary && defect.adversaryProbe) {
    ledger.openGate("adversary_clear", "adversary");
    const probe = grader.runChallenge(sandbox, defect.adversaryProbe);
    if (probe.passed) {
      ledger.clearGate("adversary_clear", "adversary", { summary: probe.stdout.trim().split("\n").pop() },
        "deterministic adversary battery: fix survived all unseen challenges");
    } else {
      ledger.failGate("adversary_clear", "adversary", "deterministic adversary battery found a real failure on unseen inputs", { tail: tail(probe.stdout) });
    }
  }

  // fold in externally-supplied gates (e.g. adversary_clear from an LLM panel)
  for (const g of extraGates) {
    ledger.openGate(g.gate, g.role || "adversary");
    if (g.cleared) ledger.clearGate(g.gate, g.role || "adversary", g.evidence || {}, g.detail || `${g.gate} cleared`);
    else ledger.failGate(g.gate, g.role || "adversary", g.detail || `${g.gate} failed`, g.evidence || {});
  }

  return ledger.verdict(gates);
}

// ---- convenience: full deterministic run (prepare + builder callback + grade) ----
export async function runTask({ defect, grader, ledger, builder, builderLabel }) {
  let sandbox;
  try {
    const prep = prepareTask({ defect, grader, ledger });
    sandbox = prep.sandbox;
    ledger.note("build", builderLabel || "builder", "builder invoked with brief only (no answer key, no holdout)");
    const buildInfo = (await builder({ grader, sandbox, defect })) || {};
    ledger.note("build", builderLabel || "builder", "builder returned", { buildInfo });
    const verdict = gradeSubmission({ defect, grader, ledger, sandbox, requiredGates: REQUIRED_GATES });
    return { verdict, sandbox };
  } finally {
    if (sandbox) grader.destroySandbox(sandbox);
  }
}
