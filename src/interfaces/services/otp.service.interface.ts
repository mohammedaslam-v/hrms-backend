import { OtpChallenge, OtpPurpose } from '../../models/auth.model';

export interface IOtpService {
  /**
   * Issues a fresh challenge and delivers the code. Any earlier open challenge
   * for the same employee and purpose is consumed, so only one code is ever live.
   */
  issue(
    employeeId: number,
    deliverTo: string,
    purpose: OtpPurpose,
    ipAddress: string | null,
  ): Promise<OtpChallenge>;

  /** Same as issue(), but refuses while the resend cooldown is still running. */
  resend(challengeId: string, ipAddress: string | null): Promise<OtpChallenge>;

  /**
   * Consumes the challenge on success. On failure the attempt is counted, and the
   * challenge is burned once the attempt limit is reached.
   * Returns the employee the challenge belonged to.
   */
  verify(
    challengeId: string,
    code: string,
    purpose: OtpPurpose,
    options?: { consume?: boolean },
  ): Promise<number>;
}
