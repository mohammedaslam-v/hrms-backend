import express, { Router } from 'express';
import { PresenceTrackerController } from './presence.tracker.controller';

/**
 * The other Bambinos panels' presence: the script they load and where it
 * reports. No session (each panel has its own login); the origin is checked
 * in the service against *.bambinos.live.
 */
export const createPresenceTrackerRouter = (controller: PresenceTrackerController): Router => {
  const router = Router();
  router.get('/presence.js', controller.script);
  // Beacons arrive as text/plain; a ping is a few hundred bytes.
  router.post('/collect', express.text({ type: '*/*', limit: '4kb' }), controller.collect);
  return router;
};
