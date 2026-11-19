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
