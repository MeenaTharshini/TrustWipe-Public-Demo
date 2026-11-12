
/* ==========================================
   backend/src/socket/index.js
========================================== */

import { Server } from "socket.io";

import {
  setSocket,
  registerAgent,
  unregisterAgent,
  updateAgentHeartbeat,
  resolveDriveDiscovery,
  getAgentInternal,
  getAgent as getBridgeAgent,
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

const DEMO_AGENT_ID = process.env.TRUSTWIPE_DEMO_AGENT_ID;

const allowedOrigins = (
  process.env.FRONTEND_URL ||
  "http://localhost:5173,https://trust-wipe-public-demo.vercel.app"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/* ==========================================
   HELPERS
========================================== */

const getAgentId = (data = {}) =>
  String(data.agentId || data.deviceId || "").trim();

const getRegisteredAgentForSocket = (socket) => {
  return listAgents().find(
    (agent) => agent.socketId === socket.id
  ) || null;
};

const isSocketAuthorizedForAgent = (socket, agentId) => {
  const id = String(agentId || "").trim();

  if (!id) return false;

  const agent = getAgentInternal(id);

  return Boolean(
    agent &&
    agent.socketId === socket.id &&
    agent.socket?.connected
  );
};

const emitToAgent = (agentId, event, payload) => {
  if (!io || !agentId) return;

  io.to(`agent:${agentId}`).emit(event, payload);
};

/*
 * Fail closed unless the database links this job's
 * device to the agent reporting the event.
 *
 * This expects Device.agentId or Device.deviceId,
 * or WipeJob.agentId, to contain the registered ID.
 */
const getAuthorizedJob = async (jobId, agentId) => {
  if (!jobId || !agentId) return null;

  const job = await WipeJob.findById(jobId);

  if (!job) return null;

  const device = await Device.findById(job.deviceId);

  if (!device) return null;

  const linkedAgentId = String(
    job.agentId ||
    device.agentId ||
    device.deviceId ||
    ""
  ).trim();

  if (!linkedAgentId || linkedAgentId !== String(agentId)) {
    console.warn(
      "Rejected job event: job/device does not belong to reporting agent."
    );

    return null;
  }

  return { job, device };
};

/* ==========================================
   SOCKET INITIALIZATION
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

  console.log("TrustWipe Socket.IO initialized.");

  /* ========================================
     CONNECTION
  ======================================== */

  io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);

    /* ======================================
       REGISTER AGENT
    ====================================== */

    socket.on("register-agent", (agent = {}) => {
      try {
        const agentId = getAgentId(agent);

        if (!agentId) {
          socket.emit("agent-registered", {
            success: false,
            error: "Missing agentId/deviceId."
          });
          return;
        }

        /*
         * The configured demo agent must have a separate
         * server-validated registration token.
         */
        if (
          agentId === DEMO_AGENT_ID &&
          !process.env.TRUSTWIPE_DEMO_AGENT_TOKEN
        ) {
          socket.emit("agent-registered", {
            success: false,
            error: "Demo agent authentication is not configured."
          });
          return;
        }

        const registeredAgent = registerAgent({
          ...agent,
          agentId,
          deviceId: agentId,
          socket,
          demoToken: agent.demoToken
        });

        if (!registeredAgent) {
          socket.emit("agent-registered", {
            success: false,
            error: "Agent registration failed."
          });
          return;
        }

        socket.join(`agent:${agentId}`);

        socket.emit("agent-registered", {
          success: true,
          agentId,
          deviceId: agentId,
          status: "online"
        });

        /*
         * Do not broadcast hostnames or capabilities to
         * every connected client.
         */
        console.log("Agent registered:", agentId);
      } catch (error) {
        console.error("Agent registration error:", error.message);

        socket.emit("agent-registered", {
          success: false,
          error: "Agent registration failed."
        });
      }
    });

    /* ======================================
       HEARTBEAT
    ====================================== */

    socket.on("heartbeat", (data = {}) => {
      try {
        const agentId = getAgentId(data);

        if (!isSocketAuthorizedForAgent(socket, agentId)) {
          console.warn("Rejected unauthorized heartbeat.");
          return;
        }

        updateAgentHeartbeat(agentId, data);
      } catch (error) {
        console.error("Heartbeat error:", error.message);
      }
    });

    /* ======================================
       DRIVE DISCOVERY RESPONSE
    ====================================== */

    socket.on("drive-list", (data = {}) => {
      try {
        const agentId = getAgentId(data);

        if (!isSocketAuthorizedForAgent(socket, agentId)) {
          console.warn("Rejected unauthorized drive-list.");
          return;
        }

        if (!data.requestId) {
          console.warn("Drive-list response missing requestId.");
          return;
        }

        const drives = Array.isArray(data.drives)
          ? data.drives
          : [];

        const resolved = resolveDriveDiscovery(
          data.requestId,
          {
            success: true,
            agentId,
            deviceId: agentId,
            drives,
            timestamp: data.timestamp || new Date().toISOString()
          },
          socket.id
        );

        console.log(
          resolved
            ? `Drive discovery resolved for ${agentId}.`
            : `Unmatched drive discovery response from ${agentId}.`
        );

        /*
         * Do not resolve discovery using data.userId.
         * A user ID supplied by an agent event is not
         * proof of ownership.
         *
         * Do not broadcast drive lists globally.
         */
      } catch (error) {
        console.error("Drive-list error:", error.message);
      }
    });

    /* ======================================
       WIPE PROGRESS
    ====================================== */

    socket.on("wipe-progress", async (data = {}) => {
      try {
        const agentId = getAgentId(data);

        if (!isSocketAuthorizedForAgent(socket, agentId)) {
          console.warn("Rejected unauthorized wipe-progress.");
          return;
        }

        const jobId = data.commandId || data.jobId;

        const progress = Number(data.progress);

        if (
          !jobId ||
          !Number.isFinite(progress) ||
          progress < 0 ||
          progress > 100
        ) {
          return;
        }

        const authorized = await getAuthorizedJob(jobId, agentId);

        if (!authorized) return;

        const { job } = authorized;

        if (
          job.status === "completed" ||
          job.status === "failed"
        ) {
          return;
        }

        job.progress = progress;
        job.status = "running";

        job.events = job.events || [];
        job.events.push({
          message: data.message || "Wipe progress updated.",
          timestamp: new Date()
        });

        await job.save();

        emitToAgent(agentId, "wipe-progress", job);
      } catch (error) {
        console.error("Wipe-progress error:", error.message);
      }
    });

    /* ======================================
       WIPE COMPLETE
    ====================================== */

    socket.on("wipe-complete", async (data = {}) => {
      try {
        const agentId = getAgentId(data);

        if (!isSocketAuthorizedForAgent(socket, agentId)) {
          console.warn("Rejected unauthorized wipe-complete.");
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

        if (!finalStatus) {
          console.warn("Rejected invalid wipe completion status.");
          return;
        }

        const authorized = await getAuthorizedJob(jobId, agentId);

        if (!authorized) return;

        const { job, device } = authorized;

        if (
          job.status === "completed" ||
          job.status === "failed"
        ) {
          console.warn("Ignoring duplicate wipe completion:", jobId);
          return;
        }

        job.progress =
          finalStatus === "completed"
            ? 100
            : Math.min(
                100,
                Math.max(0, Number(data.progress) || 0)
              );

        job.status = finalStatus;
        job.completedAt = new Date();

        job.wipedFiles = data.wipedFiles;
        job.verifiedFiles = data.verifiedFiles;
        job.verificationFailures = data.verificationFailures;
        job.verificationHash = data.verificationHash;
        job.verificationEvidenceHash =
          data.verificationEvidenceHash;

        job.events = job.events || [];
        job.events.push({
          message: `Job ${finalStatus}`,
          timestamp: new Date()
        });

        await job.save();

        /* ----------------------------------
           UPDATE DEVICE
        ---------------------------------- */

        const deviceStatus =
          finalStatus === "completed"
            ? "Completed"
            : "Failed";

        device.status = deviceStatus;
        device.currentJobId = null;
        device.lastJobId = job._id;

        await device.save();

        /* ----------------------------------
           GENERATE CERTIFICATE
        ---------------------------------- */

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
              verificationEvidenceHash:
                job.verificationEvidenceHash,
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

            console.log(
              "Certificate generated:",
              certificate.certificateId
            );
          } catch (error) {
            console.error(
              "Certificate generation failed:",
              error.message
            );
          }
        }

        /*
         * This room currently contains the agent socket.
         * User dashboard notifications require a separate
         * authenticated user room.
         */
        emitToAgent(agentId, "wipe-complete", job);

        emitToAgent(agentId, "device-updated", {
          deviceId: device._id,
          status: deviceStatus,
          jobId: job._id
        });
      } catch (error) {
        console.error("Wipe-complete error:", error.message);
      }
    });

    /* ======================================
       FORENSIC PROGRESS
    ====================================== */

    socket.on("forensic-progress", (data = {}) => {
      try {
        const agentId = getAgentId(data);

        if (!isSocketAuthorizedForAgent(socket, agentId)) {
          return;
        }

        const jobId = data.jobId || data.commandId;
        const progress = Number(data.progress);

        if (
          !jobId ||
          !Number.isFinite(progress) ||
          progress < 0 ||
          progress > 100
        ) {
          return;
        }

        emitToAgent(agentId, "forensic-progress", {
          ...data,
          agentId,
          jobId,
          progress,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error("Forensic-progress error:", error.message);
      }
    });

    /* ======================================
       FORENSIC COMPLETE
    ====================================== */

    socket.on("forensic-complete", (data = {}) => {
      try {
        const agentId = getAgentId(data);

        if (!isSocketAuthorizedForAgent(socket, agentId)) {
          return;
        }

        const jobId = data.jobId || data.commandId;

        if (!jobId) return;

        emitToAgent(agentId, "forensic-complete", {
          ...data,
          agentId,
          jobId,
          status: data.status || "completed",
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error("Forensic-complete error:", error.message);
      }
    });

    /* ======================================
       FORENSIC ERROR
    ====================================== */

    socket.on("forensic-error", (data = {}) => {
      try {
        const agentId = getAgentId(data);

        if (!isSocketAuthorizedForAgent(socket, agentId)) {
          return;
        }

        const jobId = data.jobId || data.commandId || null;

        emitToAgent(agentId, "forensic-error", {
          ...data,
          agentId,
          jobId,
          status: "failed",
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error("Forensic-error error:", error.message);
      }
    });

    /* ======================================
       AGENT STATUS REQUEST
    ====================================== */

    socket.on("get-agent-status", () => {
      try {
        const agent = getRegisteredAgentForSocket(socket);

        socket.emit("agent-list", agent ? [agent] : []);
      } catch (error) {
        console.error("Agent status error:", error.message);
      }
    });

    /* ======================================
       DISCONNECT
    ====================================== */

    socket.on("disconnect", (reason) => {
      const agent = getRegisteredAgentForSocket(socket);

      console.log("Socket disconnected:", socket.id, reason);

      if (!agent) return;

      const removed = unregisterAgent(
        agent.agentId,
        socket.id
      );

      if (removed) {
        console.log("Agent disconnected:", agent.agentId);
      }
    });
  });

  return io;
};

/* ==========================================
   GET SOCKET INSTANCE
========================================== */

export const getIO = () => {
  if (!io) {
    throw new Error(
      "Socket.IO has not been initialized."
    );
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

export const getAgent = (deviceId) =>
  getBridgeAgent(deviceId);

/* ==========================================
   CHECK AGENT ONLINE
========================================== */

export const isAgentOnline = (deviceId) =>
  isAgentConnected(deviceId);

/* ==========================================
   DEFAULT EXPORT
========================================== */

export default {
  initAgentClient,
  getIO,
  getConnectedAgents,
  getAgent,
  isAgentOnline
};
