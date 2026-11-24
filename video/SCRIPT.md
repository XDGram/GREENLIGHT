# Greenlight demo video script

**Length: 3:50.** That's inside the hackathon's 3 to 5 minutes and long enough to show the whole flow once, at a calm pace, with no filler. Judges watch many of these; a tight 3:50 that shows a real Fail turning into a real Pass beats a 5-minute tour.

**Format:** a motion video, built in Remotion (`video/remotion`), 1920 × 1080, 30 fps. Every scene is animated. The app's screens are rebuilt from the real UI (same components, colours and copy), so they stay sharp and can move. The real data is the real data: the claims, Kane's note, the fix and the job ids all come from runs that happened.

**Voice:** Bella (ai33pro), speed 1. About 420 words in total, roughly 2:45 of speech. The rest of the 3:50 is room for the screens to breathe: typing, the drop, the sped-up Kane run and the Fail to Pass flip. All the voiceover together is about 2,340 characters, so about 2,340 credits to generate once.

**Look:** the app's sky theme. Sky blue `#2f6fd1` background with soft clouds, white frosted cards, ink `#141a22` text, Plus Jakarta Sans, and green `#22b36b` for Passed. Red only for Failed. The Kane scenes use the dark circuit board with the KANE CLI chip from the live run view.

**Sound:** a light, steady electronic bed at low volume, ducked under the voice. Soft clicks on button presses, a low tone on Failed, a bright chime on Passed.

**Captions:** burned in, bottom centre, two lines at most, so it works muted.

**What the video must make clear to a judge** (the four scores):

| Score | Where the video proves it |
|---|---|
| Ships | Scenes 3 to 6: a real check on a real live app, start to finish |
| Verified | Scenes 5 and 6: Kane finds a real bug, in its own words |
| Closed loop | Scenes 7 and 8: Kane's verdict goes to Claude Code, Claude Code fixes and asks Kane again, Kane passes |
| Craft | Scenes 2, 9 and 10: one paste to set up, approval before spend, honest results, guardrails |

---

## Scene 1. The hook (0:00 to 0:15)

**On screen:** a README on a white card, bullet points typing in: "Users can add items to the cart", "Users can subscribe to the newsletter". A small green check pops next to each one, unasked. Then the checks wobble and one turns into a question mark.

**Motion:** README card slides up from the bottom; checks pop in with a small bounce; the last one flips to "?" with a short shake.

**Voiceover:**
> Every README makes promises. Users can sign up. The cart works. The newsletter sends a confirmation. But who checks that the live app actually does what the README says?

---

## Scene 2. Meet Greenlight (0:15 to 0:35)

**On screen:** the Greenlight logo (dot-matrix check rising to the green light) draws itself, then the wordmark. Below it, the four steps from the landing page appear as four cards joined by the dashed connectors: Paste, Approve, Verdict, Fix with Claude Code. A loop arrow runs from the last card back to "Verdict" with the label "until every claim passes".

**Motion:** logo dots light up one by one along the check, the green light glows last. Cards drop in left to right; a green dot travels along each connector.

**Voiceover:**
> This is Greenlight. You give it your repo, your live URL and your README. Kane CLI tests every claim on the deployed app, in a real browser. And when something fails, Claude Code fixes it, and Kane checks again, until every claim passes.

---

## Scene 3. Paste (0:35 to 0:55)

**On screen:** the "Check an app" page. The GitHub repository field fills with `github.com/XDGram/GREENLIGHT`, the live URL with `greenlight-demo-shop.vercel.app`. A README.md file icon is dragged onto the README box; it fills with the demo shop's README. The green line appears: "Loaded README.md. You can edit it below." Cursor clicks "Check my app".

**Motion:** typed text with a blinking caret; the file icon arcs in from the right; the box's dashed blue outline pulses on drop.

**Voiceover:**
> Here's a small demo shop we deployed on Vercel, with one feature that works and one that's quietly broken. I paste the repository and the live URL, and drop in the README. No account needed.

---

## Scene 4. Claims and cost (0:55 to 1:20)

**On screen:** two claim rows appear, each with a switch turned on:
1. "Users can add items to the cart and the cart count goes up"
2. "Users can subscribe to the newsletter with their email and see a confirmation"

Under them, each claim's test in plain English (open the page, click Add to cart, expect the count to change). The cost line counts up to "94 credits". The button reads "Run · 94 credits". Cursor clicks it.

**Motion:** rows slide in staggered; the credit number ticks up; a soft highlight sweeps the Run button before the click.

**Voiceover:**
> Greenlight turns every bullet point into a claim, and every claim into a plain-English test for Kane. Before anything runs, I see exactly what will be tested and exactly what it costs. Nothing spends credits until I click Run. That click is my approval.

---

## Scene 5. Kane at work (1:20 to 2:05)

**On screen, part A (1:20 to 1:40):** a simple diagram builds left to right: Greenlight API, then a box labelled "Vercel Sandbox, one per run", inside it "Kane CLI 0.10.6" and "Chromium", then an arrow out to "your live app". The command line appears under it in mono:
`kane-cli testrun run … --agent --local --no-adaptive-heal`
Each flag gets a short label as it lights up: `--agent` "machine-readable results", `--local` "nothing uploaded", `--no-adaptive-heal` "approved tests can't be rewritten to pass".

**On screen, part B (1:40 to 2:05):** the live run view: the dark circuit board with traces flowing into the KANE CLI chip, the LIVE dot pulsing, the timer running, and the line `kane-cli: running in a real browser, 2 claims to check`. Stage chips: Queued (done), Kane is running (spinning), Verdict. A small label in the corner: "about 2 minutes, sped up".

**Motion:** diagram boxes snap together; flags highlight one at a time; the circuit traces run continuously; the timer races (time-lapse).

**Voiceover:**
> When I approve, Greenlight starts a fresh Vercel Sandbox just for this run. Inside it, Kane CLI drives a real Chromium against the live URL. We run Kane in agent mode, so its results come back as data. Local mode, so nothing gets uploaded. And with adaptive healing off, so Kane can't quietly rewrite an approved test until it passes. While it works, the page shows the run live. It only shows what's really known: the status, the time, and the claims being checked.

---

## Scene 6. The verdict (2:05 to 2:30)

**On screen:** the result page. Verdict "Failed". Claim 1 gets a green "Passed" badge. Claim 2 gets a red "Failed" badge, and under it a quote block labelled "What Kane saw":
"Three valid email submissions all returned 'Subscription failed. Please try again later.'"
Under that, the failed step and a suggested fix.

**Motion:** claim 1 badge pops green with the chime; claim 2 badge drops in red with the low tone; Kane's note types out like a terminal line.

**Voiceover:**
> Two minutes later, the verdict. The cart works: passed. The newsletter doesn't: failed. And Kane tells us exactly what it saw. Three valid emails, and every one said subscription failed. That's a real bug on a real deployment, caught by Kane.

---

## Scene 7. The closed loop: Claude Code (2:30 to 3:15)

**On screen, part A (2:30 to 2:45):** cursor clicks "Connect Claude Code". A message card appears with a Copy button; the token in it is blurred. It flies into a terminal window titled "Claude Code".

**On screen, part B (2:45 to 3:15):** the terminal plays the loop, each step a line that ticks green:
1. `GET /v1/checks/:id` "Reading Kane's verdict" (a small table: cart passed, newsletter failed)
2. Claude Code opens `examples/demo-shop/app.js`; the line `if (res.status === "ok")` is highlighted red, then changes to `if (res.ok)`, highlighted green. A caption: "The API answers { ok: true }. The form checked a field that never exists."
3. `git commit` "Fix newsletter sign-up: read the API's ok field" with the hash `6919b14`, then `git push`
4. "Waiting for the new deploy"
5. `POST /v1/checks/:id/recheck` "Asking Kane to check again"

A thin line connects the terminal back to the Kane chip from scene 5, closing the loop visually.

**Motion:** the copied message flies in; terminal lines type at a readable pace; the code diff wipes from red to green; the connecting line draws itself and pulses.

**Voiceover:**
> Now the loop. I click Connect Claude Code and paste one message. Claude Code reads Kane's verdict straight from the Greenlight API, Kane's own note included, and uses it as the symptom. It finds the cause: the form checked a field the API never sends. It fixes one line, commits, pushes, waits for the new deploy, and then asks Greenlight to run Kane again. No copy and paste of logs, no human in the middle.

---

## Scene 8. Kane confirms (3:15 to 3:28)

**On screen:** the circuit board runs once more (short, sped up), then the result flips: claim 2 badge turns from red to green. Both claims "Passed". Verdict "Passed". Under it: "Re-check started by Claude Code" and the job id `job_160ed912…`.

**Motion:** red badge cross-fades to green with the chime; a soft green glow spreads behind the card; the logo's green light pulses once.

**Voiceover:**
> Kane tests the new deploy. Both claims pass. Kane found the bug, Claude Code fixed it, and Kane confirmed the fix. That's the whole loop.

---

## Scene 9. Built to be trusted (3:28 to 3:42)

**On screen:** four short lines appear one by one, each with a small icon:
- "You approve every test and every credit"
- "Claude Code's token can re-run approved tests, not approve new ones"
- "Could not verify never counts as passed"
- "Every run has a capped cost"

**Motion:** lines slide in from the left, 0.6 s apart.

**Voiceover:**
> And it stays honest. You approve every test and every credit. Claude Code can re-run checks, but never approve new ones. And if Kane can't finish, it's never counted as a pass.

---

## Scene 10. Close (3:42 to 3:50)

**On screen:** the logo and wordmark on sky blue. Under it:
`greenlight-api-xi.vercel.app/app`
`github.com/XDGram/GREENLIGHT`
Small line: "Built with Kane CLI and Claude Code".

**Motion:** logo settles in the centre, text fades up, clouds drift, the green light glows and holds.

**Voiceover:**
> Greenlight. Your README makes promises. Kane CLI proves them.

---

## Voiceover only (for generating the audio)

One file per scene, generated one at a time, in this order. Scene timings above leave room for the pauses between them.

1. Every README makes promises. Users can sign up. The cart works. The newsletter sends a confirmation. But who checks that the live app actually does what the README says?
2. This is Greenlight. You give it your repo, your live URL and your README. Kane CLI tests every claim on the deployed app, in a real browser. And when something fails, Claude Code fixes it, and Kane checks again, until every claim passes.
3. Here's a small demo shop we deployed on Vercel, with one feature that works and one that's quietly broken. I paste the repository and the live URL, and drop in the README. No account needed.
4. Greenlight turns every bullet point into a claim, and every claim into a plain-English test for Kane. Before anything runs, I see exactly what will be tested and exactly what it costs. Nothing spends credits until I click Run. That click is my approval.
5. When I approve, Greenlight starts a fresh Vercel Sandbox just for this run. Inside it, Kane CLI drives a real Chromium against the live URL. We run Kane in agent mode, so its results come back as data. Local mode, so nothing gets uploaded. And with adaptive healing off, so Kane can't quietly rewrite an approved test until it passes. While it works, the page shows the run live. It only shows what's really known: the status, the time, and the claims being checked.
6. Two minutes later, the verdict. The cart works: passed. The newsletter doesn't: failed. And Kane tells us exactly what it saw. Three valid emails, and every one said subscription failed. That's a real bug on a real deployment, caught by Kane.
7. Now the loop. I click Connect Claude Code and paste one message. Claude Code reads Kane's verdict straight from the Greenlight API, Kane's own note included, and uses it as the symptom. It finds the cause: the form checked a field the API never sends. It fixes one line, commits, pushes, waits for the new deploy, and then asks Greenlight to run Kane again. No copy and paste of logs, no human in the middle.
8. Kane tests the new deploy. Both claims pass. Kane found the bug, Claude Code fixed it, and Kane confirmed the fix. That's the whole loop.
9. And it stays honest. You approve every test and every credit. Claude Code can re-run checks, but never approve new ones. And if Kane can't finish, it's never counted as a pass.
10. Greenlight. Your README makes promises. Kane CLI proves them.

---

## Facts used, so nothing in the video is made up

- Demo app: `examples/demo-shop`, live at https://greenlight-demo-shop.vercel.app, with the newsletter bug in place.
- Kane CLI 0.10.6, run with `--agent --local --no-adaptive-heal`, in a Vercel Sandbox per job, driving Chromium (`@sparticuz/chromium`).
- First real run: `job_318ca85431854f0a887d1d92f6446bbc`. Cart passed, newsletter failed.
- Kane's note, as recorded in the fix commit: "Three valid email submissions all returned 'Subscription failed. Please try again later.'"
- Fix: commit `6919b14`, "Fix newsletter sign-up: read the API's ok field" (the form checked `res.status === "ok"`; the API answers `{ ok: true }`).
- Re-check started by Claude Code's agent token: `job_160ed9123d7748d387eab3f4484cd93b`. Both claims passed.
- A 2-claim run costs about 94 credits; a Kane run takes about 2 minutes (shown sped up, and labelled so).
- The agent token reads checks and starts re-checks of approved tests; it can't approve new tests. "Could not verify" is never counted as passed.
