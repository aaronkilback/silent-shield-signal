import { describe, it, expect, vi } from 'vitest';
import {
  submitRecoveryOtp,
  validateNewPassword,
  validateRecoveryCode,
  canResend,
  resendRemainingMs,
  RESEND_COOLDOWN_MS,
} from '@/pages/resetPasswordFlow';

const goodPw = 'Aa1!aaaa'; // 8 chars, upper+digit+special

function deps(verifyErr: unknown | null, updateErr: unknown | null = null) {
  const verifyOtp = vi.fn(async () => ({ error: verifyErr }));
  const updateUser = vi.fn(async () => ({ error: updateErr }));
  return { verifyOtp, updateUser };
}

describe('resetPasswordFlow — Auth Recovery Slice', () => {
  it('VALID code: verifyOtp then updateUser, status ok', async () => {
    const d = deps(null, null);
    const r = await submitRecoveryOtp(d, { email: 'u@example.com', code: '123456', password: goodPw, confirm: goodPw });
    expect(r.status).toBe('ok');
    expect(d.verifyOtp).toHaveBeenCalledOnce();
    expect(d.verifyOtp).toHaveBeenCalledWith({ email: 'u@example.com', token: '123456', type: 'recovery' });
    expect(d.updateUser).toHaveBeenCalledOnce();
    // ordering: verifyOtp resolved before updateUser invoked
    expect(d.verifyOtp.mock.invocationCallOrder[0]).toBeLessThan(d.updateUser.mock.invocationCallOrder[0]);
  });

  it('INVALID code: updateUser is NEVER called', async () => {
    const d = deps(new Error('otp invalid'));
    const r = await submitRecoveryOtp(d, { email: 'u@example.com', code: '000000', password: goodPw, confirm: goodPw });
    expect(r.status).toBe('invalid_code');
    expect(d.verifyOtp).toHaveBeenCalledOnce();
    expect(d.updateUser).not.toHaveBeenCalled();
  });

  it('EXPIRED code: same generic invalid_code path, updateUser not called', async () => {
    const d = deps({ message: 'Token has expired or is invalid' });
    const r = await submitRecoveryOtp(d, { email: 'u@example.com', code: '654321', password: goodPw, confirm: goodPw });
    expect(r.status).toBe('invalid_code');
    expect(d.updateUser).not.toHaveBeenCalled();
  });

  it('updateUser cannot run before OTP verification succeeds (validation short-circuits before any call)', async () => {
    const d = deps(null, null);
    // bad code -> never reaches verifyOtp or updateUser
    const r1 = await submitRecoveryOtp(d, { email: 'u@example.com', code: '12', password: goodPw, confirm: goodPw });
    expect(r1.status).toBe('validation');
    expect(d.verifyOtp).not.toHaveBeenCalled();
    expect(d.updateUser).not.toHaveBeenCalled();
    // weak password -> never reaches verifyOtp or updateUser
    const r2 = await submitRecoveryOtp(d, { email: 'u@example.com', code: '123456', password: 'weak', confirm: 'weak' });
    expect(r2.status).toBe('validation');
    expect(d.verifyOtp).not.toHaveBeenCalled();
    expect(d.updateUser).not.toHaveBeenCalled();
  });

  it('update failure after valid OTP surfaces a generic update error', async () => {
    const d = deps(null, new Error('network'));
    const r = await submitRecoveryOtp(d, { email: 'u@example.com', code: '123456', password: goodPw, confirm: goodPw });
    expect(r.status).toBe('update_failed');
    expect(d.updateUser).toHaveBeenCalledOnce();
  });

  it('RESEND cooldown: blocked for 60s after a send, then allowed', () => {
    const t0 = 1_000_000;
    expect(canResend(null, t0)).toBe(true);            // never sent -> allowed
    expect(canResend(t0, t0)).toBe(false);             // just sent -> blocked
    expect(resendRemainingMs(t0, t0 + 30_000)).toBe(30_000);
    expect(canResend(t0, t0 + 30_000)).toBe(false);
    expect(canResend(t0, t0 + RESEND_COOLDOWN_MS + 1)).toBe(true); // cooldown elapsed
  });

  it('input validators enforce 6-digit code + password policy', () => {
    expect(validateRecoveryCode('123456').ok).toBe(true);
    expect(validateRecoveryCode('12ab56').ok).toBe(false);
    expect(validateRecoveryCode('12345').ok).toBe(false);
    expect(validateNewPassword(goodPw, goodPw).ok).toBe(true);
    expect(validateNewPassword('Aa1!aaaa', 'different').ok).toBe(false);
    expect(validateNewPassword('nolower1!', 'nolower1!').ok).toBe(false); // no uppercase
  });
});
