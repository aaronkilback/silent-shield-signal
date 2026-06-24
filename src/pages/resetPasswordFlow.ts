// Auth Recovery Slice (staging) — pure, testable flow logic.
//
// No I/O, no logging, no secrets stored. The React page injects the Supabase
// calls (verifyOtp / updateUser) so the critical ordering — updateUser may run
// ONLY after a successful OTP verification — is unit-provable. Error messages are
// generic (no account enumeration). Nothing here logs email/OTP/token/password.

export const PW_MIN = 8;
export const RESEND_COOLDOWN_MS = 60_000;

// Generic, enumeration-safe user messages.
export const GENERIC_OTP_ERROR = "Invalid or expired code. Re-enter it or request a new code.";
export const GENERIC_RATELIMIT = "Too many requests — please wait a moment, then try again.";
export const GENERIC_UPDATE_ERROR = "Could not set the new password. Please try again.";

export function validateNewPassword(pw: string, confirm: string): { ok: boolean; error?: string } {
  if (pw !== confirm) return { ok: false, error: "Passwords do not match" };
  if (pw.length < PW_MIN) return { ok: false, error: "Password must be at least 8 characters" };
  if (!/[A-Z]/.test(pw) || !/[0-9]/.test(pw) || !/[^A-Za-z0-9]/.test(pw)) {
    return { ok: false, error: "Must contain uppercase, number, and special character" };
  }
  return { ok: true };
}

export function validateRecoveryCode(code: string): { ok: boolean; error?: string } {
  if (!/^[0-9]{6}$/.test((code ?? "").trim())) {
    return { ok: false, error: "Enter the 6-digit code from your email" };
  }
  return { ok: true };
}

// Resend cooldown helpers (pure; `now` injected for deterministic tests).
export function resendRemainingMs(lastSentAt: number | null, now: number): number {
  if (!lastSentAt) return 0;
  return Math.max(0, RESEND_COOLDOWN_MS - (now - lastSentAt));
}
export function canResend(lastSentAt: number | null, now: number): boolean {
  return resendRemainingMs(lastSentAt, now) === 0;
}

export interface RecoveryDeps {
  verifyOtp: (args: { email: string; token: string; type: "recovery" }) => Promise<{ error: unknown | null }>;
  updateUser: (args: { password: string }) => Promise<{ error: unknown | null }>;
}

export type RecoveryResult =
  | { status: "ok" }
  | { status: "validation"; error: string }
  | { status: "invalid_code" } // verifyOtp failed (invalid OR expired) — generic, no enumeration
  | { status: "update_failed"; error: string };

// Orchestration contract: validate inputs -> verifyOtp -> ONLY on success -> updateUser.
// updateUser is NEVER invoked unless verifyOtp resolved without error.
export async function submitRecoveryOtp(
  deps: RecoveryDeps,
  input: { email: string; code: string; password: string; confirm: string },
): Promise<RecoveryResult> {
  const codeCheck = validateRecoveryCode(input.code);
  if (!codeCheck.ok) return { status: "validation", error: codeCheck.error! };
  const pwCheck = validateNewPassword(input.password, input.confirm);
  if (!pwCheck.ok) return { status: "validation", error: pwCheck.error! };
  if (!input.email.trim()) return { status: "validation", error: "Enter your email" };

  const verify = await deps.verifyOtp({
    email: input.email.trim(),
    token: input.code.trim(),
    type: "recovery",
  });
  if (verify.error) return { status: "invalid_code" }; // generic for invalid AND expired

  const upd = await deps.updateUser({ password: input.password });
  if (upd.error) return { status: "update_failed", error: GENERIC_UPDATE_ERROR };
  return { status: "ok" };
}
