
// backend/src/routes/wipeRoutes.js

import express from "express";

import {
  startWipeController,
  getAllJobs,
  getJobById
} from "../controllers/wipeController.js";

import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * Create a pending wipe request.
 * POST /api/wipe/start
 */
router.post(
  "/start",
  authMiddleware,
  startWipeController
);

/**
 * Get all wipe jobs belonging to the authenticated user.
 * GET /api/wipe
 */
router.get(
  "/",
  authMiddleware,
  getAllJobs
);

/**
 * Get a single wipe job belonging to the authenticated user.
 * GET /api/wipe/:jobId
 */
router.get(
  "/:jobId",
  authMiddleware,
  getJobById
);

export default router;
