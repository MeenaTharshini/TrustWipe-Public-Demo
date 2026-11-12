
import express from "express";

import {
  getDevices,
  createDevice,
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

/*
|--------------------------------------------------------------------------
| TEST ROUTE
|--------------------------------------------------------------------------
| GET /api/devices/test-drive-route
|--------------------------------------------------------------------------
*/
router.get("/test-drive-route", (_req, res) => {
  return res.status(200).json({
    success: true,
    message: "Device routes mounted correctly",
  });
});

/*
|--------------------------------------------------------------------------
| PUBLIC DEMO DRIVE DISCOVERY
|--------------------------------------------------------------------------
| GET /api/devices/discover
|
| No login required.
| Must use a dedicated, isolated demo agent.
|--------------------------------------------------------------------------
*/
router.get("/discover", discoverDemoDrives);

/*
|--------------------------------------------------------------------------
| AUTHENTICATED DRIVE DISCOVERY
|--------------------------------------------------------------------------
| GET /api/devices/discover/private
|
| Discovers drives through the authenticated user's agent.
|--------------------------------------------------------------------------
*/
router.get(
  "/discover/private",
  authMiddleware,
  discoverDrives
);

/*
|--------------------------------------------------------------------------
| CREATE DEVICE
|--------------------------------------------------------------------------
| POST /api/devices
| Authentication required.
|--------------------------------------------------------------------------
*/
router.post(
  "/",
  authMiddleware,
  createDevice
);

/*
|--------------------------------------------------------------------------
| DELETE DEVICE
|--------------------------------------------------------------------------
| DELETE /api/devices/:id
| Authentication required.
|--------------------------------------------------------------------------
*/
router.delete(
  "/:id",
  authMiddleware,
  deleteDevice
);

/*
|--------------------------------------------------------------------------
| GET ALL DEVICES
|--------------------------------------------------------------------------
| GET /api/devices
| Authentication required.
|--------------------------------------------------------------------------
*/
router.get(
  "/",
  authMiddleware,
  getDevices
);

/*
|--------------------------------------------------------------------------
| GET DRIVES FROM A SPECIFIC AGENT
|--------------------------------------------------------------------------
| GET /api/devices/:agentId/drives
| Authentication required.
|--------------------------------------------------------------------------
*/
router.get(
  "/:agentId/drives",
  authMiddleware,
  async (req, res) => {
    try {
      const agentId = String(
        req.params.agentId || ""
      ).trim();

      if (!agentId) {
        return res.status(400).json({
          success: false,
          code: "AGENT_ID_REQUIRED",
          message: "Agent ID is required.",
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

      const data = await agentBridge.requestDriveList(
        agentId,
        req.user.id
      );

      const drives = Array.isArray(data?.drives)
        ? data.drives
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
        code:
          error.code || "DRIVE_DISCOVERY_ERROR",
        message:
          error.message ||
          "Unable to discover drives.",
      });
    }
  }
);

export default router;
