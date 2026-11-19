// What the pinned Kane CLI can and cannot do, as Greenlight relies on it.
// Every Kane-version-specific assumption that changes product behaviour lives
// here, so a Kane upgrade is one reviewed edit plus re-verification.
//
// LIMITATION (verified in Step 11 E1 and the Kane 0.10.6 package source):
// Greenlight always runs Kane with --local (no Test Manager uploads). In that
// mode Kane 0.10.6 authors tests but keeps NO replayable recording:
//   - the only code that writes output-<stem>/.internal/execution.json is the
//     upload pipeline, which aborts without a Test Manager test_id
//     ("PIPELINE_ABORT No test_id available"), and --local skips the step that
//     registers one ("GATE_SKIP_LOCAL");
//   - the test.md run path sets skipLocalWrites, and the finalize step only calls
//     the upload pipeline when not in local mode;
//   - no CLI option keeps an authored recording locally: --push, --author and
//     `testmd sync` all commit to the cloud, `testmd export` produces Playwright
//     code (not Kane verdicts).
// Consequences, enforced elsewhere:
//   - every run authors every test afresh (recording detection finds nothing,
//     the estimate prices fresh authoring, a recording_not_retained warning is
//     raised), so cross-run replay is not possible;
//   - fresh authoring needs explicit spend confirmation on every run, so the
//     Stop-hook loop cannot run unattended without relayed mode.
// What would lift it: a Kane release that persists execution.json (and the
// meta.json commit_id/test_id it checks) under --local, or a decision to allow
// Test Manager uploads. Neither is assumed here.

export const KANE_CAPABILITIES = Object.freeze({
  version: "0.10.6",
  // Greenlight never enables uploads; this records what Kane does in that mode.
  localModeOnly: true,
  retainsAuthoredRecordingsLocally: false,
  replaysExistingLocalRecordings: true, // smoke Run 2: --local replay of recordings that already existed
  evidencePackLocal: true, // <cwd>/.testmuai/evidence/<execution_id>.evidence, validated with `evidence validate`
  hiddenTestrunOptions: ["--local"], // accepted by `testrun run`, not listed in its --help
});

export const KANE_LIMITATIONS = Object.freeze([
  {
    code: "kane_no_local_recording_retention",
    summary: `Kane ${KANE_CAPABILITIES.version} keeps no replayable recording when it authors tests in local mode (no Test Manager uploads), so every run authors every test afresh and is priced as fresh authoring.`,
    liftedBy: "A Kane release that persists authored recordings locally under --local, or an explicit decision to allow Test Manager uploads.",
  },
]);

/** One-line statement for CLI output and reports. */
export function recordingRetentionNote() {
  return KANE_LIMITATIONS[0].summary;
}
