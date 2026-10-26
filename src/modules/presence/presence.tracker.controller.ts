import { RequestHandler } from 'express';
import { IPresenceService } from './presence.service.interface';
import { TRACKER_SCRIPT } from './presence.tracker-script';

/**
 * The shared tracker for the other Bambinos panels: the script itself, and the
 * endpoint its pings land on. Neither needs a session — the panels have their
 * own logins — so neither sits behind requireAuth.
 */
export class PresenceTrackerController {
  constructor(private readonly presenceService: IPresenceService) {}

  /** GET /tracker/presence.js */
  script: RequestHandler = (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    // Five minutes: a fix reaches every panel quickly, and a panel's every page
    // load does not cost a download.
    res.setHeader('Cache-Control', 'public, max-age=300');
    // helmet() defaults to same-origin, which would stop other sites loading it.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(TRACKER_SCRIPT);
  };

  /**
   * POST /tracker/collect — sent with navigator.sendBeacon as text/plain, so
   * the browser needs no CORS preflight and the panel reads nothing back.
   * 204 accepted, 400 refused (visible in the panel's Network tab when an
   * integration is being checked). A database hiccup is logged, never thrown
   * at the panel.
   */
  collect: RequestHandler = async (req, res) => {
    let body: unknown = null;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      body = null;
    }
    try {
      const accepted = await this.presenceService.recordPanelPing(req.header('origin'), body);
      res.status(accepted ? 204 : 400).end();
    } catch (error) {
      console.error('Presence tracker ping failed:', error instanceof Error ? error.message : error);
      res.status(204).end();
    }
  };
}
