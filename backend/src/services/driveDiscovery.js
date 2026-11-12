
/* ==========================================
   backend/src/services/driveDiscovery.js
========================================== */

import {
  getAgentInternal,
  isDemoAgent,
  requestDriveList,
} from "../socket/agentBridge.js";

/*
|--------------------------------------------------------------------------
| Error helper
|--------------------------------------------------------------------------
*/

const createDiscoveryError = (message, code) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

/*
|--------------------------------------------------------------------------
| Request drives from a specific agent
|--------------------------------------------------------------------------
*/

export const requestDriveDiscovery = async (
  userId,
  agentId = null
) => {
  let agent = null;

  /*
   * PUBLIC DEMO DISCOVERY
   *
   * Only the backend-configured demo agent is permitted.
   */

  if (agentId) {
    if (!isDemoAgent(agentId)) {
      throw createDiscoveryError(
        "Dedicated demo agent is unavailable.",
        "AGENT_NOT_FOUND"
      );
    }

    agent = getAgentInternal(agentId);

    if (!agent) {
      throw createDiscoveryError(
        "Demo agent not found.",
        "AGENT_NOT_FOUND"
      );
    }
  }

  /*
   * PRIVATE DISCOVERY
   *
   * Do not select an arbitrary agent from listOnlineAgents().
   * A verified user-to-agent ownership mapping is required.
   *
   * This implementation expects the authenticated user's
   * ID to be stored on the internal agent record as userId.
   */

  else {
    if (!userId) {
      throw createDiscoveryError(
        "Authenticated user ID is required.",
        "UNAUTHORIZED"
      );
    }

    const { getConnectedAgents } = await import(
      "../socket/agentBridge.js"
    );

    agent = getConnectedAgents().find(
      (item) =>
        item.userId === String(userId) &&
        item.status === "online" &&
        item.socket?.connected
    );

    if (!agent) {
      throw createDiscoveryError(
        "No authorized online TrustWipe Agent found.",
        "AGENT_NOT_FOUND"
      );
    }
  }

  /*
   * Request drive information.
   */

  const result = await requestDriveList(
    agent.agentId,
    userId
  );

  if (
    !result ||
    !Array.isArray(result.drives)
  ) {
    throw createDiscoveryError(
      "Invalid drive list received from TrustWipe Agent.",
      "INVALID_DRIVE_RESPONSE"
    );
  }

  /*
   * Normalize discovered drives.
   */

  const devices = result.drives.map((drive) => ({
    ...drive,

    agentId: agent.agentId,

    discoveredAt: new Date(),
  }));

  return {
    success: true,
    devices,
    message: `${devices.length} drive(s) discovered`,
  };
};

/*
|--------------------------------------------------------------------------
| AUTHENTICATED DISCOVERY CONTROLLER
|--------------------------------------------------------------------------
*/

export const discoverDrives = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        code: "UNAUTHORIZED",
        message: "Authentication required.",
      });
    }

    const result = await requestDriveDiscovery(
      String(req.user.id)
    );

    return res.status(200).json(result);

  } catch (err) {
    console.error(
      "Drive Discovery Error:",
      err.message
    );

    const status = {
      UNAUTHORIZED: 401,
      AGENT_NOT_FOUND: 404,
      AGENT_OFFLINE: 503,
      DRIVE_DISCOVERY_TIMEOUT: 504,
      INVALID_DRIVE_RESPONSE: 502,
    }[err.code] || 500;

    return res.status(status).json({
      success: false,
      message: err.message,
      code: err.code || "DRIVE_DISCOVERY_ERROR",
    });
  }
};

/*
|--------------------------------------------------------------------------
| PUBLIC DEMO DISCOVERY CONTROLLER
|--------------------------------------------------------------------------
|
| Requires:
| TRUSTWIPE_DEMO_AGENT_ID
|
| The corresponding agent must be registered as a dedicated
| demo agent by trusted server-side registration logic.
|
|--------------------------------------------------------------------------
*/

export const discoverDemoDrives = async (req, res) => {
  try {
    const demoAgentId = String(
      process.env.TRUSTWIPE_DEMO_AGENT_ID || ""
    ).trim();

    if (!demoAgentId) {
      return res.status(503).json({
        success: false,
        code: "DEMO_AGENT_NOT_CONFIGURED",
        message: "Public demo discovery is not configured.",
      });
    }

    const result = await requestDriveDiscovery(
      null,
      demoAgentId
    );

    return res.status(200).json(result);

  } catch (err) {
    console.error(
      "Demo Drive Discovery Error:",
      err.message
    );

    const status = {
      AGENT_NOT_FOUND: 503,
      AGENT_OFFLINE: 503,
      DRIVE_DISCOVERY_TIMEOUT: 504,
      INVALID_DRIVE_RESPONSE: 502,
    }[err.code] || 500;

    return res.status(status).json({
      success: false,
      message: err.message,
      code: err.code || "DEMO_DRIVE_DISCOVERY_ERROR",
    });
  }
};
