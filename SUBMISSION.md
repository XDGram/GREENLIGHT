# Greenlight: submission text and posts

Links used below:

- Live app: https://greenlight-api-xi.vercel.app/app
- Code: https://github.com/XDGram/GREENLIGHT
- Demo video: YOUTUBE_LINK (replace after uploading)

---

## About (for the submission form)

**Greenlight checks whether your app does what its README says.**

You paste a GitHub repo, the live URL and the README. Greenlight turns every promise in the README into a claim, shows you exactly what will be tested and what it costs, and nothing runs until you press Run.

**What Kane CLI does.** Each claim becomes a plain-English Kane CLI test. Kane runs in its own Vercel Sandbox and drives a real Chromium against the live app: it clicks, types and reads the screen the way a person would. A claim about the code (for example "the code calls the API at most once per analysis") is checked by Kane opening the repository on GitHub and reading the files. We run Kane with adaptive healing off, so it can't quietly rewrite an approved test until it passes. The result is a verdict per claim: Passed, Failed with Kane's own note on what it saw, or Could not verify.

**Which agent: Claude Code.** When a claim fails, the result page gives you one message to paste into Claude Code. It runs Greenlight's `/greenlight` command: Claude Code reads Kane's verdict from the Greenlight API, uses Kane's note as the symptom to find the real cause, fixes the code, pushes, waits for the new deploy and asks Greenlight to have Kane check again. It repeats until every claim passes. Claude Code's token can only re-run tests you already approved; it can't approve new ones or raise the spend.

**Proof.** On our demo shop, Kane failed the newsletter claim with "Three valid email submissions all returned 'Subscription failed. Please try again later.'" Claude Code found the cause (the form checked `res.status === "ok"`, the API answers `{ ok: true }`), fixed one line, pushed, and started the re-check itself. Kane passed both claims. We ran that loop twice on the live site. We also pointed Greenlight at another project of ours, Watchdog: Kane checked five claims, including one in the code on GitHub, and passed four.

Try it with no account: 3 free runs per visitor, up to 12 claims per run.

---

## Post 1: X (thread)

**1/**
Your README makes promises. Does your live app keep them?

I built Greenlight for the Kane CLI hackathon. Paste a repo, a live URL and a README. Kane CLI tests every claim on the deployed app in a real browser and gives a verdict per claim.

greenlight-api-xi.vercel.app/app

**2/**
When a claim fails you get Kane's own note on what it saw, and one message to paste into Claude Code.

Claude Code reads Kane's verdict, finds the cause, fixes the code, pushes, and asks Kane to check again. Until everything passes.

**3/**
Real run on our demo shop: Kane said every newsletter sign-up showed "Subscription failed". Claude Code found the form was checking `res.status === "ok"` when the API returns `{ ok: true }`. One-line fix, pushed, re-checked by Claude Code itself. Kane passed it.

**4/**
Claims about the code work too: Kane opens the repo on GitHub and reads the files.

No account needed, 3 free runs. Code and the 3-minute demo:
github.com/XDGram/GREENLIGHT
YOUTUBE_LINK

Built with TestMu AI's Kane CLI and Claude Code.

---

## Post 2: LinkedIn

Every README is a list of promises. Users can sign up. The cart works. The newsletter sends a confirmation. Nobody checks them against the live app after the last deploy.

For the Kane CLI hackathon I built Greenlight, which does exactly that.

You give it a GitHub repo, the live URL and the README. Every bullet point becomes a claim. Kane CLI turns each claim into a test and runs it in a real browser against the deployed app, clicking and typing like a person. Claims about the code are checked by Kane reading the repository on GitHub. You see the cost before anything runs, and the verdict comes back claim by claim, with Kane's own note on anything that failed.

Then the loop closes. Paste one message into Claude Code: it reads Kane's verdict, fixes the code, pushes, and asks Kane to check again until every claim passes.

On our demo shop, Kane caught a newsletter form that showed "Subscription failed" for every valid email. Claude Code traced it to a one-line bug (checking `res.status` instead of `res.ok`), fixed it, pushed, and triggered the re-check. Kane passed it.

Try it free, no account: https://greenlight-api-xi.vercel.app/app
Code: https://github.com/XDGram/GREENLIGHT
Demo video: YOUTUBE_LINK

Built with Kane CLI by TestMu AI and Claude Code.

---

## Post 3: Hacker News (Show HN)

**Title:** Show HN: Greenlight – test your live app against its own README with a browser agent

**Text:**

Greenlight takes a GitHub repo, a live URL and a README, turns each claim in the README into a test, and runs it against the deployed app in a real browser using Kane CLI (TestMu's testing agent). Each claim gets a verdict: passed, failed with the agent's note on what it saw, or could not verify. Claims about the code ("the API is called at most once per request") are checked by having the agent read the repository on GitHub.

When something fails, the result page gives you a message to paste into Claude Code. It reads the verdict over an API, fixes the code, pushes, waits for the deploy and asks for a re-check, until everything passes. The token it gets can only re-run tests you already approved.

Some details that mattered:

- Nothing runs until you approve the exact tests and the credit cost. The run is capped by credits.
- Each run gets its own Vercel Sandbox with Chromium; Kane runs with adaptive healing off, so an approved test can't be rewritten into a passing one.
- "Could not verify" (site down, timeout) is never counted as a pass and never sent to the fix loop.

Real example from our demo shop: the newsletter form showed "Subscription failed" for every valid email because it checked `res.status === "ok"` while the API returns `{ ok: true }`. Kane caught it, Claude Code fixed it and triggered the re-check, Kane passed it.

Free to try, no account (3 runs): https://greenlight-api-xi.vercel.app/app
Code: https://github.com/XDGram/GREENLIGHT

Built for the Kane CLI hackathon. Happy to answer questions about the sandbox setup or the agent loop.

---

## Post 4: Reddit (r/SideProject or r/webdev)

**Title:** I built a tool that tests your live app against the promises in its README, then has Claude Code fix what fails

Greenlight takes your repo, your live URL and your README. Every bullet point becomes a claim, and Kane CLI tests each one on the deployed site in a real browser. You get a verdict per claim, with the agent's own note on anything that failed. Claims about the code are checked by reading the repo on GitHub.

If something fails, you paste one message into Claude Code. It reads the verdict, fixes the code, pushes, and asks for a re-check until everything passes.

Example from our own demo shop: every newsletter sign-up said "Subscription failed". The form was checking `res.status === "ok"`, but the API returns `{ ok: true }`. Kane caught it, Claude Code fixed the one line and re-ran the check, and it passed.

It's free to try with no account (3 runs, up to 12 claims each): https://greenlight-api-xi.vercel.app/app
Code: https://github.com/XDGram/GREENLIGHT
Demo: YOUTUBE_LINK

Built for the Kane CLI hackathon. Feedback welcome, especially on which kinds of README claims it gets wrong.
