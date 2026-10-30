/**
 * Verification-code detection: local rules only, so it runs on every
 * incoming message with no model call and works with AI turned off.
 *
 * A code is accepted only when the message talks about verifying or signing
 * in, and the candidate sits next to that wording. Order numbers, prices,
 * years, phone numbers and promo codes are rejected.
 */

export interface CodeInput {
  subject: string;
  text: string | null;
}

/** The message as a whole has to be about a one-time code. */
const STRONG =
  /\b(verification|verify|verifying|one[- ]?time|otp|passcode|pass code|security code|login code|log-?in code|sign[- ]?in code|access code|auth(entication)? code|confirmation code|2fa|two[- ]?(factor|step)|mfa|multi[- ]?factor|enter (the |this )?code|(code|passcode|pin)(\s+is\b|\s*[:：]\s*)|id code|code (expires|is valid|will expire)|to (sign|log) ?in)\b/i;

/** Wording right before the code that marks it as the code. */
const LEAD_IN = /(code|passcode|otp|pin)\s*(is|was)?\s*[:：-]?\s*$|\b(is|use|enter)\s*[:：]?\s*$|[:：]\s*$/i;

/** Nearby wording that means the number is something else. */
const NOT_A_CODE =
  /\b(order|invoice|ticket|case|ref(erence)?|receipt|account( number)?|acct|ending( in)?|tracking|zip|postal|phone|tel|call|text|sms to|suite|apt|ext|unit|flight|room|gate|seat|total|amount|balance|price|qty|item|sku|model|version|v)\s*(no\.?|number|#)?\s*[:#]?\s*$/i;

const PROMO = /\b(\d{1,2}\s?% off|discount|promo|coupon|sale|save \$?\d|off your|free shipping)\b/i;

/** Digits (optionally 3+3 split, optionally with a G- style prefix), or an uppercase letter+digit mix. */
const CANDIDATE = /(?<![\w$#€£.@/:-])(?:[A-Z]-)?(\d{3}[ -]\d{3}|\d{4,8}|(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,8})(?![\w%@/]|[.,:-]\w)/g;

const URLISH = /\b(?:https?:\/\/|www\.)\S+|\S+@\S+\.\w+/gi;

interface Scored {
  value: string;
  score: number;
}

function score(haystack: string, match: RegExpExecArray, inSubject: boolean): Scored | null {
  const raw = match[1]!;
  const value = raw.replace(/[ -]/g, "");
  const before = haystack.slice(Math.max(0, match.index - 60), match.index);
  const after = haystack.slice(match.index + match[0].length, match.index + match[0].length + 40);
  const near = before.slice(-24);
  const alnum = /[A-Z]/.test(value);
  let s = 0;

  if (NOT_A_CODE.test(near)) return null;
  if (/[$€£]\s*$/.test(near) || /^\s*(%|percent|usd|dollars|years?|days?|hours?|minutes?|mins?|am|pm|items?)\b/i.test(after)) return null;
  // Promo codes look like codes; only accept letter mixes with clear sign-in wording right before.
  if (alnum && !LEAD_IN.test(before)) return null;
  if (PROMO.test(before + after)) {
    if (alnum) return null;
    s -= 6;
  }

  if (LEAD_IN.test(before)) s += 5;
  if (/\b(code|passcode|otp|pin|verification|verify|sign[- ]?in|log-?in)\b/i.test(before)) s += 3;
  if (/^\s*(is|as)\s+(your|the)\b.{0,40}\b(code|passcode|otp|pin)\b/i.test(after)) s += 5;
  if (/^\s*(to (sign|log) ?in|to verify|to confirm|to continue)\b/i.test(after)) s += 3;
  // Alone on its line, the way most code emails show it.
  if (/(^|\n)\s*$/.test(before) && /^\s*(\n|$)/.test(after)) s += 2;
  if (inSubject) s += 2;
  if (value.length === 4 && /^(19|20)\d\d$/.test(value)) s -= 4;
  if (value.length === 4) s -= 1;
  return { value, score: s };
}

function best(haystack: string, inSubject: boolean): Scored | null {
  let top: Scored | null = null;
  for (const m of haystack.matchAll(CANDIDATE)) {
    const r = score(haystack, m as RegExpExecArray, inSubject);
    if (r && (!top || r.score > top.score)) top = r;
  }
  return top;
}

/** The one-time code in a message, digits normalized ("482 913" → "482913"), or null. */
export function detectVerificationCode(m: CodeInput): string | null {
  const subject = m.subject.replace(URLISH, " ");
  const text = (m.text ?? "").slice(0, 6000).replace(URLISH, " ");
  if (!STRONG.test(subject) && !STRONG.test(text)) return null;
  const candidates = [best(subject, true), best(text, false)].filter((c): c is Scored => !!c);
  const top = candidates.sort((a, b) => b.score - a.score)[0];
  return top && top.score >= 3 ? top.value : null;
}

/** How long a code stays worth surfacing. */
export const CODE_TTL_MS = 15 * 60_000;
