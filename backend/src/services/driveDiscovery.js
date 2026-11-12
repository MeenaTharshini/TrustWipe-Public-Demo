
/* ==========================================
   backend/src/services/driveDiscovery.js
========================================== */

import {
  getAgentInternal,
  isDemoAgent,
  isAgentConnected,
  requestDriveList,
} from "../socket/agentBridge.js";

// ------------------------------------------------------------
// ERROR HELPER
// ------------------------------------------------------------

const createDiscoveryError = (message, code) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

// ------------------------------------------------------------
// SERVER-SIDE USER / AGENT MAPPING
// ------------------------------------------------------------

/*
 * Configure this on Render as a JSON environment variable:
 *
 * TRUSTWIPE_USER_AGENT_MAP={"USER_ID":"AGENT_ID"}
 *
 * This mapping must be maintained by the backend.
 * Do not accept ownership mappings from frontend requests
 * or agent registration payloads.
 */

const getUserAgentMapping = () => {
  try {
    const raw = process.env.TRUSTWIPE_USER_AGENT_MAP;

    if (!raw) return {};

    const parsed = JSON.parse(raw);

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return {};
    }

    return parsed;
  } catch (error) {
    console.error(
      "Invalid TRUSTWIPE_USER_AGENT_MAP:",
      error.message
    );

    return {};
  }
};

// ------------------------------------------------------------
// REQUEST DRIVE DISCOVERY
// ------------------------------------------------------------

export const requestDriveDiscovery = async (
  userId,
  agentId = null
) => {
  let agent;

  // ----------------------------------------------------------
  // PUBLIC DEMO DISCOVERY
  // ----------------------------------------------------------

  if (agentId) {
    if (!isDemoAgent(agentId)) {
      throw createDiscoveryError(
        "Requested agent is not the configured demo agent.",
        "AGENT_NOT_FOUND"
      );
    }

    agent = getAgentInternal(agentId);

    if (!agent || !agent.authenticated) {
      throw createDiscoveryError(
        "Dedicated demo agent is not authenticated.",
        "AGENT_NOT_FOUND"
      );
    }

    if (!isAgentConnected(agentId)) {
      throw createDiscoveryError(
        "Dedicated demo agent is offline.",
        "AGENT_OFFLINE"
      );
    }
  }

  // ----------------------------------------------------------
  // PRIVATE AUTHENTICATED DISCOVERY
  // ----------------------------------------------------------

  else {
    if (!userId) {
      throw createDiscoveryError(
        "Authenticated user ID is required.",
        "UNAUTHORIZED"
      );
    }

    const mapping = getUserAgentMapping();

    const mappedAgentId = String(
      mapping[String(userId)] || ""
    ).trim();

    if (!mappedAgentId) {
      throw createDiscoveryError(
        "No agent is assigned to this user.",
        "AGENT_NOT_FOUND"
      );
    }

    agent = getAgentInternal(mappedAgentId);

    if (!agent || !agent.authenticated) {
      throw createDiscoveryError(
        "Assigned agent is not authenticated.",
        "AGENT_NOT_FOUND"
      );
    }

    if (!isAgentConnected(mappedAgentId)) {
      throw createDiscoveryError(
        "Assigned agent is offline.",
        "AGENT_OFFLINE"
      );
    }

    agentId = mappedAgentId;
  }

  // ----------------------------------------------------------
  // REQUEST DRIVE LIST
  // ----------------------------------------------------------

  const result = await requestDriveList(agent.agentId);

  if (!result || !Array.isArray(result.drives)) {
    throw createDiscoveryError(
      "Invalid drive list received from TrustWipe Agent.",
      "INVALID_DRIVE_RESPONSE"
    );
  }

  // ----------------------------------------------------------
  // NORMALIZE RESULTS
  // ----------------------------------------------------------

  const devices = result.drives.map((drive) => ({
    ...drive,
    agentId: agent.agentId,
    discoveredAt: new Date(),
    isDemo: isDemoAgent(agent.agentId),
  }));

  return {
    success: true,
    demo: isDemoAgent(agent.agentId),
    devices,
    message: `${devices.length} drive(s) discovered.`,
  };
};

// ------------------------------------------------------------
// AUTHENTICATED DISCOVERY CONTROLLER
// ------------------------------------------------------------

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
    console.error("Drive Discovery Error:", err.message);

    const status = {
      UNAUTHORIZED: 401,
      AGENT_NOT_FOUND: 404,
      AGENT_OFFLINE: 503,
      DRIVE_DISCOVERY_TIMEOUT: 504,
      INVALID_DRIVE_RESPONSE: 502,
    }[err.code] || 500;

    return res.status(status).json({
      success: false,
      code: err.code || "DRIVE_DISCOVERY_ERROR",
      message: err.message,
    });
  }
};

// ------------------------------------------------------------
// PUBLIC DEMO DISCOVERY CONTROLLER
// ------------------------------------------------------------

export const discoverDemoDrives = async (_req, res) => {
  try {
    const demoAgentId = String(
      process.env.TRUSTWIPE_DEMO_AGENT_ID || ""
    ).trim();

    if (!demoAgentId) {
      return res.status(503).json({
        success: false,
        code: "DEMO_AGENT_NOT_CONFIGURED",
        message: "Public demo agent is not configured.",
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
      code: err.code || "DEMO_DRIVE_DISCOVERY_ERROR",
      message: err.message,
    });
  }
};
