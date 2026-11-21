// Who may approve what, server-side.
//
// Accounts that require browser approval (GREENLIGHT_BROWSER_APPROVAL_ACCOUNTS, default "xdgram",
// plus every account with a configured approver) can only be certified with a browser approval
// that (1) is an intact web approval of exactly the tests, (2) carries a valid HMAC-SHA256
// signature made with GREENLIGHT_APPROVAL_SIGNING_KEY, which only the server holds (database or
// API access alone cannot produce one), and (3) was given by a configured approver of that account.
// Every Google account (g-<hash>, Sign in with Google) also requires one, given by the Google
// identity that account belongs to.
// Owner-token approvals are refused for those accounts. Other accounts keep the existing rules.

import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "../evidence/hash.js";
import { webApprovalValidFor } from "./models.js";

export const SIGNATURE_ALG = "HMAC-SHA256";

/** Public identifier of a signing key (for rotation), never the key itself. */
export const keyIdOf = (key) => createHash("sha256").update(`greenlight-approval-key-id:${key}`).digest("hex").slice(0, 16);

const signedPayload = (record) => {
  const { recordSha256, signature, ...rest } = record;
  return canonicalJson(rest);
};

/** Signature over the whole record except its signature and self-hash. */
export function signApproval(key, record) {
  return { alg: SIGNATURE_ALG, keyId: keyIdOf(key), value: createHmac("sha256", key).update(signedPayload(record)).digest("hex") };
}

export function approvalSignatureValid(key, record) {
  const s = record?.signature;
  if (!key || !s || s.alg !== SIGNATURE_ALG || s.keyId !== keyIdOf(key) || !/^[0-9a-f]{64}$/.test(s.value ?? "")) return false;
  const want = Buffer.from(createHmac("sha256", key).update(signedPayload(record)).digest("hex"), "hex");
  return timingSafeEqual(want, Buffer.from(s.value, "hex"));
}

/** The Greenlight account of a Google identity: g- and the first 24 hex of SHA-256(subject). */
export const googleAccount = (subject) => `g-${createHash("sha256").update(`greenlight-google:${subject}`).digest("hex").slice(0, 24)}`;
export const isGoogleAccount = (account) => /^g-[0-9a-f]{24}$/.test(String(account ?? ""));

/** Configured accounts and every Google account: only signed browser approvals certify. */
export const browserApprovalRequired = (config, account) => Boolean(account) && (config.browserApprovalAccounts.includes(account) || isGoogleAccount(account));

/** {ok, reason}: is this a verified browser approval by an approver of `account` for exactly `hash`? */
export function verifyBrowserApproval(config, approval, hash, account) {
  if (!approval) return { ok: false, reason: "no_approval" };
  if (!webApprovalValidFor(approval, hash)) return { ok: false, reason: approval.channel ? "not_valid_for_these_tests" : "not_a_browser_approval" };
  if (approval.identity.provider === "google") {
    // A Google user approves only their own account's tests, as its single owner user.
    if (!config.google || !approvalSignatureValid(config.approvalSigningKey, approval)) return { ok: false, reason: approval.signature ? "signature_invalid" : "unsigned" };
    if (!isGoogleAccount(account) || googleAccount(approval.identity.subject) !== account || approval.approvedBy !== "owner") return { ok: false, reason: "not_an_approver_of_this_account" };
    return { ok: true, reason: null };
  }
  if (!config.webApproval || !approvalSignatureValid(config.approvalSigningKey, approval)) return { ok: false, reason: approval.signature ? "signature_invalid" : "unsigned" };
  const approver = config.webApproval.approvers.find((a) => a.account === account && a.vercelSub === approval.identity.subject);
  if (!approver || approver.user !== approval.approvedBy) return { ok: false, reason: "not_an_approver_of_this_account" };
  return { ok: true, reason: null };
}
