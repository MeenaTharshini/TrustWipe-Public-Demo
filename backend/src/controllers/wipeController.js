
import mongoose from "mongoose";

import Device from "../models/Device.js";
import WipeJob from "../models/WipeJob.js";

/**
 * Start a wipe request.
 *
 * This creates a pending job only.
 * It does NOT execute a physical wipe.
 */
export const startWipeController = async (req, res) => {
  try {
    const { deviceId, algorithm } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    if (!deviceId || !mongoose.isValidObjectId(deviceId)) {
      return res.status(400).json({
        success: false,
        message: "A valid deviceId is required."
      });
    }

    // Only the device owner can request a wipe.
    const device = await Device.findOne({
      _id: deviceId,
      owner: userId
    });

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device not found or access denied."
      });
    }

    // Never allow simulated demo devices into physical wipe workflow.
    if (
      device.isDemo === true ||
      device.storagePath?.startsWith("DEMO://")
    ) {
      return res.status(403).json({
        success: false,
        message: "Demo devices cannot be physically wiped."
      });
    }

    if (!device.agentId) {
      return res.status(409).json({
        success: false,
        message: "No trusted agent is assigned to this device."
      });
    }

    if (device.status === "Wiping") {
      return res.status(409).json({
        success: false,
        message: "A wipe operation is already in progress."
      });
    }

    // Prevent multiple active jobs for the same device.
    const existingJob = await WipeJob.findOne({
      deviceId: device._id,
      status: { $in: ["pending", "running"] }
    });

    if (existingJob) {
      return res.status(409).json({
        success: false,
        message: "An active wipe job already exists.",
        jobId: existingJob._id
      });
    }

    const job = await WipeJob.create({
      deviceId: device._id,
      initiatedBy: userId,
      agentId: device.agentId,
      algorithm: algorithm || "NIST SP 800-88 Clear",
      status: "pending",
      progress: 0,
      authorization: {
        approved: false
      },
      events: [
        {
          message: "Wipe request created. Awaiting explicit owner authorization."
        }
      ]
    });

    return res.status(201).json({
      success: true,
      job,
      message: "Wipe request created. Owner authorization is required before execution."
    });

  } catch (err) {
    console.error("START WIPE ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Unable to create wipe request."
    });
  }
};


/**
 * Get all wipe jobs belonging to the authenticated user.
 */
export const getAllJobs = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    const jobs = await WipeJob.find({
      initiatedBy: userId
    })
      .populate({
        path: "deviceId",
        match: { owner: userId }
      })
      .sort({ createdAt: -1 });

    // Exclude jobs whose associated device is no longer accessible.
    const ownedJobs = jobs.filter(job => job.deviceId !== null);

    return res.json({
      success: true,
      jobs: ownedJobs
    });

  } catch (err) {
    console.error("GET JOBS ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve wipe jobs."
    });
  }
};


/**
 * Get a single wipe job belonging to the authenticated user.
 */
export const getJobById = async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    if (!mongoose.isValidObjectId(jobId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid job ID."
      });
    }

    const job = await WipeJob.findOne({
      _id: jobId,
      initiatedBy: userId
    }).populate({
      path: "deviceId",
      match: { owner: userId }
    });

    if (!job || !job.deviceId) {
      return res.status(404).json({
        success: false,
        message: "Wipe job not found or access denied."
      });
    }

    return res.json({
      success: true,
      job
    });

  } catch (err) {
    console.error("GET JOB ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve wipe job."
    });
  }
};


/**
 * Get the latest wipe job belonging to the authenticated user.
 */
export const getLatestJobForUser = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    const job = await WipeJob.findOne({
      initiatedBy: userId
    })
      .populate({
        path: "deviceId",
        match: { owner: userId }
      })
      .sort({ createdAt: -1 });

    if (!job || !job.deviceId) {
      return res.json({
        success: true,
        job: null
      });
    }

    return res.json({
      success: true,
      job
    });

  } catch (err) {
    console.error("GET LATEST JOB ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve latest wipe job."
    });
  }
};
