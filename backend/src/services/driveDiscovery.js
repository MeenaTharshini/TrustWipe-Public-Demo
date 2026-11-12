
import {
  listOnlineAgents,
  requestDriveList,
} from "../socket/agentBridge.js";

/*
|--------------------------------------------------------------------------
| Find a connected agent by ID
|--------------------------------------------------------------------------
*/
const findOnlineAgent = (agentId) => {
  const agents = listOnlineAgents();

  return agents.find(
    (agent) =>
      agent.agentId === agentId ||
      agent.deviceId === agentId
  );
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
  const agents = listOnlineAgents();

  if (!agents.length) {
    const error = new Error("No TrustWipe Agent Connected");
    error.code = "AGENT_NOT_FOUND";
    throw error;
  }

  const agent = agentId
    ? findOnlineAgent(agentId)
    : agents.find((item) => item.userId === userId);

  if (!agent) {
    const error = new Error(
      "No authorized online TrustWipe Agent found"
    );
    error.code = "AGENT_NOT_FOUND";
    throw error;
  }

  const result = await requestDriveList(
    agent.agentId,
    userId
  );

  if (!result || !Array.isArray(result.drives)) {
    const error = new Error(
      "Invalid drive list received from TrustWipe Agent"
    );
    error.code = "INVALID_DRIVE_RESPONSE";
    throw error;
  }

  const devices = result.drives.map((drive) => ({
    ...drive,
    agentId:
      result.deviceId ||
      result.agentId ||
      agent.deviceId ||
      agent.agentId,
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
| Authenticated discovery controller
|--------------------------------------------------------------------------
*/
export const discoverDrives = async (req, res) => {
  try {
    const result = await requestDriveDiscovery(
      req.user.id
    );

    return res.status(200).json(result);
  } catch (err) {
    console.error("Drive Discovery Error:", err);

    const status = {
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
| Public demo discovery controller
|--------------------------------------------------------------------------
| This must be restricted to a dedicated demo agent.
| Configure TRUSTWIPE_DEMO_AGENT_ID on the backend.
|--------------------------------------------------------------------------
*/
export const discoverDemoDrives = async (req, res) => {
  try {
    const demoAgentId = process.env.TRUSTWIPE_DEMO_AGENT_ID;

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
    console.error("Demo Drive Discovery Error:", err);

    const status = {
      AGENT_NOT_FOUND: 404,
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
