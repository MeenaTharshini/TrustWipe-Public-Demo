
import express from "express";

import {
  startWipeController,
  approveWipeController,
  getAllJobs,
  getJobById
} from "../controllers/wipeController.js";

import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

// Create a pending wipe request.
router.post(
  "/start",
  authMiddleware,
  startWipeController
);

// Explicit owner approval.
router.post(
  "/:jobId/approve",
  authMiddleware,
  approveWipeController
);

// Get the authenticated user's wipe jobs.
router.get(
  "/",
  authMiddleware,
  getAllJobs
);

// Get one job belonging to the authenticated user.
router.get(
  "/:jobId",
  authMiddleware,
  getJobById
);

export default router;
