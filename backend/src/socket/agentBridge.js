
/* ==========================================
   backend/src/socket/agentBridge.js
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
   AGENT CREDENTIALS
========================================== */

/*
 * Configure a unique token for every agent.
 *
 * Example:
 * TRUSTWIPE_AGENT_CREDENTIALS={"agent-001":"long-random-secret"}
 *
 * Keep this environment variable on the backend only.
 */
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

const agentCredentials = parseAgentCredentials();

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

export const authenticateAgent = (agentId, token) => {
  const id = String(agentId || "").trim();

  if (!id) return false;

  const expected = agentCredentials[id];

  if (!expected) return false;

  return safeTokenCompare(token, expected);
};

/* ==========================================
   PENDING DISCOVERY
========================================== */

const pendingDiscovery = new Map();
const pendingDriveDiscovery = new Map();

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
   AGENT REGISTRATION
========================================== */

/*
 * registerAgent expects an already authenticated agent.
 *
 * Authentication must happen before calling this method.
 */
export const registerAgent = (agent = {}) => {
  const agentId = String(
    agent.agentId || agent.deviceId || ""
  ).trim();

  if (!agentId) {
    throw new Error("Missing agentId.");
  }

  if (!agent.socket) {
    throw new Error("Missing agent socket.");
  }

  if (!agent.authenticated) {
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
   * Prevent an unauthenticated or unrelated socket
   * from replacing an existing agent connection.
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
      ? [...agent.capabilities]
      : [],

    connectedAt: existing?.connectedAt || now,

    lastHeartbeat: now,

    status: "online",

    /*
     * Do not trust metadata.demo from an agent.
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
   AGENT UNREGISTRATION
========================================== */

export const unregisterAgent = (
  agentId,
  socketId = null
) => {
  const id = String(agentId || "").trim();

  if (!id) return false;

  const agent = connectedAgents.get(id);

  if (!agent) return false;

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
   AGENT LOOKUP
========================================== */

export const getAgent = (agentId) => {
  const agent = getAgentInternal(agentId);

  return agent ? sanitizeAgentRecord(agent) : null;
};

export const getAgentInternal = (agentId) => {
  const id = String(agentId || "").trim();

  if (!id) return null;

  return connectedAgents.get(id) || null;
};

/* ==========================================
   AGENT STATUS
========================================== */

export const isAgentConnected = (agentId) => {
  const agent = getAgentInternal(agentId);

  return Boolean(
    agent &&
    agent.authenticated &&
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
   HEARTBEAT
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

  agent.lastHeartbeat = new Date();
  agent.status = "online";

  /*
   * Update only informational fields.
   * Capabilities are fixed at registration rather
   * than being changed by arbitrary heartbeat events.
   */

  if (data.hostname) {
    agent.hostname = data.hostname;
  }

  connectedAgents.set(id, agent);

  return true;
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

  return Boolean(
    requested &&
    agent.capabilities.some(
      (item) =>
        String(item).trim().toUpperCase() === requested
    )
  );
};

export const agentHasCapability = (
  agentId,
  capability
) =>
  hasAgentCapability(agentId, capability);

/* ==========================================
   GENERIC TASK VALIDATION
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

  if (
    agent.capabilities.length > 0 &&
    !hasAgentCapability(agentId, capability)
  ) {
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

  if (!job.jobId) {
    throw new Error("Missing forensic job ID.");
  }

  const task = {
    jobId: job.jobId,
    agentId,
    deviceId: job.deviceId || agent.deviceId,
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
 * A wipe must carry a server-issued authorization.
 * The caller must validate the job, drive ownership,
 * user confirmation and one-time authorization first.
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
    jobId: job.jobId,
    commandId: job.jobId,
    agentId,
    deviceId: job.deviceId,
    operation: "WIPE",
    authorizationId: job.authorizationId,
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
  const agent = getOnlineAgent(agentId, "DRIVE_DISCOVERY");

  return new Promise((resolve, reject) => {
    const requestId =
      `DRIVE-${crypto.randomUUID()}`;

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

/*
 * A discovery result must originate from the exact
 * socket that received the discovery request.
 */
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

  if (data.agentId !== pending.agentId) {
    console.warn(
      "Rejected drive response with mismatched agent ID."
    );

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

/*
 * Retained for compatibility.
 * Do not use an unauthenticated userId as authorization.
 */
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
   SANITIZE AGENT
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
