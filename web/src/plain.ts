// The words the main interface uses. Technical terms stay in "Technical details".

export type Outcome = "working" | "not_working" | "could_not_verify" | "not_run";

/** Map a Greenlight/Kane status to the three outcomes people see. */
export function outcomeOf(status: string | null | undefined): Outcome {
  if (!status) return "not_run";
  if (status === "passed") return "working";
  if (status === "failed" || status === "app_failure") return "not_working";
  return "could_not_verify";
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  working: "Working",
  not_working: "Not working",
  could_not_verify: "Could not verify",
  not_run: "Not tested yet",
};

export const OUTCOME_MEANING: Record<Outcome, string> = {
  working: "The browser did every step and saw everything it expected.",
  not_working: "The browser did the steps, but the app did not show what it should.",
  could_not_verify: "The browser could not finish the steps (for example the page did not load), so we can't say either way.",
  not_run: "This hasn't been run in a browser yet.",
};

export const FIX_STATUS_LABEL: Record<string, string> = {
  open: "Needs a look",
  task_ready: "Fix proposed",
  sent_to_agent: "Sent to your coding agent",
  agent_working: "Your coding agent is working on it",
  agent_reported: "Agent reports it's done; re-run to confirm",
  fixed: "Fixed, confirmed by a new run",
  still_failing: "Still failing after the fix",
  dismissed: "Dismissed",
};

/** The project the person is working on, so the journey links in the menu go somewhere useful. */
export function currentProject(): string | null {
  try {
    return window.localStorage.getItem("gl.currentProject");
  } catch {
    return null;
  }
}
export function rememberProject(id: string) {
  try {
    window.localStorage.setItem("gl.currentProject", id);
  } catch {
    // storage unavailable: the menu falls back to the project list
  }
}
