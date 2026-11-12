
import {
  requestDriveDiscovery
} from "../services/driveDiscovery.js";

export const discoverDemoDrives = async (req, res) => {
  try {
    const demoAgentId = process.env.TRUSTWIPE_DEMO_AGENT_ID;

    if (!demoAgentId) {
      return res.status(503).json({
        success: false,
        message: "Demo agent is not configured."
      });
    }

    // Request drives only from the configured demo agent.
    const result = await requestDriveDiscovery(
      null,
      demoAgentId
    );

    return res.status(200).json({
      success: true,
      message: "Demo drives discovered successfully.",
      devices: result.devices || result.drives || []
    });

  } catch (err) {
    console.error("Demo discovery error:", err.message);

    return res.status(
      err.code === "AGENT_NOT_FOUND" ||
      err.code === "AGENT_OFFLINE" ? 503 : 500
    ).json({
      success: false,
      message: err.message
    });
  }
};
