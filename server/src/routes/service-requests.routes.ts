/**
 * Spa and dining requests — the guest-facing half.
 *
 * Two routes per kind: the menu, and sending a request. Answering requests and
 * editing the menu are in `admin.routes.ts`, behind admin sign-in.
 *
 * Same discipline as the booking routes: validate, call the store, shape the
 * response. Nothing here touches Prisma.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import { sendServiceRequestReceived } from '../emails/index.js';
import { asyncRoute } from '../middleware/errors.js';
import { createRequest, listOfferings } from '../service-requests/store.js';
import {
  createServiceRequestSchema,
  serviceKindSchema,
} from './service-requests.schemas.js';

const readRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

/**
 * Tight, like booking a room: every request emails the guest's address and
 * the team, so an unthrottled form is a way to fill both inboxes.
 */
const requestRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please try again shortly.',
    },
  },
});

export const serviceRequestRouter = Router();

/** The menu: spa treatments, or restaurants. Inactive ones are left out. */
serviceRequestRouter.get(
  '/:kind(spa|dining)/offerings',
  readRateLimit,
  asyncRoute(async (req, res) => {
    const kind = serviceKindSchema.parse(req.params.kind);
    res.json({ offerings: await listOfferings(kind) });
  }),
);

/**
 * Send a request. Answers with the reference and what was asked for — not a
 * confirmation: nothing is held until the team says yes.
 */
serviceRequestRouter.post(
  '/:kind(spa|dining)/requests',
  requestRateLimit,
  asyncRoute(async (req, res) => {
    const kind = serviceKindSchema.parse(req.params.kind);
    const draft = createServiceRequestSchema.parse(req.body);
    const request = await createRequest(kind, draft);

    res.status(201).json({ request });
    // After the response: a slow mail provider must not hold up the page, and
    // a failed send never undoes a request that has been recorded.
    void sendServiceRequestReceived(request);
  }),
);
