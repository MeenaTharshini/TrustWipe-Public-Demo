
/* ==========================================
   backend/src/socket/index.js
   TrustWipe - Secure Agent Socket Bridge
========================================== */

import { Server } from "socket.io";

import {
  setSocket,
  authenticateAgent,
  registerAgent,
  unregisterAgent,
  updateAgentHeartbeat,
  resolveDriveDiscovery,
  getAgentInternal,
  getAgent,
  listAgents,
  isAgentConnected
} from "./agentBridge.js";

import WipeJob from "../models/WipeJob.js";
import Device from "../models/Device.js";
import Certificate from "../models/Certificate.js";

import {
  generateCertificate
} from "../certificateEngine/generateCertificate.js";

/* ==========================================
   SOCKET INSTANCE
========================================== */

let io = null;

/* ==========================================
   HELPERS
========================================== */

const getAgentId = (data = {}) =>
  String(data.agentId || data.deviceId || "").trim();

const getRegisteredAgentForSocket = (socket) => {
  if (!socket?.data?.trustedAgent || !socket.data.agentId) {
    return null;
  }

  const agent = getAgentInternal(socket.data.agentId);

  if (
    !agent ||
    agent.authenticated !== true ||
    agent.socketId !== socket.id ||
    !agent.socket?.connected
  ) {
    return null;
  }

  return agent;
};

const isSocketAuthorizedForAgent = (socket, suppliedAgentId) => {
  const registeredAgent = getRegisteredAgentForSocket(socket);

  if (!registeredAgent) return false;

  // The payload cannot switch this socket to another agent.
  return (
    !suppliedAgentId ||
    String(suppliedAgentId) === registeredAgent.agentId
  );
};

const emitToAgent = (agentId, event, payload) => {
  if (!io || !agentId) return;

  io.to(`agent:${agentId}`).emit(event, payload);
};

const isDemoDevice = (device) => {
  if (!device) return true;

  const storagePath = String(device.storagePath || "");

  return (
    device.isDemo === true ||
    storagePath.startsWith("DEMO://")
  );
};

/*
 * Fail closed:
 * A physical wipe job must reference a real device
 * explicitly assigned to this authenticated agent.
 *
 * Ensure Device.agentId is populated during trusted
 * device enrollment/discovery before enabling this.
 */
const getVerifiedJobAndDevice = async (jobId, agentId) => {
  if (!jobId || !agentId) return null;

  const job = await WipeJob.findById(jobId);

  if (!job || !job.deviceId) return null;

  const device = await Device.findById(job.deviceId);

  if (!device || isDemoDevice(device)) return null;

  if (String(device.agentId || "") !== String(agentId)) {
    return null;
  }

  return { job, device };
};

const validProgress = (value) => {
  const progress = Number(value);

  return Number.isFinite(progress) &&
    progress >= 0 &&
    progress <= 100
    ? progress
    : null;
};

/* ==========================================
   INITIALIZE SOCKET.IO
========================================== */

export const initAgentClient = (httpServer) => {
  if (!httpServer) {
    throw new Error(
      "HTTP server is required to initialize Socket.IO."
    );
  }

  if (io) {
    console.warn("Socket.IO is already initialized.");
    return io;
  }

  const allowedOrigins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    ...(process.env.FRONTEND_URL || "").split(","),
    ...(process.env.FRONTEND_ORIGIN || "").split(","),
    ...(process.env.FRONTEND_URLS || "").split(",")
  ]
    .map((origin) => origin.trim())
    .filter(Boolean);

  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true
    },
    transports: ["websocket", "polling"],
    pingInterval: 25000,
    pingTimeout: 60000
  });

  setSocket(io);

  console.log("=================================");
  console.log(" TrustWipe Socket.IO Started");
  console.log("=================================");

  /* ==========================================
     CONNECTION
  ========================================== */

  io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);

    socket.data.trustedAgent = false;
    socket.data.agentId = null;

    /* ========================================
       REGISTER AGENT
    ======================================== */

    socket.on("register-agent", (agent = {}) => {
      try {
        // Prevent one socket from registering multiple agents.
        if (socket.data.trustedAgent) {
          socket.emit("agent-registered", {
            success: false,
            error: "This socket already has a registered agent."
          });
          return;
        }

        const agentId = getAgentId(agent);
        const agentToken = String(agent.agentToken || "");

        if (!agentId || !agentToken) {
          socket.emit("agent-registered", {
            success: false,
            error: "Agent ID and credentials are required."
          });
          return;
        }

        /*
         * Never trust agent.authenticated, agent.demo,
         * agent.userId or other client-supplied claims.
         */
        const authenticated = authenticateAgent(
          agentId,
          agentToken
        );

        if (!authenticated) {
          socket.emit("agent-registered", {
            success: false,
            error: "Agent authentication failed."
          });

          console.warn("Rejected agent registration:", agentId);
          return;
        }

        const registeredAgent = registerAgent({
          agentId,
          deviceId: agentId,
          socket,
          authenticated: true,
          hostname: agent.hostname,
          platform: agent.platform,
          arch: agent.arch,
          capabilities: Array.isArray(agent.capabilities)
            ? agent.capabilities
            : []
        });

        if (!registeredAgent) {
          socket.emit("agent-registered", {
            success: false,
            error: "Agent registration was rejected."
          });
          return;
        }

        socket.data.trustedAgent = true;
        socket.data.agentId = agentId;

        socket.join(`agent:${agentId}`);

        socket.emit("agent-registered", {
          success: true,
          agentId,
          deviceId: agentId,
          status: "online"
        });

        // Informational status only; no drive data is broadcast.
        io.emit("agent-status", {
          agentId,
          deviceId: agentId,
          status: "online",
          hostname: registeredAgent.hostname,
          platform: registeredAgent.platform,
          capabilities: registeredAgent.capabilities
        });

        console.log("Authenticated agent registered:", agentId);

      } catch (error) {
        console.error("Agent registration error:", error.message);

        socket.emit("agent-registered", {
          success: false,
          error: "Agent registration failed."
        });
      }
    });

    /* ========================================
       HEARTBEAT
    ======================================== */

    socket.on("heartbeat", (data = {}) => {
      try {
        const agent = getRegisteredAgentForSocket(socket);

        if (!agent || !isSocketAuthorizedForAgent(socket, getAgentId(data))) {
          return;
        }

        // Do not pass arbitrary client metadata into the bridge.
        const updated = updateAgentHeartbeat(agent.agentId, {
          timestamp: new Date().toISOString()
        });

        if (!updated) return;

        io.emit("agent-status", {
          agentId: agent.agentId,
          deviceId: agent.agentId,
          status: "online"
        });

      } catch (error) {
        console.error("Heartbeat error:", error.message);
      }
    });

    /* ========================================
       DRIVE DISCOVERY RESPONSE
    ======================================== */

    socket.on("drive-list", (data = {}) => {
      try {
        const agent = getRegisteredAgentForSocket(socket);

        if (!agent || !isSocketAuthorizedForAgent(socket, getAgentId(data))) {
          console.warn("Rejected drive-list from unauthorized socket.");
          return;
        }

        if (!data.requestId || !Array.isArray(data.drives)) {
          return;
        }

        const result = {
          requestId: String(data.requestId),
          agentId: agent.agentId,
          deviceId: agent.agentId,
          drives: data.drives,
          timestamp: new Date().toISOString()
        };

        const resolved = resolveDriveDiscovery(
          result.requestId,
          result,
          socket.id
        );

        console.log(
          resolved
            ? "Drive discovery resolved."
            : "Drive discovery response not matched."
        );

      } catch (error) {
        console.error("Drive discovery response error:", error.message);
      }
    });

    /* ========================================
       WIPE PROGRESS
    ======================================== */

    socket.on("wipe-progress", async (data = {}) => {
      try {
        const agent = getRegisteredAgentForSocket(socket);

        if (!agent || !isSocketAuthorizedForAgent(socket, getAgentId(data))) {
          return;
        }

        const jobId = data.commandId || data.jobId;
        const progress = validProgress(data.progress);

        if (!jobId || progress === null) return;

        const verified = await getVerifiedJobAndDevice(
          jobId,
          agent.agentId
        );

        if (!verified) {
          console.warn("Rejected progress for unassigned job:", jobId);
          return;
        }

        const { job } = verified;

        // Only permit updates to jobs currently in progress.
        if (!["pending", "authorized", "running"].includes(job.status)) {
          return;
        }

        job.progress = progress;
        job.status = "running";

        job.events.push({
          message: String(data.message || "Wipe progress updated.").slice(0, 300),
          timestamp: new Date()
        });

        await job.save();

        emitToAgent(agent.agentId, "wipe-progress", {
          jobId: String(job._id),
          progress: job.progress,
          status: job.status
        });

      } catch (error) {
        console.error("Wipe progress error:", error.message);
      }
    });

    /* ========================================
       WIPE COMPLETE
    ======================================== */

    socket.on("wipe-complete", async (data = {}) => {
      try {
        const agent = getRegisteredAgentForSocket(socket);

        if (!agent || !isSocketAuthorizedForAgent(socket, getAgentId(data))) {
          return;
        }

        const jobId = data.commandId || data.jobId;

        if (!jobId) return;

        const finalStatus =
          data.status === "completed"
            ? "completed"
            : data.status === "failed"
              ? "failed"
              : null;

        if (!finalStatus) return;

        const verified = await getVerifiedJobAndDevice(
          jobId,
          agent.agentId
        );

        if (!verified) {
          console.warn("Rejected completion for unassigned job:", jobId);
          return;
        }

        const { job, device } = verified;

        if (!["authorized", "running"].includes(job.status)) {
          console.warn("Rejected completion for job state:", job.status);
          return;
        }

        job.progress = finalStatus === "completed"
          ? 100
          : (validProgress(data.progress) ?? job.progress);

        job.status = finalStatus;
        job.completedAt = new Date();

        // Accept only bounded evidence fields.
        job.wipedFiles = Array.isArray(data.wipedFiles)
          ? data.wipedFiles
          : [];

        job.verifiedFiles = Array.isArray(data.verifiedFiles)
          ? data.verifiedFiles
          : [];

        job.verificationFailures = Array.isArray(data.verificationFailures)
          ? data.verificationFailures
          : [];

        job.verificationHash = String(data.verificationHash || "");
        job.verificationEvidenceHash = String(
          data.verificationEvidenceHash || ""
        );

        job.events.push({
          message: `Job ${finalStatus}`,
          timestamp: new Date()
        });

        await job.save();

        /* ------------------------------------
           UPDATE VERIFIED DEVICE
        ------------------------------------ */

        device.status = finalStatus === "completed"
          ? "Completed"
          : "Failed";

        device.currentJobId = null;
        device.lastJobId = job._id;

        await device.save();

        /* ------------------------------------
           GENERATE CERTIFICATE
        ------------------------------------ */

        if (finalStatus === "completed") {
          try {
            const certificate = await Certificate.create({
              certificateId: `TW-${Date.now()}`,
              deviceId: device._id,
              jobId: job._id,
              manufacturer: device.manufacturer || "",
              modelNumber: device.modelNumber || "",
              owner: device.owner,
              location: device.location || "",
              deviceType: device.storageType || "",
              storagePath: device.storagePath || "",
              sanitizationStandard: "NIST SP 800-88 Rev.1",
              algorithm: job.algorithm,
              verificationMethod: job.verificationMethod,
              verificationHash: job.verificationHash,
              verificationEvidenceHash: job.verificationEvidenceHash,
              verificationStatus: "VERIFIED",
              wipedFiles: job.wipedFiles,
              verifiedFiles: job.verifiedFiles,
              verificationFailures: job.verificationFailures,
              wipeCompletedAt: job.completedAt,
              signature: "TrustWipe Digital Signature"
            });

            const pdfPath = await generateCertificate(
              certificate,
              device
            );

            certificate.pdfUrl = pdfPath;
            await certificate.save();

            job.certificateId = certificate.certificateId;
            await job.save();

            console.log("Certificate generated:", certificate.certificateId);

          } catch (error) {
            console.error("Certificate generation failed:", error.message);
          }
        }

        emitToAgent(agent.agentId, "wipe-complete", {
          jobId: String(job._id),
          status: job.status,
          certificateId: job.certificateId || null
        });

        emitToAgent(agent.agentId, "device-updated", {
          deviceId: String(device._id),
          status: device.status,
          jobId: String(job._id)
        });

      } catch (error) {
        console.error("Wipe completion error:", error.message);
      }
    });

    /* ========================================
       FORENSIC PROGRESS
    ======================================== */

    socket.on("forensic-progress", (data = {}) => {
      const agent = getRegisteredAgentForSocket(socket);

      if (!agent || !isSocketAuthorizedForAgent(socket, getAgentId(data))) {
        return;
      }

      const jobId = data.jobId || data.commandId;
      const progress = validProgress(data.progress);

      if (!jobId || progress === null) return;

      emitToAgent(agent.agentId, "forensic-progress", {
        jobId,
        agentId: agent.agentId,
        progress,
        timestamp: new Date().toISOString()
      });
    });

    /* ========================================
       FORENSIC COMPLETE
    ======================================== */

    socket.on("forensic-complete", (data = {}) => {
      const agent = getRegisteredAgentForSocket(socket);

      if (!agent || !isSocketAuthorizedForAgent(socket, getAgentId(data))) {
        return;
      }

      const jobId = data.jobId || data.commandId;

      if (!jobId) return;

      emitToAgent(agent.agentId, "forensic-complete", {
        jobId,
        agentId: agent.agentId,
        status: "completed",
        timestamp: new Date().toISOString()
      });
    });

    /* ========================================
       FORENSIC ERROR
    ======================================== */

    socket.on("forensic-error", (data = {}) => {
      const agent = getRegisteredAgentForSocket(socket);

      if (!agent || !isSocketAuthorizedForAgent(socket, getAgentId(data))) {
        return;
      }

      emitToAgent(agent.agentId, "forensic-error", {
        jobId: data.jobId || data.commandId || null,
        agentId: agent.agentId,
        status: "failed",
        timestamp: new Date().toISOString()
      });
    });

    /* ========================================
       AGENT STATUS REQUEST
    ======================================== */

    socket.on("get-agent-status", () => {
      const agent = getRegisteredAgentForSocket(socket);

      // An untrusted browser socket receives no agent information.
      socket.emit("agent-list", agent ? [{
        agentId: agent.agentId,
        status: agent.status,
        hostname: agent.hostname,
        platform: agent.platform,
        capabilities: agent.capabilities
      }] : []);
    });

    /* ========================================
       DISCONNECT
    ======================================== */

    socket.on("disconnect", (reason) => {
      console.log("Socket disconnected:", socket.id, reason);

      const agent = getRegisteredAgentForSocket(socket);

      if (!agent) return;

      const removed = unregisterAgent(
        agent.agentId,
        socket.id
      );

      if (removed) {
        io.emit("agent-status", {
          agentId: agent.agentId,
          deviceId: agent.agentId,
          status: "offline"
        });
      }
    });
  });

  return io;
};

/* ==========================================
   GET SOCKET.IO INSTANCE
========================================== */

export const getIO = () => {
  if (!io) {
    throw new Error("Socket.IO has not been initialized.");
  }

  return io;
};

/* ==========================================
   GET CONNECTED AGENTS
========================================== */

export const getConnectedAgents = () => listAgents();

/* ==========================================
   GET SINGLE AGENT
========================================== */

export const getAgentById = (deviceId) => getAgent(deviceId);

/* ==========================================
   CHECK AGENT ONLINE
========================================== */

export const isAgentOnline = (deviceId) => isAgentConnected(deviceId);

/* ==========================================
   DEFAULT EXPORT
========================================== */

export default {
  initAgentClient,
  getIO,
  getConnectedAgents,
  getAgentById,
  isAgentOnline
};
