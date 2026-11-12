
/* ==========================================
   backend/src/socket/index.js
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
  String(
    data.agentId ||
    data.deviceId ||
    ""
  ).trim();

const getRegisteredAgentForSocket = (socket) => {
  return listAgents().find(
    (agent) => agent.socketId === socket.id
  ) || null;
};

const isSocketAuthorizedForAgent = (
  socket,
  agentId
) => {
  const agent = getAgentInternal(agentId);

  return Boolean(
    agent &&
    agent.authenticated === true &&
    agent.socketId === socket.id &&
    agent.socket?.connected
  );
};

const emitToAgent = (agentId, event, payload) => {
  if (!io || !agentId) return;

  io.to(`agent:${agentId}`).emit(event, payload);
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
    console.warn(
      "Socket.IO is already initialized."
    );

    return io;
  }

  const allowedOrigins = (
    process.env.FRONTEND_URL ||
    process.env.FRONTEND_ORIGIN ||
    "http://localhost:5173"
  )
    .split(",")
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
    console.log(
      "Socket connected:",
      socket.id
    );

    /* ========================================
       REGISTER AGENT
    ======================================== */

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
         * Verify the agent using a server-side
         * credential. Never trust metadata.demo.
         */
        const authenticated = authenticateAgent(
          agentId,
          agent.agentToken
        );

        if (!authenticated) {
          socket.emit("agent-registered", {
            success: false,
            error: "Agent authentication failed."
          });

          console.warn(
            "Rejected unauthenticated agent:",
            agentId
          );

          return;
        }

        const registeredAgent = registerAgent({
          ...agent,
          agentId,
          deviceId: agentId,
          socket,
          authenticated: true
        });

        socket.join(`agent:${agentId}`);

        socket.emit("agent-registered", {
          success: true,
          agentId,
          deviceId: agentId,
          status: "online"
        });

        /*
         * Status is informational only.
         * Do not broadcast drives or wipe details.
         */
        io.emit("agent-status", {
          agentId,
          deviceId: agentId,
          status: "online",
          hostname: registeredAgent.hostname,
          platform: registeredAgent.platform,
          capabilities: registeredAgent.capabilities
        });

        console.log(
          "Authenticated agent registered:",
          agentId
        );

      } catch (error) {
        console.error(
          "Agent registration error:",
          error.message
        );

        socket.emit("agent-registered", {
          success: false,
          error: error.message
        });
      }
    });

    /* ========================================
       HEARTBEAT
    ======================================== */

    socket.on("heartbeat", (data = {}) => {
      try {
        const agentId = getAgentId(data);

        if (
          !agentId ||
          !isSocketAuthorizedForAgent(socket, agentId)
        ) {
          console.warn(
            "Rejected heartbeat from unauthorized socket."
          );

          return;
        }

        const updated = updateAgentHeartbeat(
          agentId,
          data
        );

        if (!updated) return;

        io.emit("agent-status", {
          agentId,
          deviceId: agentId,
          status: "online"
        });

      } catch (error) {
        console.error(
          "Heartbeat error:",
          error.message
        );
      }
    });

    /* ========================================
       DRIVE DISCOVERY RESPONSE
    ======================================== */

    socket.on("drive-list", (data = {}) => {
      try {
        const agentId = getAgentId(data);

        if (
          !agentId ||
          !isSocketAuthorizedForAgent(socket, agentId)
        ) {
          console.warn(
            "Rejected drive-list from unauthorized socket."
          );

          return;
        }

        const drives = Array.isArray(data.drives)
          ? data.drives
          : [];

        const result = {
          ...data,
          agentId,
          deviceId: agentId,
          drives,
          timestamp:
            data.timestamp ||
            new Date().toISOString()
        };

        if (data.requestId) {
          const resolved = resolveDriveDiscovery(
            data.requestId,
            result,
            socket.id
          );

          console.log(
            resolved
              ? "Drive discovery resolved."
              : "Drive discovery response not matched."
          );
        }

        /*
         * No global drive-list broadcast.
         * The HTTP controller receives the Promise result.
         */

      } catch (error) {
        console.error(
          "Drive discovery response error:",
          error.message
        );
      }
    });

    /* ========================================
       WIPE PROGRESS
    ======================================== */

    socket.on("wipe-progress", async (data = {}) => {
      try {
        const agentId = getAgentId(data);

        if (
          !agentId ||
          !isSocketAuthorizedForAgent(socket, agentId)
        ) {
          return;
        }

        const jobId = data.commandId || data.jobId;

        if (!jobId) return;

        const progress = Number(data.progress);

        if (
          !Number.isFinite(progress) ||
          progress < 0 ||
          progress > 100
        ) {
          return;
        }

        /*
         * Important:
         * Before production use, add a verified
         * job-to-agent/device ownership condition
         * to this database query.
         */
        const job = await WipeJob.findByIdAndUpdate(
          jobId,
          {
            progress,
            status: "running",
            $push: {
              events: {
                message:
                  data.message ||
                  "Wipe progress updated.",
                timestamp: new Date()
              }
            }
          },
          { new: true }
        );

        if (!job) return;

        emitToAgent(
          agentId,
          "wipe-progress",
          job
        );

      } catch (error) {
        console.error(
          "Wipe progress error:",
          error.message
        );
      }
    });

    /* ========================================
       WIPE COMPLETE
    ======================================== */

    socket.on("wipe-complete", async (data = {}) => {
      try {
        const agentId = getAgentId(data);

        if (
          !agentId ||
          !isSocketAuthorizedForAgent(socket, agentId)
        ) {
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
          console.warn(
            "Rejected invalid wipe completion status."
          );

          return;
        }

        /*
         * Production requirement:
         * Verify this job belongs to a device assigned
         * to this exact agent before updating it.
         */
        const job = await WipeJob.findByIdAndUpdate(
          jobId,
          {
            progress:
              finalStatus === "completed"
                ? 100
                : Number(data.progress || 0),

            status: finalStatus,

            completedAt: new Date(),

            wipedFiles: data.wipedFiles,
            verifiedFiles: data.verifiedFiles,

            verificationFailures:
              data.verificationFailures,

            verificationHash:
              data.verificationHash,

            verificationEvidenceHash:
              data.verificationEvidenceHash,

            $push: {
              events: {
                message: `Job ${finalStatus}`,
                timestamp: new Date()
              }
            }
          },
          { new: true }
        );

        if (!job) {
          console.warn(
            "Wipe job not found:",
            jobId
          );

          return;
        }

        /* ------------------------------------
           UPDATE DEVICE
        ------------------------------------ */

        const deviceStatus =
          finalStatus === "completed"
            ? "Completed"
            : "Failed";

        await Device.findByIdAndUpdate(
          job.deviceId,
          {
            status: deviceStatus,
            currentJobId: null,
            lastJobId: job._id
          },
          { new: true }
        );

        /* ------------------------------------
           GENERATE CERTIFICATE
        ------------------------------------ */

        if (finalStatus === "completed") {
          try {
            const device = await Device.findById(
              job.deviceId
            );

            if (!device) {
              throw new Error("Device not found.");
            }

            const certificate = await Certificate.create({
              certificateId: `TW-${Date.now()}`,

              deviceId: device._id,
              jobId: job._id,

              manufacturer:
                device.manufacturer || "",

              modelNumber:
                device.modelNumber || "",

              owner: device.owner,

              location:
                device.location || "",

              deviceType:
                device.storageType || "",

              storagePath:
                device.storagePath || "",

              sanitizationStandard:
                "NIST SP 800-88 Rev.1",

              algorithm: job.algorithm,

              verificationMethod:
                job.verificationMethod,

              verificationHash:
                job.verificationHash,

              verificationEvidenceHash:
                job.verificationEvidenceHash,

              verificationStatus: "VERIFIED",

              wipedFiles: job.wipedFiles,
              verifiedFiles: job.verifiedFiles,

              verificationFailures:
                job.verificationFailures,

              wipeCompletedAt: job.completedAt,

              signature:
                "TrustWipe Digital Signature"
            });

            const pdfPath = await generateCertificate(
              certificate,
              device
            );

            certificate.pdfUrl = pdfPath;

            await certificate.save();

            job.certificateId =
              certificate.certificateId;

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

        /* ------------------------------------
           NOTIFY AGENT ROOM ONLY
        ------------------------------------ */

        emitToAgent(
          agentId,
          "wipe-complete",
          job
        );

        emitToAgent(
          agentId,
          "device-updated",
          {
            deviceId: job.deviceId,
            status: deviceStatus,
            jobId: job._id
          }
        );

      } catch (error) {
        console.error(
          "Wipe completion error:",
          error.message
        );
      }
    });

    /* ========================================
       FORENSIC PROGRESS
    ======================================== */

    socket.on("forensic-progress", (data = {}) => {
      try {
        const agentId = getAgentId(data);

        if (
          !agentId ||
          !isSocketAuthorizedForAgent(socket, agentId)
        ) {
          return;
        }

        const jobId = data.jobId || data.commandId;

        if (!jobId) return;

        const progress = Number(data.progress || 0);

        if (
          !Number.isFinite(progress) ||
          progress < 0 ||
          progress > 100
        ) {
          return;
        }

        emitToAgent(
          agentId,
          "forensic-progress",
          {
            ...data,
            agentId,
            jobId,
            progress,
            timestamp: new Date().toISOString()
          }
        );

      } catch (error) {
        console.error(
          "Forensic progress error:",
          error.message
        );
      }
    });

    /* ========================================
       FORENSIC COMPLETE
    ======================================== */

    socket.on("forensic-complete", (data = {}) => {
      try {
        const agentId = getAgentId(data);

        if (
          !agentId ||
          !isSocketAuthorizedForAgent(socket, agentId)
        ) {
          return;
        }

        const jobId = data.jobId || data.commandId;

        if (!jobId) return;

        emitToAgent(
          agentId,
          "forensic-complete",
          {
            ...data,
            agentId,
            jobId,
            status: data.status || "completed",
            timestamp: new Date().toISOString()
          }
        );

      } catch (error) {
        console.error(
          "Forensic completion error:",
          error.message
        );
      }
    });

    /* ========================================
       FORENSIC ERROR
    ======================================== */

    socket.on("forensic-error", (data = {}) => {
      try {
        const agentId = getAgentId(data);

        if (
          !agentId ||
          !isSocketAuthorizedForAgent(socket, agentId)
        ) {
          return;
        }

        const jobId =
          data.jobId ||
          data.commandId ||
          null;

        emitToAgent(
          agentId,
          "forensic-error",
          {
            ...data,
            agentId,
            jobId,
            status: "failed",
            timestamp: new Date().toISOString()
          }
        );

      } catch (error) {
        console.error(
          "Forensic error handler failed:",
          error.message
        );
      }
    });

    /* ========================================
       AGENT STATUS REQUEST
    ======================================== */

    socket.on("get-agent-status", () => {
      const agent = getRegisteredAgentForSocket(socket);

      /*
       * Do not expose all connected agents to
       * arbitrary unauthenticated sockets.
       */
      socket.emit(
        "agent-list",
        agent ? [agent] : []
      );
    });

    /* ========================================
       DISCONNECT
    ======================================== */

    socket.on("disconnect", (reason) => {
      console.log(
        "Socket disconnected:",
        socket.id,
        reason
      );

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
    throw new Error(
      "Socket.IO has not been initialized."
    );
  }

  return io;
};

/* ==========================================
   GET CONNECTED AGENTS
========================================== */

export const getConnectedAgents = () =>
  listAgents();

/* ==========================================
   GET SINGLE AGENT
========================================== */

export const getAgentById = (deviceId) =>
  getAgent(deviceId);

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
  getAgentById,
  isAgentOnline
};
