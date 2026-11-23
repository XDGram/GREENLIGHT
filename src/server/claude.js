// One place for Greenlight's calls to Claude (application understanding, test-plan revision, the
// Fix Centre). The API key stays on the server; user-provided text and page or repository content
// always go in the user turn as data, inside tags, never in the system prompt. Errors become stable
// Greenlight errors; the operator log gets the error type and status only.

import { loadAnthropic, loadedAnthropic } from "./anthropic-sdk.js";
import { GreenlightError } from "../cli/errors.js";

export const aiConfigured = (config, client) => Boolean(client) || Boolean(config.ai?.apiKey);

export function mapAnthropicError(err, log = () => {}) {
  const Anthropic = loadedAnthropic();
  if (!Anthropic) return null;
  log({ event: "ai_error", type: err?.constructor?.name ?? "Error", status: err?.status ?? null, requestId: err?.requestID ?? null });
  if (err instanceof Anthropic.RateLimitError) return new GreenlightError("ai_failed", "The AI is busy right now; try again in a minute.");
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return new GreenlightError("ai_unavailable", "AI is not available on this server right now.");
  if (err instanceof Anthropic.NotFoundError || err instanceof Anthropic.BadRequestError) return new GreenlightError("ai_unavailable", "AI is not available on this server right now (the configured model is not available to its API key).");
  if (err instanceof Anthropic.APIError || err instanceof Anthropic.APIConnectionError) return new GreenlightError("ai_failed", "The AI could not be reached; try again.");
  return null;
}

/**
 * @param {object} p
 * @param {string} p.system
 * @param {{role: "user"|"assistant", content: string}[]} p.messages
 * @param {object} [p.schema]   JSON schema: the answer is parsed and returned as an object
 * @returns {Promise<object|string>}
 */
export async function askClaude({ config, client, system, messages, schema, maxTokens = 4000, effort = "low", log = () => {}, timeoutMs = 45_000 }) {
  if (!aiConfigured(config, client)) throw new GreenlightError("ai_unavailable", "AI is not configured on this server.");
  const Anthropic = await loadAnthropic();
  const anthropic = client ?? new Anthropic({ apiKey: config.ai.apiKey, timeout: timeoutMs, maxRetries: 0 });
  let response;
  try {
    response = await anthropic.beta.messages.create({
      model: config.ai?.model ?? "claude-opus-5-5",
      max_tokens: maxTokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      output_config: { effort, ...(schema ? { format: { type: "json_schema", schema } } : {}) },
      messages,
    });
  } catch (err) {
    throw mapAnthropicError(err, log) ?? err;
  }
  if (response.stop_reason === "refusal") throw new GreenlightError("ai_failed", "The AI declined this request.");
  if (response.stop_reason === "max_tokens") throw new GreenlightError("ai_failed", "The answer was too long; ask something narrower.");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  if (!schema) return text;
  try {
    return JSON.parse(text);
  } catch {
    throw new GreenlightError("ai_failed", "The AI's answer could not be read; try again.");
  }
}

/** Wrap untrusted content for the user turn. */
export const asData = (tag, value) => `<${tag}>\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n</${tag}>`;
