
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

// ------------------------------------------------------------
// PUBLIC ROUTES
// ------------------------------------------------------------

// GET /api/devices/test-drive-route
// Basic route availability check.
router.get("/test-drive-route", (_req, res) => {
  return res.status(200).json({
    success: true,
    message: "Device routes mounted correctly.",
  });
});

// ------------------------------------------------------------
// PUBLIC DEMO DRIVE DISCOVERY
// ------------------------------------------------------------

// GET /api/devices/discover
//
// No login required.
// This endpoint must return simulated demo drives only.
// It must never expose unrestricted physical-drive discovery.

router.get("/discover", discoverDemoDrives);

// ------------------------------------------------------------
// AUTHENTICATED REAL DRIVE DISCOVERY
// ------------------------------------------------------------

// GET /api/devices/discover/private
//
// Requires a logged-in user.
// Real discovery must use a trusted, authenticated agent.

router.get(
  "/discover/private",
  authMiddleware,
  discoverDrives
);

// ------------------------------------------------------------
// AUTHENTICATED AGENT-SPECIFIC DRIVE DISCOVERY
// ------------------------------------------------------------

// GET /api/devices/:agentId/drives
//
// Requires login.
// The agent bridge must independently verify that the
// requested agent is trusted and authorized for this user.

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

      if (!req.user?.id) {
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

      const result = await agentBridge.requestDriveList(
        agentId,
        req.user.id
      );

      const drives = Array.isArray(result?.drives)
        ? result.drives
        : [];

      return res.status(200).json({
        success: true,
        agentId,
        drives,
      });
    } catch (error) {
      console.error(
        "Agent drive discovery error:",
        error
      );

      const status = {
        AGENT_NOT_FOUND: 404,
        AGENT_OFFLINE: 503,
        DRIVE_DISCOVERY_TIMEOUT: 504,
      }[error.code] || 500;

      return res.status(status).json({
        success: false,
        code: error.code || "DRIVE_DISCOVERY_ERROR",
        message:
          error.message || "Unable to discover drives.",
      });
    }
  }
);

// ------------------------------------------------------------
// AUTHENTICATED DEVICE CREATION
// ------------------------------------------------------------

// POST /api/devices

router.post(
  "/",
  authMiddleware,
  createDevice
);

// ------------------------------------------------------------
// AUTHENTICATED DEVICE LIST
// ------------------------------------------------------------

// GET /api/devices

router.get(
  "/",
  authMiddleware,
  getDevices
);

// ------------------------------------------------------------
// AUTHENTICATED DEVICE BY ID
// ------------------------------------------------------------

// GET /api/devices/:id

router.get(
  "/:id",
  authMiddleware,
  getDeviceById
);

// ------------------------------------------------------------
// AUTHENTICATED DEVICE UPDATE
// ------------------------------------------------------------

// PUT /api/devices/:id

router.put(
  "/:id",
  authMiddleware,
  updateDevice
);

// PATCH /api/devices/:id

router.patch(
  "/:id",
  authMiddleware,
  updateDevice
);

// ------------------------------------------------------------
// AUTHENTICATED DEVICE DELETE
// ------------------------------------------------------------

// DELETE /api/devices/:id

router.delete(
  "/:id",
  authMiddleware,
  deleteDevice
);

export default router;
