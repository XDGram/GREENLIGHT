# Greenlight: product video script

Follows [BRIEF.md](BRIEF.md). **Length: 3:30.** Motion video, 1920 × 1080, 30 fps, built in Remotion. Voice: Bella.

## How to read this

Each shot has four parts: the **time**, the **picture** (what's on screen), the **voice** (what Bella says over exactly that picture) and the **cut** (how the shot moves into the next one). The voice line is written for its picture: when she says "failed", the badge turns red.

## Visual rules for every shot

- One continuous world. The camera moves through the product instead of jumping between slides: push in, pull out, follow an element from one screen to the next.
- Real interface, rebuilt to the pixel: the sky blue, white cards, Plus Jakarta Sans, green for passed, red only for failed.
- One easing for everything (fast out, soft landing, `cubic-bezier(0.22, 1, 0.36, 1)`). Nothing bounces, nothing spins, nothing sparkles.
- Every transition is a match: an element in one shot becomes an element in the next. No fades to black except the last one, no wipes, no stock effects.
- Captions in clean type, bottom centre, two lines at most.
- Sound: a restrained, warm bed under the voice. Real UI sounds (a click, a soft tone on failed, a clear chime on passed). No whooshes on every cut.

---

## 1. The promise (0:00 to 0:12)

**Picture:** white screen. A README writes itself, line by line, like someone typing:
"Demo Shop. Users can add items to the cart. Users can subscribe to the newsletter and see a confirmation."
The camera slowly pushes in on the last line.

**Voice:**
> Every app has a README full of promises. Add to cart. Sign up for the newsletter. But does the live app actually keep them?

**Cut:** on "keep them", the full stop at the end of the newsletter line grows into a green dot.

---

## 2. Greenlight (0:12 to 0:24)

**Picture:** the green dot becomes the light at the top of the Greenlight mark; the dotted check draws itself into it. The wordmark slides out beside it. The white turns to sky blue behind, with soft clouds. Under the logo: "Does your app do what its README says?"

**Voice:**
> This is Greenlight. It checks every promise on your live app, using Kane CLI to test it, and Claude Code to fix what's broken.

**Cut:** the logo moves up into the corner of a browser bar as the camera pulls back to the Greenlight app.

---

## 3. Start a check (0:24 to 0:42)

**Picture:** the "Check an app" form. The repository and live app fields fill in. A README file drags in from the side and drops into the README box; the box fills, and a quiet green line says "Loaded README.md." The cursor clicks "Check my app".

**Voice:**
> You give it three things: your code on GitHub, the link to your live app, and your README. That's all. No account, no setup.

**Cut:** the README box's lines lift out of the box and fall into place as separate cards.

---

## 4. Claims (0:42 to 1:00)

**Picture:** two claim cards, each with a switch:
"Users can add items to the cart and the cart count goes up."
"Users can subscribe to the newsletter and see a confirmation."
Below them, the cost appears, and the button "Run". The cursor rests on it, then clicks.

**Voice:**
> Greenlight turns each promise into a claim it can test. You choose which ones to check, and you see exactly what the run will cost before anything starts. Nothing runs until you press Run.

**Cut:** the Run button presses down and becomes the KANE CLI chip, in the dark, with its circuit lines flowing in.

---

## 5. Kane CLI tests it (1:00 to 1:32)

**Picture, part A (1:00 to 1:12):** the circuit board from the app's live view, with the KANE CLI chip in the centre and coloured traces flowing into it. The camera moves through the chip.

**Picture, part B (1:12 to 1:32):** we come out inside a real browser showing the demo shop. A cursor, moving the way a person moves, clicks "Add to cart": "Items in cart" goes from 0 to 1. It scrolls to the newsletter, types an email, clicks "Subscribe". A message appears: "Subscription failed. Please try again later." It tries again. Same message. A small label in the corner throughout: "Kane CLI, live app, real browser".

**Voice:**
> This is where Kane CLI comes in. Greenlight hands it every claim as a plain-English test. Kane opens your live app in a real browser and uses it the way a person would: it clicks, it types, it reads what's on the screen. The cart works. But the newsletter keeps saying no.

**Cut:** the red error message slides out of the browser and lands on the result page as Kane's note.

---

## 6. The verdict (1:32 to 1:54)

**Picture:** the result page. The cart claim gets a green "Passed". The newsletter claim gets a red "Failed", and under it, "What Kane saw": "Three valid email submissions all returned 'Subscription failed. Please try again later.'" (Kane's real words) Beside it, a suggested fix in one sentence. On the right, the card "Fix it with Claude Code" lights up.

**Voice:**
> And here is the verdict, claim by claim. The cart passed. The newsletter failed, and Kane tells you exactly what it saw. Greenlight doesn't stop at the problem. It brings up the fix, ready for Claude Code.

**Cut:** the camera pushes into the "Fix it with Claude Code" card until it fills the screen.

---

## 7. First time: install (1:54 to 2:10)

**Picture:** the card's "First time? Install Claude Code" section opens. The camera glides down the steps: one line to copy, a Copy button that ticks to "Copied". A terminal window rises from the bottom; Claude Code starts, with its welcome screen.

**Voice:**
> First time using Claude Code? Greenlight walks you through it. Copy one line, and Claude Code is ready in a few minutes. You only do this once.

**Cut:** the camera returns up the card to the "Connect Claude Code" button as the terminal slides to the right half of the screen.

---

## 8. One paste (2:10 to 2:24)

**Picture:** split screen. Left: the result page. The cursor clicks "Connect Claude Code"; a short message appears with a Copy button (the private part blurred). Copy. The message travels across the split and drops into the Claude Code terminal on the right. Enter.

**Voice:**
> Then click Connect Claude Code, copy one message, and paste it into Claude Code. That message is all it needs to find your check and talk to Greenlight.

**Cut:** the left half slides away; the terminal takes the whole screen.

---

## 9. Claude Code fixes it (2:24 to 2:56)

**Picture:** the Claude Code terminal, full screen. Its messages appear in plain English, one by one, each ticking green when done:
- "Reading Kane's verdict from Greenlight: cart passed, newsletter failed."
- "Kane saw every sign-up fail. Looking at the sign-up form."
- "Found it: the form misreads the server's reply, so every sign-up looks like a failure."
- A one-line change, shown small and short (red line out, green line in), not explained.
- "Fixed. Saving the change and publishing it."
- "Waiting for the new version to go live."
- "Asking Greenlight to have Kane check again."

**Voice:**
> Claude Code reads Kane's verdict straight from Greenlight, including what Kane saw. It uses that to find the real cause: the form was misreading the server's reply. It fixes it, publishes the change, waits for the new version to go live, and asks Kane to check again. You just watch.

**Cut:** the last line, "Asking Greenlight to have Kane check again", sends a thin line out of the terminal that connects back to the KANE CLI chip.

---

## 10. Kane checks again (2:56 to 3:14)

**Picture:** the chip and its circuit lines, brief. Back in the real browser: the email is typed, "Subscribe" clicked, and this time "Thanks for subscribing, ada@example.com!" appears. Cut to the result page: the newsletter claim's red "Failed" turns green, "Passed". Both claims green. The header reads "Passed". In the Claude Code terminal, a last line: "Kane passed every claim."

**Voice:**
> Kane tests the new version on your live app. This time it works. Every claim passes. Kane found the problem, Claude Code fixed it, and Kane proved the fix.

**Cut:** the green "Passed" badge grows into the green light of the Greenlight mark.

---

## 11. Close (3:14 to 3:30)

**Picture:** the Greenlight mark and wordmark, centred on sky blue. The four steps line up beneath it as small labels joined by a line: Check, Verdict, Fix, Check again. Then the links: greenlight-api-xi.vercel.app and github.com/XDGram/GREENLIGHT. "Built with Kane CLI and Claude Code." The mark's green light holds; slow fade to white.

**Voice:**
> Greenlight. Kane CLI checks every promise. Claude Code keeps them. Try it on your app today.

---

## Voiceover, line by line (for generating the audio)

Generate one line per shot, in order, only after this script is approved.

1. Every app has a README full of promises. Add to cart. Sign up for the newsletter. But does the live app actually keep them?
2. This is Greenlight. It checks every promise on your live app, using Kane CLI to test it, and Claude Code to fix what's broken.
3. You give it three things: your code on GitHub, the link to your live app, and your README. That's all. No account, no setup.
4. Greenlight turns each promise into a claim it can test. You choose which ones to check, and you see exactly what the run will cost before anything starts. Nothing runs until you press Run.
5. This is where Kane CLI comes in. Greenlight hands it every claim as a plain-English test. Kane opens your live app in a real browser and uses it the way a person would: it clicks, it types, it reads what's on the screen. The cart works. But the newsletter keeps saying no.
6. And here is the verdict, claim by claim. The cart passed. The newsletter failed, and Kane tells you exactly what it saw. Greenlight doesn't stop at the problem. It brings up the fix, ready for Claude Code.
7. First time using Claude Code? Greenlight walks you through it. Copy one line, and Claude Code is ready in a few minutes. You only do this once.
8. Then click Connect Claude Code, copy one message, and paste it into Claude Code. That message is all it needs to find your check and talk to Greenlight.
9. Claude Code reads Kane's verdict straight from Greenlight, including what Kane saw. It uses that to find the real cause: the form was misreading the server's reply. It fixes it, publishes the change, waits for the new version to go live, and asks Kane to check again. You just watch.
10. Kane tests the new version on your live app. This time it works. Every claim passes. Kane found the problem, Claude Code fixed it, and Kane proved the fix.
11. Greenlight. Kane CLI checks every promise. Claude Code keeps them. Try it on your app today.

---

## True to the product

Everything shown happens in the real product; the video only makes it easier to follow.

- The demo shop and its newsletter bug are real (`examples/demo-shop`, live at greenlight-demo-shop.vercel.app).
- Kane's real note on the first run: "Three valid email submissions all returned 'Subscription failed. Please try again later.'" (Shot 6 shows it word for word.)
- The real fix was one line in the sign-up form, made by Claude Code, and the re-check it started passed both claims.
- The install steps, the Connect Claude Code button and the one-message paste are the real result page.
- The Kane run takes about two minutes in reality; shots 5 and 10 show it shortened.
