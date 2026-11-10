import { SettleSummary } from './productivity.model';

export interface IProductivityService {
  /**
   * Starts a settlement run in the background, at most every few minutes per
   * instance. Called on API traffic; never throws and never waits.
   */
  kick(): void;

  /** Decides every Sales day that is due and not yet decided. One run at a time. */
  settleDue(): Promise<SettleSummary>;
}
