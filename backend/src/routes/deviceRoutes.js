
import express from "express";

import {
  getDevices,
  getDeviceById,
  createDevice,
  updateDevice,
  deleteDevice,
} from "../controllers/deviceController.js";

import {
  discoverDemoDrives,
} from "../controllers/demoDeviceController.js";

import {
  discoverDrives,
} from "../services/driveDiscovery.js";

import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

// ============================================================
// PUBLIC ROUTES
// ============================================================

/**
 * GET /api/devices/test-drive-route
 *
 * Public route health check.
 */
router.get("/test-drive-route", (_req, res) => {
  return res.status(200).json({
    success: true,
    message: "Device routes mounted correctly.",
  });
});

/**
 * GET /api/devices/discover
 *
 * Public demo discovery.
 * Must return simulated drives only.
 * No physical agent or login should be required.
 */
router.get("/discover", discoverDemoDrives);

// ============================================================
// AUTHENTICATED REAL DEVICE DISCOVERY
// ============================================================

/**
 * GET /api/devices/discover/private
 *
 * Real physical-device discovery.
 * Requires authentication and a trusted agent.
 */
router.get(
  "/discover/private",
  authMiddleware,
  discoverDrives
);

// ============================================================
// AUTHENTICATED AGENT DRIVE DISCOVERY
// ============================================================

/**
 * GET /api/devices/:agentId/drives
 *
 * Requires authentication.
 */
router.get(
  "/:agentId/drives",
  authMiddleware,
  async (req, res) => {
    try {
      const agentId = String(req.params.agentId || "").trim();

      if (!agentId) {
        return res.status(400).json({
          success: false,
          code: "AGENT_ID_REQUIRED",
          message: "Agent ID is required.",
        });
      }

      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          code: "AUTHENTICATION_REQUIRED",
          message: "Authentication required.",
        });
      }

      const agentBridge = req.app.get("agentBridge");

      if (
        !agentBridge ||
        typeof agentBridge.requestDriveList !== "function"
      ) {
        return res.status(503).json({
          success: false,
          code: "AGENT_BRIDGE_UNAVAILABLE",
          message: "TrustWipe Agent bridge is unavailable.",
        });
      }

      const result = await agentBridge.requestDriveList(agentId);

      const drives = Array.isArray(result?.drives)
        ? result.drives
        : [];

      return res.status(200).json({
        success: true,
        agentId,
        drives,
      });

    } catch (error) {
      console.error("Agent drive discovery error:", error);

      const status = {
        AGENT_NOT_FOUND: 404,
        AGENT_OFFLINE: 503,
        DRIVE_DISCOVERY_TIMEOUT: 504,
      }[error.code] || 500;

      return res.status(status).json({
        success: false,
        code: error.code || "DRIVE_DISCOVERY_ERROR",
        message: error.message || "Unable to discover drives.",
      });
    }
  }
);

// ============================================================
// AUTHENTICATED DEVICE MANAGEMENT
// ============================================================

/**
 * POST /api/devices
 *
 * Register a real device.
 */
router.post(
  "/",
  authMiddleware,
  createDevice
);

/**
 * GET /api/devices
 *
 * Get devices belonging to the authenticated user.
 */
router.get(
  "/",
  authMiddleware,
  getDevices
);

/**
 * GET /api/devices/:id
 *
 * Get one device.
 */
router.get(
  "/:id",
  authMiddleware,
  getDeviceById
);

/**
 * PUT /api/devices/:id
 *
 * Update a device.
 */
router.put(
  "/:id",
  authMiddleware,
  updateDevice
);

/**
 * PATCH /api/devices/:id
 *
 * Partially update a device.
 */
router.patch(
  "/:id",
  authMiddleware,
  updateDevice
);

/**
 * DELETE /api/devices/:id
 *
 * Delete a device.
 */
router.delete(
  "/:id",
  authMiddleware,
  deleteDevice
);

export default router;
