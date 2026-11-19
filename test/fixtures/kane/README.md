# Kane CLI fixtures

Real, unmodified output captured from Kane CLI 0.10.6 during the Step 2 smoke test
against the throwaway `gl-test-app` Vercel preview. Used by the runner tests so
they never execute Kane or spend credits.

| Directory | Command | Exit | What it shows |
|---|---|---|---|
| `run1-authored/` | `testrun run cart_test.md subscribe_test.md about_nav_test.md --agent --headless --override-start-url <preview> --name gl-smoke-1` | 1 | All three tests authored for the first time (`testrun_authored_member_*` events). cart and about_nav passed; subscribe failed at step 3. Uploaded to Test Manager. |
| `run2-replay/` | same, plus `--no-adaptive-heal --local --name gl-smoke-2` | 1 | All three replayed (`testrun_member_*` and `testrun_progress` events). Same verdicts. `upload: "skipped"`. |

Each directory holds `stdout.ndjson` (Kane's `--agent` stream), `stderr.txt` and
`exit_code.txt`. `smoke@example.com` is test input, not a real address.

## Evidence

- `evidence-validate.json`: the real output of `kane-cli evidence validate <pack> --json`
  for that run's pack (Run 1: valid with 2 warnings; Run 2: valid, no diagnostics).
- `pack.sanitized.evidence`: a **sanitised** copy of that run's real evidence pack.
  The real packs contain the Kane account's username and email, Test Manager share
  links and account IDs, so they are not committed. The sanitised copy keeps the
  real zip structure and text records (`run.yaml`, `failure.yaml`, each test's
  `result.yaml`, `test.md`, `steps/*/step.json`, `steps/*/failure.yaml`, `meta/`,
  `coverage/`) with personal fields replaced by `REDACTED`, and drops screenshots,
  logs and network captures. Its hash therefore differs from the original.
- `fake-kane-validate.mjs`: stand-in for `kane-cli evidence validate` used by the tests.

To also run the collector against the original packs, put them in a directory and set
`GREENLIGHT_REAL_EVIDENCE_DIR` to it; that test is skipped otherwise.

## Credits

- `balance_before.txt` / `balance_after.txt`: the real `kane-cli balance` output
  captured immediately before and after that run (Run 1: 11200 → 11090.8815;
  Run 2: 11090.8815 → 11076.5779).
- `sessions/<session_id>/events.ndjson`: the run's real Kane session logs, reduced
  to their `run_end` and `test_md_done` events and to the fields the credit
  accountant reads (`type`, `status`, `reason`, `credits_consumed`,
  `per_flow_metadata[].credits_consumed`, `verdict.credits_consumed`, `duration_s`,
  `overall_status`, `v`, `ts`). All other fields, including Test Manager share
  links, are dropped. The credit values are unchanged.
- `fake-kane-balance.mjs`: stand-in for `kane-cli balance` used by the tests.
