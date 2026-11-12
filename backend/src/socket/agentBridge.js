
/* ==========================================
   backend/src/socket/agentBridge.js
========================================== */

/**
 * TrustWipe Agent Bridge
 *
 * Responsibilities:
 * 1. Store Socket.IO instance
 * 2. Track connected TrustWipe agents
 * 3. Handle drive discovery
 * 4. Dispatch forensic jobs
 * 5. Dispatch wipe jobs
 * 6. Handle job cancellation
 * 7. Track heartbeat / connection status
 *
 * Security:
 * - Never expose raw sockets through public agent lists.
 * - Never trust agent-supplied demo metadata.
 * - Associate private agents with users only through
 *   trusted server-side authentication.
 * - Validate the responding socket for drive discovery.
 * - Never use this bridge as a remote shell.
 */

import crypto from "node:crypto";

/* =====================================================
   CONFIGURATION
===================================================== */

const DEMO_AGENT_ID =
  String(process.env.TRUSTWIPE_DEMO_AGENT_ID || "").trim();

const DEMO_AGENT_TOKEN =
  String(process.env.TRUSTWIPE_DEMO_AGENT_TOKEN || "").trim();

const DISCOVERY_TIMEOUT_MS = 30000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 90000;
const CLEANUP_INTERVAL_MS = 30000;

/* =====================================================
   SOCKET INSTANCE
===================================================== */

let ioInstance = null;

/* =====================================================
   CONNECTED AGENTS
===================================================== */

const connectedAgents = new Map();

/**
 * Raw internal records. Use only inside trusted
 * backend services. Never send these to clients.
 */
export const getConnectedAgents = () => {
  return Array.from(connectedAgents.values());
};

/* =====================================================
   PENDING REQUESTS
===================================================== */

const pendingDiscovery = new Map();
const pendingDriveDiscovery = new Map();

/* =====================================================
   ERROR HELPER
===================================================== */

const createError = (message, code) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

/* =====================================================
   SOCKET INSTANCE MANAGEMENT
===================================================== */

export const setSocket = (io) => {
  if (!io) {
    throw new Error("Invalid Socket.IO instance.");
  }

  ioInstance = io;

  console.log("Socket.IO instance registered in agentBridge.");
};

export const getSocket = () => {
  if (!ioInstance) {
    throw new Error("Socket.IO has not been initialized.");
  }

  return ioInstance;
};

export const isSocketInitialized = () => {
  return ioInstance !== null;
};

/* =====================================================
   DEMO AGENT VALIDATION
===================================================== */

/**
 * A demo agent must have:
 * - The configured demo agent ID.
 * - A matching server-side registration token.
 *
 * The token is checked during registration and is
 * never stored in the agent record.
 *
 * Do not use agent.metadata.demo as proof of trust.
 */
const isValidDemoRegistration = (agentId, suppliedToken) => {
  if (!DEMO_AGENT_ID || !DEMO_AGENT_TOKEN) {
    return false;
  }

  if (agentId !== DEMO_AGENT_ID) {
    return false;
  }

  if (typeof suppliedToken !== "string") {
    return false;
  }

  const expected = Buffer.from(DEMO_AGENT_TOKEN);
  const supplied = Buffer.from(suppliedToken);

  if (expected.length !== supplied.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, supplied);
};

/**
 * Check whether the configured demo agent is online
 * and was registered using the trusted demo token.
 */
export const isDemoAgent = (agentId) => {
  const id = String(agentId || "").trim();
  const agent = connectedAgents.get(id);

  return Boolean(
    agent &&
    agent.demoTrusted === true &&
    id === DEMO_AGENT_ID &&
    agent.status === "online" &&
    agent.socket?.connected
  );
};

/* =====================================================
   AGENT REGISTRATION
===================================================== */

/**
 * Register a TrustWipe Agent.
 *
 * IMPORTANT:
 * ownerUserId must only be assigned by trusted backend
 * authentication code. Never copy it directly from an
 * unauthenticated socket registration payload.
 *
 * demoToken is checked but never stored.
 */
export const registerAgent = (agent = {}) => {
  const agentId = String(
    agent.agentId || agent.deviceId || ""
  ).trim();

  if (!agentId) {
    throw createError(
      "Agent registration failed: missing agentId.",
      "MISSING_AGENT_ID"
    );
  }

  if (!agent.socket) {
    throw createError(
      "Agent registration failed: missing socket.",
      "MISSING_AGENT_SOCKET"
    );
  }

  const now = new Date();
  const existing = connectedAgents.get(agentId);

  const demoTrusted = isValidDemoRegistration(
    agentId,
    agent.demoToken
  );

  /*
   * Preserve an existing trusted owner association
   * across reconnects. Do not accept ownerUserId from
   * an ordinary agent registration payload.
   */
  const agentRecord = {
    agentId,

    deviceId: String(agent.deviceId || agentId),

    socketId: agent.socket.id,

    socket: agent.socket,

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
     * Do not trust metadata.demo.
     * Metadata is retained for internal diagnostics only.
     */
    metadata:
      agent.metadata && typeof agent.metadata === "object"
        ? { ...agent.metadata, demo: undefined }
        : {},

    demoTrusted,

    ownerUserId: existing?.ownerUserId || null
  };

  connectedAgents.set(agentId, agentRecord);

  console.log(
    existing
      ? `Agent reconnected: ${agentId}`
      : `Agent registered: ${agentId}`
  );

  return sanitizeAgentRecord(agentRecord);
};

/* =====================================================
   TRUSTED USER-AGENT ASSOCIATION
===================================================== */

/**
 * Associate an agent with a user.
 *
 * Call this only from trusted backend code after
 * authenticating the agent and verifying ownership.
 *
 * Do not expose this function through an unauthenticated
 * socket event or public HTTP endpoint.
 */
export const associateAgentWithUser = (agentId, userId) => {
  const id = String(agentId || "").trim();
  const owner = String(userId || "").trim();

  if (!id || !owner) {
    throw createError(
      "Agent ID and user ID are required.",
      "INVALID_AGENT_OWNERSHIP"
    );
  }

  const agent = connectedAgents.get(id);

  if (!agent) {
    throw createError(
      `Agent not found: ${id}`,
      "AGENT_NOT_FOUND"
    );
  }

  agent.ownerUserId = owner;

  connectedAgents.set(id, agent);

  return true;
};

/**
 * Find an online agent belonging to a user.
 */
export const findAgentForUser = (userId) => {
  const owner = String(userId || "").trim();

  if (!owner) {
    return null;
  }

  for (const agent of connectedAgents.values()) {
    if (
      agent.ownerUserId === owner &&
      agent.status === "online" &&
      agent.socket?.connected
    ) {
      return agent;
    }
  }

  return null;
};

/* =====================================================
   AGENT UNREGISTRATION
===================================================== */

/**
 * Remove an agent.
 *
 * If socketId is supplied, an older socket cannot
 * remove a newer connection.
 */
export const unregisterAgent = (agentId, socketId = null) => {
  const id = String(agentId || "").trim();

  if (!id) {
    return false;
  }

  const agent = connectedAgents.get(id);

  if (!agent) {
    return false;
  }

  if (socketId && agent.socketId !== socketId) {
    return false;
  }

  connectedAgents.delete(id);

  /*
   * Reject pending requests associated with this agent.
   */
  for (const [requestId, pending] of pendingDriveDiscovery.entries()) {
    if (pending.agentId === id) {
      clearTimeout(pending.timeout);
      pendingDriveDiscovery.delete(requestId);

      pending.reject(
        createError(
          "Agent disconnected during drive discovery.",
          "AGENT_DISCONNECTED"
        )
      );
    }
  }

  console.log(`Agent unregistered: ${id}`);

  return true;
};

/* =====================================================
   AGENT LOOKUP
===================================================== */

export const getAgent = (agentId) => {
  const id = String(agentId || "").trim();
  const agent = connectedAgents.get(id);

  return agent ? sanitizeAgentRecord(agent) : null;
};

/**
 * Internal lookup. Contains the actual socket.
 * Never return this object through an API response.
 */
export const getAgentInternal = (agentId) => {
  const id = String(agentId || "").trim();

  if (!id) {
    return null;
  }

  return connectedAgents.get(id) || null;
};

/* =====================================================
   AGENT CONNECTION STATUS
===================================================== */

export const isAgentConnected = (agentId) => {
  const agent = getAgentInternal(agentId);

  return Boolean(
    agent &&
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
    agentId: agent.agentId,
    deviceId: agent.deviceId,
    hostname: agent.hostname,
    platform: agent.platform,
    arch: agent.arch,
    username: agent.username,
    capabilities: [...agent.capabilities],
    connected: isAgentConnected(agentId),
    status: isAgentConnected(agentId) ? "online" : "offline",
    connectedAt: agent.connectedAt,
    lastHeartbeat: agent.lastHeartbeat
  };
};

/* =====================================================
   HEARTBEAT
===================================================== */

export const updateAgentHeartbeat = (agentId, data = {}) => {
  const id = String(agentId || "").trim();

  if (!id) {
    return false;
  }

  const agent = connectedAgents.get(id);

  if (!agent) {
    console.warn(`Heartbeat from unknown agent: ${id}`);
    return false;
  }

  agent.lastHeartbeat = new Date();
  agent.status = "online";

  if (data.hostname) {
    agent.hostname = data.hostname;
  }

  if (data.platform) {
    agent.platform = data.platform;
  }

  if (data.arch || data.architecture) {
    agent.arch = data.arch || data.architecture;
  }

  if (data.username) {
    agent.username = data.username;
  }

  if (Array.isArray(data.capabilities)) {
    agent.capabilities = [...data.capabilities];
  }

  connectedAgents.set(id, agent);

  return true;
};

/* =====================================================
   AGENT LIST
===================================================== */

export const listAgents = () => {
  return Array.from(connectedAgents.values()).map(
    sanitizeAgentRecord
  );
};

export const listOnlineAgents = () => {
  return Array.from(connectedAgents.values())
    .filter(
      (agent) =>
        agent.status === "online" &&
        agent.socket?.connected
    )
    .map(sanitizeAgentRecord);
};

export const getAgentCount = () => {
  return connectedAgents.size;
};

/* =====================================================
   AGENT CAPABILITY CHECK
===================================================== */

export const hasAgentCapability = (agentId, capability) => {
  const agent = getAgentInternal(agentId);

  if (!agent) {
    return false;
  }

  const requested = String(capability || "")
    .trim()
    .toUpperCase();

  if (!requested) {
    return false;
  }

  return (
    Array.isArray(agent.capabilities) &&
    agent.capabilities.some(
      (item) =>
        String(item).trim().toUpperCase() === requested
    )
  );
};

export const agentHasCapability = (agentId, capability) => {
  return hasAgentCapability(agentId, capability);
};

/* =====================================================
   SHARED AGENT VALIDATION
===================================================== */

const getConnectedAgentOrThrow = (agentId) => {
  const agent = getAgentInternal(agentId);

  if (!agent) {
    throw createError(
      `Agent not found: ${agentId}`,
      "AGENT_NOT_FOUND"
    );
  }

  if (!agent.socket?.connected || agent.status !== "online") {
    throw createError(
      `Agent is not connected: ${agentId}`,
      "AGENT_OFFLINE"
    );
  }

  return agent;
};

const validateCapability = (agent, capability) => {
  /*
   * Preserve the previous behavior:
   * enforce only when capabilities were advertised.
   */
  if (
    Array.isArray(agent.capabilities) &&
    agent.capabilities.length > 0 &&
    !hasAgentCapability(agent.agentId, capability)
  ) {
    throw createError(
      `Agent does not support ${capability}: ${agent.agentId}`,
      "CAPABILITY_NOT_SUPPORTED"
    );
  }
};

/* =====================================================
   FORENSIC TASK DISPATCH
===================================================== */

export const sendForensicTask = (agentId, job = {}) => {
  const agent = getConnectedAgentOrThrow(agentId);

  validateCapability(agent, "FORENSIC_SCAN");

  const task = {
    ...job,
    agentId,
    deviceId: job.deviceId || agent.deviceId,
    operation: "FORENSIC_SCAN",
    dispatchedAt: new Date().toISOString()
  };

  agent.socket.emit("start-forensic", task);

  console.log(`Forensic task dispatched: ${agentId}`);

  return {
    success: true,
    sent: true,
    agentId,
    jobId: job.jobId || null
  };
};

/* =====================================================
   FORENSIC CANCELLATION
===================================================== */

export const sendForensicCancel = (agentId, jobId) => {
  const agent = getConnectedAgentOrThrow(agentId);

  if (!jobId) {
    throw createError(
      "Missing forensic jobId.",
      "MISSING_JOB_ID"
    );
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

/* =====================================================
   WIPE TASK DISPATCH
===================================================== */

export const sendWipeTask = (agentId, job = {}) => {
  const agent = getConnectedAgentOrThrow(agentId);

  validateCapability(agent, "WIPE");

  const task = {
    ...job,
    agentId,
    deviceId: job.deviceId || agent.deviceId,
    operation: "WIPE",
    dispatchedAt: new Date().toISOString()
  };

  agent.socket.emit("start-wipe", task);

  console.log(`Wipe task dispatched: ${agentId}`);

  return {
    success: true,
    sent: true,
    agentId,
    jobId: job.jobId || job.commandId || null
  };
};

/* =====================================================
   WIPE CANCELLATION
===================================================== */

export const sendWipeCancel = (agentId, jobId) => {
  const agent = getConnectedAgentOrThrow(agentId);

  if (!jobId) {
    throw createError(
      "Missing wipe jobId.",
      "MISSING_JOB_ID"
    );
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

/* =====================================================
   DRIVE DISCOVERY REQUEST
===================================================== */

/**
 * Ask one connected agent to discover its drives.
 *
 * The returned Promise resolves only when the expected
 * agent socket responds with the matching request ID.
 */
export const requestDriveList = (agentId, userId = null) => {
  const agent = getConnectedAgentOrThrow(agentId);

  return new Promise((resolve, reject) => {
    const requestId =
      `DRIVE-${Date.now()}-${crypto.randomUUID()}`;

    const timeout = setTimeout(() => {
      pendingDriveDiscovery.delete(requestId);

      reject(
        createError(
          "Timed out waiting for drive information from TrustWipe Agent.",
          "DRIVE_DISCOVERY_TIMEOUT"
        )
      );
    }, DISCOVERY_TIMEOUT_MS);

    pendingDriveDiscovery.set(requestId, {
      resolve,
      reject,
      timeout,
      agentId: agent.agentId,
      socketId: agent.socketId,
      userId
    });

    try {
      agent.socket.emit("discover-drives", {
        requestId,
        agentId: agent.agentId,
        deviceId: agent.deviceId,
        userId
      });

      console.log(
        `Drive discovery requested from agent: ${agent.agentId}`
      );
    } catch (error) {
      clearTimeout(timeout);
      pendingDriveDiscovery.delete(requestId);

      reject(
        createError(
          "Could not send drive discovery request.",
          "DRIVE_DISCOVERY_SEND_FAILED"
        )
      );
    }
  });
};

/* =====================================================
   RESOLVE DRIVE DISCOVERY
===================================================== */

/**
 * Called by socket/index.js when an agent sends drive-list.
 *
 * IMPORTANT:
 * Pass the actual responding socket.id as the third
 * argument. Do not trust socketId from the event payload.
 */
export const resolveDriveDiscovery = (
  requestId,
  data = {},
  respondingSocketId = null
) => {
  const id = String(requestId || "").trim();

  if (!id) {
    return false;
  }

  const pending = pendingDriveDiscovery.get(id);

  if (!pending) {
    console.warn(`No pending drive discovery request: ${id}`);
    return false;
  }

  /*
   * Reject responses that do not originate from the
   * exact socket that received the discovery request.
   */
  if (
    !respondingSocketId ||
    respondingSocketId !== pending.socketId
  ) {
    console.warn(
      `Rejected drive-list response from unexpected socket: ${id}`
    );

    return false;
  }

  clearTimeout(pending.timeout);
  pendingDriveDiscovery.delete(id);

  pending.resolve(data);

  console.log(`Drive discovery resolved: ${id}`);

  return true;
};

/* =====================================================
   LEGACY DISCOVERY SYSTEM
===================================================== */

export const addPendingDiscovery = (userId, callback) => {
  const id = String(userId || "").trim();

  if (!id || typeof callback !== "function") {
    throw new Error(
      "Invalid pending discovery registration."
    );
  }

  pendingDiscovery.set(id, callback);

  return true;
};

export const resolvePendingDiscovery = (userId, data) => {
  const id = String(userId || "").trim();
  const callback = pendingDiscovery.get(id);

  if (!callback) {
    console.warn(`No pending discovery for userId: ${id}`);
    return false;
  }

  try {
    callback(data);
  } catch (error) {
    console.error(
      "Discovery callback error:",
      error.message
    );
  }

  pendingDiscovery.delete(id);

  return true;
};

export const removePendingDiscovery = (userId) => {
  const id = String(userId || "").trim();

  return pendingDiscovery.delete(id);
};

export const listPendingDiscovery = () => {
  return Array.from(pendingDiscovery.keys());
};

/* =====================================================
   STALE AGENT CLEANUP
===================================================== */

export const cleanupStaleAgents = (
  timeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS
) => {
  const now = Date.now();
  let removed = 0;

  for (const [agentId, agent] of connectedAgents.entries()) {
    const lastHeartbeat = agent.lastHeartbeat
      ? new Date(agent.lastHeartbeat).getTime()
      : 0;

    const socketConnected = Boolean(agent.socket?.connected);

    const stale =
      !socketConnected ||
      !lastHeartbeat ||
      now - lastHeartbeat > timeoutMs;

    if (stale) {
      unregisterAgent(agentId, agent.socketId);
      removed++;
    }
  }

  return removed;
};

/* =====================================================
   AGENT SNAPSHOT
===================================================== */

export const getAgentSnapshot = () => {
  return {
    initialized: isSocketInitialized(),
    totalAgents: connectedAgents.size,
    onlineAgents: listOnlineAgents().length,
    pendingDiscoveries: pendingDiscovery.size,
    pendingDriveDiscoveries: pendingDriveDiscovery.size,
    agents: listAgents()
  };
};

/* =====================================================
   SANITIZE AGENT
===================================================== */

/**
 * Never expose sockets, registration tokens,
 * ownership data, or internal metadata.
 */
const sanitizeAgentRecord = (agent) => {
  if (!agent) {
    return null;
  }

  return {
    agentId: agent.agentId,
    deviceId: agent.deviceId,
    socketId: agent.socketId,
    hostname: agent.hostname,
    platform: agent.platform,
    arch: agent.arch,
    username: agent.username,
    capabilities: Array.isArray(agent.capabilities)
      ? [...agent.capabilities]
      : [],
    connectedAt: agent.connectedAt,
    lastHeartbeat: agent.lastHeartbeat,
    status: agent.status
  };
};

/* =====================================================
   PERIODIC CLEANUP
===================================================== */

const cleanupTimer = setInterval(() => {
  try {
    cleanupStaleAgents();
  } catch (error) {
    console.error(
      "Agent cleanup error:",
      error.message
    );
  }
}, CLEANUP_INTERVAL_MS);

if (typeof cleanupTimer.unref === "function") {
  cleanupTimer.unref();
}

/* =====================================================
   BRIDGE STATUS
===================================================== */

export const isBridgeReady = () => {
  return ioInstance !== null;
};

export const getBridgeStatus = () => {
  return {
    ready: ioInstance !== null,
    connectedAgents: connectedAgents.size,
    pendingDiscovery: pendingDiscovery.size,
    pendingDriveDiscovery: pendingDriveDiscovery.size
  };
};

/* =====================================================
   DEFAULT EXPORT
===================================================== */

export default {
  setSocket,
  getSocket,
  isSocketInitialized,

  registerAgent,
  unregisterAgent,
  getAgent,
  getAgentInternal,
  getAgentStatus,
  isAgentConnected,
  listAgents,
  listOnlineAgents,
  getAgentCount,
  getConnectedAgents,

  associateAgentWithUser,
  findAgentForUser,
  isDemoAgent,

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
