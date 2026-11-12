
import mongoose from "mongoose";

import Device from "../models/Device.js";
import WipeJob from "../models/WipeJob.js";
import { getAgentInternal } from "../socket/agentBridge.js";

/**
 * Dispatch an existing, approved wipe job.
 *
 * This is a server-side authorization gate.
 * The physical agent must independently verify a signed
 * authorization before performing any destructive operation.
 */
export const runWipeEngine = async (jobId, userId) => {
  if (
    !mongoose.isValidObjectId(jobId) ||
    !mongoose.isValidObjectId(userId)
  ) {
    throw new Error("Invalid job or user ID.");
  }

  // 1. Load the job belonging to this user.
  const job = await WipeJob.findOne({
    _id: jobId,
    initiatedBy: userId,
    status: "pending"
  });

  if (!job) {
    throw new Error("Pending wipe job not found or access denied.");
  }

  // 2. Load the device and verify ownership.
  const device = await Device.findOne({
    _id: job.deviceId,
    owner: userId
  });

  if (!device) {
    throw new Error("Device not found or access denied.");
  }

  // 3. Never permit demo devices in the physical wipe engine.
  if (
    device.isDemo === true ||
    device.storagePath?.startsWith("DEMO://")
  ) {
    throw new Error("Demo devices cannot enter the physical wipe engine.");
  }

  // 4. Verify device-agent assignment.
  if (
    !device.agentId ||
    String(device.agentId) !== String(job.agentId)
  ) {
    throw new Error("Device and job agent assignments do not match.");
  }

  // 5. Check explicit authorization.
  const authorization = job.authorization;

  if (
    !authorization ||
    authorization.approved !== true ||
    !authorization.authorizationId ||
    !authorization.nonceHash ||
    !authorization.expiresAt ||
    authorization.consumedAt ||
    new Date(authorization.expiresAt).getTime() <= Date.now()
  ) {
    throw new Error("Valid, unused owner authorization is required.");
  }

  // 6. Confirm the trusted agent is online and authenticated.
  const agent = getAgentInternal(device.agentId);

  if (
    !agent ||
    agent.authenticated !== true ||
    !agent.socket ||
    !agent.socket.connected ||
    String(agent.socketId) !== String(agent.socket.id)
  ) {
    throw new Error("Trusted agent is offline or unauthenticated.");
  }

  // 7. Atomically consume authorization and claim the job.
  // Only one concurrent request can successfully claim it.
  const claimedJob = await WipeJob.findOneAndUpdate(
    {
      _id: job._id,
      initiatedBy: userId,
      status: "pending",
      "authorization.approved": true,
      "authorization.authorizationId": authorization.authorizationId,
      "authorization.nonceHash": authorization.nonceHash,
      "authorization.consumedAt": null,
      "authorization.expiresAt": { $gt: new Date() }
    },
    {
      $set: {
        status: "running",
        startedAt: new Date(),
        "authorization.consumedAt": new Date()
      },
      $push: {
        events: {
          message: "Authorization consumed. Dispatching to trusted agent.",
          timestamp: new Date()
        }
      }
    },
    { new: true }
  );

  if (!claimedJob) {
    throw new Error(
      "Authorization was already consumed, expired, or the job was claimed."
    );
  }

  // 8. Update device status.
  try {
    const updatedDevice = await Device.findOneAndUpdate(
      {
        _id: device._id,
        owner: userId,
        agentId: job.agentId,
        isDemo: { $ne: true },
        status: { $ne: "Wiping" }
      },
      {
        $set: {
          status: "Wiping",
          currentJobId: claimedJob._id
        }
      },
      { new: true }
    );

    if (!updatedDevice) {
      throw new Error("Device could not be reserved for this wipe job.");
    }

    // 9. Dispatch to the authenticated agent socket.
    // The agent must independently validate the signed authorization.
    agent.socket.emit("start-wipe", {
      commandId: claimedJob._id.toString(),
      jobId: claimedJob._id.toString(),
      deviceId: device._id.toString(),
      agentId: device.agentId,
      serialNumber: device.serialNumber,
      storagePath: device.storagePath,
      algorithm: claimedJob.algorithm,
      authorizationId: authorization.authorizationId,
      authorizationNonceHash: authorization.nonceHash,
      issuedAt: new Date().toISOString()
    });

    await WipeJob.updateOne(
      { _id: claimedJob._id },
      {
        $push: {
          events: {
            message: "Wipe command dispatched to trusted agent.",
            timestamp: new Date()
          }
        }
      }
    );

    return claimedJob;

  } catch (error) {
    // Do not silently leave a job running after dispatch failure.
    await WipeJob.updateOne(
      {
        _id: claimedJob._id,
        status: "running"
      },
      {
        $set: {
          status: "failed",
          failureReason: error.message,
          completedAt: new Date()
        },
        $push: {
          events: {
            message: `Dispatch failed: ${error.message}`,
            timestamp: new Date()
          }
        }
      }
    );

    await Device.updateOne(
      {
        _id: device._id,
        currentJobId: claimedJob._id
      },
      {
        $set: {
          status: "Failed",
          currentJobId: null,
          lastJobId: claimedJob._id
        }
      }
    );

    throw error;
  }
};
