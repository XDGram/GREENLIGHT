# Kane CLI Hackathon: what we need to do

**Deadline: Thursday 26 November, 11:59 PM IST (10:29 AM PT). No pushes after this.**
Event page: https://www.kaneclihack.sh/ · Submit: https://www.kaneclihack.sh/o/submit

---

## How we get judged

Three bars first. **Miss one and nothing else is scored.**

| Bar | Status |
|---|---|
| 1. It works end to end | ❌ Not proven: no real Kane run through the live flow yet |
| 2. Kane CLI caught or proved something | ❌ Needs a real run with a real Pass and a real Fail |
| 3. Our agent and Kane CLI talked to each other | ⚠️ Partial: Kane's result doesn't go back to a coding agent yet |

Then four scores, 25% each: **Ships** (works end to end), **Verified** (Kane proved something meaningful), **Closed loop** (Kane's result feeds back to the agent), **Craft** (would a developer install it tonight?). Ties break on Verified, then Closed loop.

---

## YOU (only you can do these)

- [ ] **Sign up on testmuai.com and claim the 10,000 free credits:** https://www.testmuai.com/kane-cli/#creditOffer. Use the **same email** as your hackathon registration. Required to be scored.
- [ ] **Register for the hackathon:** https://www.kaneclihack.sh/o/register
- [ ] **Make the GitHub repo public** (XDGram/GREENLIGHT).
- [ ] **Say "yes" to real Kane runs** so I can do Step 1 below. Each 2-claim run costs about 94 credits.
- [ ] **(Optional but better) Add an AI key** (e.g. an Anthropic key) to Vercel, so suggested fixes are specific instead of generic. Give it to me through the secure prompt, never in chat.
- [ ] **Record the demo video:** 3–5 minutes, on YouTube. I'll write the script.
- [ ] **Post about it at least twice** on Hacker News, X, Reddit or LinkedIn. I'll draft the posts. More posts mean bonus points.
- [ ] **Submit the form** before the deadline. You can update it as many times as you like until then.

---

## ME (what I'll build)

### Step 1: Prove it works (bars 1 and 2)
- [ ] Make a small test app with **one true claim and one deliberately broken claim**.
- [ ] Run Greenlight on it for real, through the live site.
- [ ] Show Kane giving a real **Passed** and a real **Failed**, with what it saw.
- [ ] Fix anything that breaks along the way.

### Step 2: Close the loop (bar 3, and the Closed loop score)
- [ ] Add a **Claude Code command** that reads the Greenlight verdict and Kane's notes, fixes the code, and starts a re-check.
- [ ] The story it shows: **Kane fails it → the agent fixes it → Kane passes it.**
- [ ] If you add the AI key: specific suggested fixes instead of templates.

### Step 3: Submission material
- [ ] **About text:** what we built, which agent (Claude Code), what Kane does.
- [ ] **Demo video script:** 3–5 minutes, scene by scene.
- [ ] **Two or more post drafts:** HN, X, Reddit, LinkedIn.
- [ ] **README update:** how to run it, and working credentials or a fallback for judges. The rules say to hand over working credentials and include a backup for third-party services.

---

## What we submit (one form, five things)

| # | Item | Have it? |
|---|---|---|
| 1 | GitHub URL (public, started on or after 12 Nov) | ✅ Started 19 Nov. ❓ Public? |
| 2 | About your app (what, which agent, what Kane does) | ❌ I'll write it |
| 3 | Demo video, YouTube, 3–5 min | ❌ You record, I script |
| 4 | Live URL (optional) | ✅ https://greenlight-api-xi.vercel.app/app |
| 5 | At least two public posts | ❌ You post, I draft |

---

## Order of work

1. **Today:** you claim credits, register, make the repo public, and say yes to Kane runs. I do Step 1.
2. **Tomorrow:** I do Step 2 (closed loop). You review.
3. **Day 3:** I write the README, about text, video script and posts. You record and post.
4. **Before the deadline:** you submit. Don't leave it to the last hour.

## Prizes

1st $1,500 · 2nd $1,000 · 3rd $500 (each plus $250 OpenAI credits, a 1:1 with the founders, 3 months of Kane CLI Pro and a blog post). Every team that ships gets the "Verified with Kane CLI" badge.
