
/* ==========================================
   backend/src/socket/agentBridge.js
   TrustWipe - Secure Agent Bridge
========================================== */

import crypto from "crypto";

/* ==========================================
   SOCKET INSTANCE
========================================== */

let ioInstance = null;

/* ==========================================
   CONNECTED AGENTS
========================================== */

const connectedAgents = new Map();

/* ==========================================
   PENDING REQUESTS
========================================== */

const pendingDiscovery = new Map();
const pendingDriveDiscovery = new Map();

/* ==========================================
   AGENT CREDENTIALS
========================================== */

const parseAgentCredentials = () => {
  try {
    const raw = process.env.TRUSTWIPE_AGENT_CREDENTIALS;

    if (!raw) return {};

    const parsed = JSON.parse(raw);

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error("Invalid agent credentials format.");
    }

    return parsed;
  } catch (error) {
    console.error(
      "Agent credential configuration error:",
      error.message
    );

    return {};
  }
};

/*
 * Load credentials when the module starts.
 * Restart the backend after changing credentials.
 */
const agentCredentials = parseAgentCredentials();

/* ==========================================
   TOKEN COMPARISON
========================================== */

const safeTokenCompare = (provided, expected) => {
  if (
    typeof provided !== "string" ||
    typeof expected !== "string" ||
    !provided ||
    !expected
  ) {
    return false;
  }

  const providedHash = crypto
    .createHash("sha256")
    .update(provided)
    .digest();

  const expectedHash = crypto
    .createHash("sha256")
    .update(expected)
    .digest();

  return crypto.timingSafeEqual(
    providedHash,
    expectedHash
  );
};

/* ==========================================
   AUTHENTICATE AGENT
========================================== */

export const authenticateAgent = (agentId, token) => {
  const id = String(agentId || "").trim();

  if (!id || id.length > 128) return false;

  const expected = agentCredentials[id];

  if (!expected) return false;

  return safeTokenCompare(token, expected);
};

/* ==========================================
   DEMO AGENT IDENTIFICATION
========================================== */

export const isDemoAgent = (agentId) => {
  const configuredId = String(
    process.env.TRUSTWIPE_DEMO_AGENT_ID || ""
  ).trim();

  const requestedId = String(agentId || "").trim();

  return Boolean(
    configuredId &&
    requestedId &&
    configuredId === requestedId
  );
};

/* ==========================================
   SOCKET MANAGEMENT
========================================== */

export const setSocket = (io) => {
  if (!io) {
    throw new Error("Invalid Socket.IO instance.");
  }

  ioInstance = io;

  console.log(
    "Socket.IO instance registered in agentBridge."
  );
};

export const getSocket = () => {
  if (!ioInstance) {
    throw new Error(
      "Socket.IO has not been initialized."
    );
  }

  return ioInstance;
};

export const isSocketInitialized = () =>
  ioInstance !== null;

/* ==========================================
   AGENT SANITIZATION
========================================== */

const sanitizeAgentRecord = (agent) => {
  if (!agent) return null;

  return {
    agentId: agent.agentId,
    deviceId: agent.deviceId,
    socketId: agent.socketId,
    hostname: agent.hostname,
    platform: agent.platform,
    arch: agent.arch,
    username: agent.username,
    capabilities: [...(agent.capabilities || [])],
    connectedAt: agent.connectedAt,
    lastHeartbeat: agent.lastHeartbeat,
    status: agent.status,
    authenticated: Boolean(agent.authenticated)
  };
};

/* ==========================================
   REGISTER AGENT
========================================== */

export const registerAgent = (agent = {}) => {
  const agentId = String(
    agent.agentId || agent.deviceId || ""
  ).trim();

  if (!agentId || agentId.length > 128) {
    throw new Error("Invalid agent ID.");
  }

  if (!agent.socket) {
    throw new Error("Missing agent socket.");
  }

  if (agent.authenticated !== true) {
    const error = new Error(
      "Agent authentication required."
    );

    error.code = "AGENT_UNAUTHORIZED";

    throw error;
  }

  if (!agent.socket.connected) {
    throw new Error("Agent socket is disconnected.");
  }

  const existing = connectedAgents.get(agentId);

  /*
   * Prevent a second socket from taking over
   * an already-connected agent.
   */
  if (
    existing &&
    existing.socketId !== agent.socket.id &&
    existing.socket?.connected
  ) {
    const error = new Error(
      "Agent is already connected from another socket."
    );

    error.code = "AGENT_ALREADY_CONNECTED";

    throw error;
  }

  const now = new Date();

  const agentRecord = {
    agentId,

    deviceId: agent.deviceId || agentId,

    socketId: agent.socket.id,

    socket: agent.socket,

    authenticated: true,

    hostname: agent.hostname || null,

    platform: agent.platform || null,

    arch: agent.arch || agent.architecture || null,

    username: agent.username || null,

    capabilities: Array.isArray(agent.capabilities)
      ? [...new Set(
          agent.capabilities
            .filter((item) => typeof item === "string")
            .map((item) => item.trim().toUpperCase())
            .filter(Boolean)
        )]
      : [],

    connectedAt: existing?.connectedAt || now,

    lastHeartbeat: now,

    status: "online",

    /*
     * Never trust demo/user ownership claims
     * supplied in agent registration metadata.
     */
    metadata: {}
  };

  connectedAgents.set(agentId, agentRecord);

  console.log(
    existing
      ? `Agent reconnected: ${agentId}`
      : `Agent registered: ${agentId}`
  );

  return sanitizeAgentRecord(agentRecord);
};

/* ==========================================
   AGENT LOOKUP
========================================== */

export const getAgentInternal = (agentId) => {
  const id = String(agentId || "").trim();

  if (!id) return null;

  return connectedAgents.get(id) || null;
};

export const getAgent = (agentId) => {
  const agent = getAgentInternal(agentId);

  return agent ? sanitizeAgentRecord(agent) : null;
};

/* ==========================================
   AGENT STATUS
========================================== */

export const isAgentConnected = (agentId) => {
  const agent = getAgentInternal(agentId);

  return Boolean(
    agent &&
    agent.authenticated === true &&
    agent.status === "online" &&
    agent.socket?.connected
  );
};

export const getAgentStatus = (agentId) => {
  const agent = getAgentInternal(agentId);

  if (!agent) {
    return {
      agentId,
      connected: false,
      status: "offline"
    };
  }

  return {
    ...sanitizeAgentRecord(agent),
    connected: isAgentConnected(agentId),
    status: isAgentConnected(agentId)
      ? "online"
      : "offline"
  };
};

/* ==========================================
   AGENT LIST
========================================== */

export const listAgents = () =>
  Array.from(connectedAgents.values())
    .map(sanitizeAgentRecord);

export const listOnlineAgents = () =>
  Array.from(connectedAgents.values())
    .filter((agent) => isAgentConnected(agent.agentId))
    .map(sanitizeAgentRecord);

export const getAgentCount = () =>
  connectedAgents.size;

/* ==========================================
   AGENT HEARTBEAT
========================================== */

export const updateAgentHeartbeat = (
  agentId,
  data = {}
) => {
  const id = String(agentId || "").trim();

  const agent = connectedAgents.get(id);

  if (!agent || !agent.authenticated) {
    return false;
  }

  if (!agent.socket?.connected) {
    return false;
  }

  agent.lastHeartbeat = new Date();
  agent.status = "online";

  /*
   * Do not allow heartbeat messages to change
   * capabilities, ownership or agent identity.
   */

  connectedAgents.set(id, agent);

  return true;
};

/* ==========================================
   UNREGISTER AGENT
========================================== */

export const unregisterAgent = (
  agentId,
  socketId = null
) => {
  const id = String(agentId || "").trim();

  if (!id) return false;

  const agent = connectedAgents.get(id);

  if (!agent) return false;

  /*
   * An old socket must not disconnect a
   * newer connection belonging to the agent.
   */
  if (socketId && agent.socketId !== socketId) {
    return false;
  }

  connectedAgents.delete(id);

  rejectPendingRequestsForAgent(
    id,
    new Error("Agent disconnected.")
  );

  console.log(`Agent unregistered: ${id}`);

  return true;
};

/* ==========================================
   CAPABILITIES
========================================== */

export const hasAgentCapability = (
  agentId,
  capability
) => {
  const agent = getAgentInternal(agentId);

  if (!agent || !isAgentConnected(agentId)) {
    return false;
  }

  const requested = String(capability || "")
    .trim()
    .toUpperCase();

  if (!requested) return false;

  return agent.capabilities.includes(requested);
};

export const agentHasCapability = (
  agentId,
  capability
) =>
  hasAgentCapability(agentId, capability);

/* ==========================================
   ONLINE AGENT VALIDATION
========================================== */

const getOnlineAgent = (agentId, capability) => {
  const agent = getAgentInternal(agentId);

  if (!agent) {
    const error = new Error("Agent not found.");
    error.code = "AGENT_NOT_FOUND";
    throw error;
  }

  if (!isAgentConnected(agentId)) {
    const error = new Error("Agent is offline.");
    error.code = "AGENT_OFFLINE";
    throw error;
  }

  /*
   * Empty capabilities are not treated as
   * permission to perform every operation.
   */
  if (!hasAgentCapability(agentId, capability)) {
    const error = new Error(
      `Agent does not support ${capability}.`
    );

    error.code = "CAPABILITY_NOT_SUPPORTED";

    throw error;
  }

  return agent;
};

/* ==========================================
   FORENSIC DISPATCH
========================================== */

export const sendForensicTask = (
  agentId,
  job = {}
) => {
  const agent = getOnlineAgent(
    agentId,
    "FORENSIC_SCAN"
  );

  if (!job.jobId || !job.deviceId) {
    throw new Error(
      "Forensic job ID and device ID are required."
    );
  }

  const task = {
    jobId: String(job.jobId),
    agentId,
    deviceId: String(job.deviceId),
    operation: "FORENSIC_SCAN",
    dispatchedAt: new Date().toISOString()
  };

  agent.socket.emit("start-forensic", task);

  return {
    success: true,
    sent: true,
    agentId,
    jobId: job.jobId
  };
};

/* ==========================================
   FORENSIC CANCELLATION
========================================== */

export const sendForensicCancel = (
  agentId,
  jobId
) => {
  const agent = getOnlineAgent(
    agentId,
    "FORENSIC_SCAN"
  );

  if (!jobId) {
    throw new Error("Missing forensic job ID.");
  }

  agent.socket.emit("cancel-forensic", {
    jobId,
    agentId,
    requestedAt: new Date().toISOString()
  });

  return {
    success: true,
    sent: true,
    agentId,
    jobId
  };
};

/* ==========================================
   WIPE DISPATCH
========================================== */

/*
 * This checks that the caller supplies an
 * authorization ID. It does NOT validate the
 * authorization itself.
 *
 * The wipe controller must validate:
 * - Job and device association
 * - Exact drive identity
 * - Owner/operator approval
 * - Authorization expiry
 * - One-time authorization consumption
 *
 * The physical agent must independently verify
 * the signed authorization before wiping.
 */

export const sendWipeTask = (
  agentId,
  job = {}
) => {
  const agent = getOnlineAgent(agentId, "WIPE");

  if (
    !job.jobId ||
    !job.deviceId ||
    !job.authorizationId
  ) {
    const error = new Error(
      "Wipe job, device and authorization are required."
    );

    error.code = "WIPE_AUTHORIZATION_REQUIRED";

    throw error;
  }

  const task = {
    jobId: String(job.jobId),
    commandId: String(job.jobId),
    agentId,
    deviceId: String(job.deviceId),
    operation: "WIPE",
    authorizationId: String(job.authorizationId),
    dispatchedAt: new Date().toISOString()
  };

  agent.socket.emit("start-wipe", task);

  return {
    success: true,
    sent: true,
    agentId,
    jobId: job.jobId
  };
};

/* ==========================================
   WIPE CANCELLATION
========================================== */

export const sendWipeCancel = (
  agentId,
  jobId
) => {
  const agent = getOnlineAgent(agentId, "WIPE");

  if (!jobId) {
    throw new Error("Missing wipe job ID.");
  }

  agent.socket.emit("cancel-wipe", {
    jobId,
    commandId: jobId,
    agentId,
    requestedAt: new Date().toISOString()
  });

  return {
    success: true,
    sent: true,
    agentId,
    jobId
  };
};

/* ==========================================
   DRIVE DISCOVERY
========================================== */

export const requestDriveList = (agentId) => {
  const agent = getOnlineAgent(
    agentId,
    "DRIVE_DISCOVERY"
  );

  return new Promise((resolve, reject) => {
    const requestId = `DRIVE-${crypto.randomUUID()}`;

    const timeout = setTimeout(() => {
      pendingDriveDiscovery.delete(requestId);

      const error = new Error(
        "Drive discovery timed out."
      );

      error.code = "DRIVE_DISCOVERY_TIMEOUT";

      reject(error);
    }, 30000);

    pendingDriveDiscovery.set(requestId, {
      resolve,
      reject,
      timeout,
      agentId,
      socketId: agent.socketId
    });

    agent.socket.emit("discover-drives", {
      requestId,
      agentId,
      deviceId: agent.deviceId
    });
  });
};

/* ==========================================
   RESOLVE DRIVE DISCOVERY
========================================== */

export const resolveDriveDiscovery = (
  requestId,
  data = {},
  respondingSocketId
) => {
  const id = String(requestId || "").trim();

  if (!id || !respondingSocketId) {
    return false;
  }

  const pending = pendingDriveDiscovery.get(id);

  if (!pending) return false;

  if (pending.socketId !== respondingSocketId) {
    console.warn(
      "Rejected drive response from unexpected socket."
    );

    return false;
  }

  if (String(data.agentId || "") !== pending.agentId) {
    console.warn(
      "Rejected drive response with mismatched agent ID."
    );

    return false;
  }

  if (!Array.isArray(data.drives)) {
    return false;
  }

  clearTimeout(pending.timeout);
  pendingDriveDiscovery.delete(id);

  pending.resolve(data);

  return true;
};

/* ==========================================
   LEGACY DISCOVERY
========================================== */

export const addPendingDiscovery = (
  userId,
  callback
) => {
  const id = String(userId || "").trim();

  if (!id || typeof callback !== "function") {
    throw new Error("Invalid pending discovery.");
  }

  pendingDiscovery.set(id, callback);

  return true;
};

export const resolvePendingDiscovery = (
  userId,
  data
) => {
  const id = String(userId || "").trim();

  const callback = pendingDiscovery.get(id);

  if (!callback) return false;

  try {
    callback(data);
  } catch (error) {
    console.error(
      "Legacy discovery callback error:",
      error.message
    );
  }

  pendingDiscovery.delete(id);

  return true;
};

export const removePendingDiscovery = (userId) =>
  pendingDiscovery.delete(String(userId || "").trim());

export const listPendingDiscovery = () =>
  Array.from(pendingDiscovery.keys());

/* ==========================================
   PENDING REQUEST CLEANUP
========================================== */

const rejectPendingRequestsForAgent = (
  agentId,
  error
) => {
  for (const [requestId, pending] of pendingDriveDiscovery) {
    if (pending.agentId !== agentId) continue;

    clearTimeout(pending.timeout);
    pendingDriveDiscovery.delete(requestId);
    pending.reject(error);
  }
};

/* ==========================================
   STALE AGENT CLEANUP
========================================== */

export const cleanupStaleAgents = (
  timeoutMs = 90000
) => {
  const now = Date.now();
  let removed = 0;

  for (const [agentId, agent] of connectedAgents) {
    const lastHeartbeat = new Date(
      agent.lastHeartbeat
    ).getTime();

    const stale =
      !agent.socket?.connected ||
      !Number.isFinite(lastHeartbeat) ||
      now - lastHeartbeat > timeoutMs;

    if (!stale) continue;

    connectedAgents.delete(agentId);

    rejectPendingRequestsForAgent(
      agentId,
      new Error("Agent heartbeat expired.")
    );

    removed++;
  }

  return removed;
};

/* ==========================================
   AGENT SNAPSHOT
========================================== */

export const getAgentSnapshot = () => ({
  initialized: isSocketInitialized(),
  totalAgents: connectedAgents.size,
  onlineAgents: listOnlineAgents().length,
  pendingDiscoveries: pendingDiscovery.size,
  pendingDriveDiscoveries: pendingDriveDiscovery.size,
  agents: listAgents()
});

/* ==========================================
   PERIODIC CLEANUP
========================================== */

const cleanupTimer = setInterval(() => {
  try {
    cleanupStaleAgents();
  } catch (error) {
    console.error(
      "Agent cleanup error:",
      error.message
    );
  }
}, 30000);

cleanupTimer.unref?.();

/* ==========================================
   BRIDGE STATUS
========================================== */

export const isBridgeReady = () =>
  ioInstance !== null;

export const getBridgeStatus = () => ({
  ready: isBridgeReady(),
  connectedAgents: connectedAgents.size,
  pendingDiscovery: pendingDiscovery.size,
  pendingDriveDiscovery: pendingDriveDiscovery.size
});

/* ==========================================
   DEFAULT EXPORT
========================================== */

export default {
  setSocket,
  getSocket,
  isSocketInitialized,

  authenticateAgent,
  isDemoAgent,
  registerAgent,
  unregisterAgent,

  getAgent,
  getAgentInternal,
  getAgentStatus,
  isAgentConnected,

  listAgents,
  listOnlineAgents,
  getAgentCount,

  updateAgentHeartbeat,

  hasAgentCapability,
  agentHasCapability,

  sendForensicTask,
  sendForensicCancel,

  sendWipeTask,
  sendWipeCancel,

  requestDriveList,
  resolveDriveDiscovery,

  addPendingDiscovery,
  resolvePendingDiscovery,
  removePendingDiscovery,
  listPendingDiscovery,

  cleanupStaleAgents,
  getAgentSnapshot,

  isBridgeReady,
  getBridgeStatus
};
