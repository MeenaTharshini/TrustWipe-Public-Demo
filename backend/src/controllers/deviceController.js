
import Device from "../models/Device.js";
import { requestDriveDiscovery } from "../services/driveDiscovery.js";
import path from "path";

// ------------------------------------------------------------
// PUBLIC DEMO CONFIGURATION
// ------------------------------------------------------------

// Set TRUSTWIPE_PUBLIC_DEMO=true in Render for the public demo.
// Anonymous visitors receive simulated drives only.
// They cannot discover or access physical drives.

const PUBLIC_DEMO_ENABLED =
  process.env.TRUSTWIPE_PUBLIC_DEMO === "true";

// ------------------------------------------------------------
// SIMULATED DEMO DRIVES
// ------------------------------------------------------------

const getDemoDevices = () => [
  {
    _id: "demo-drive-001",
    deviceName: "Demo System Drive",
    serialNumber: "DEMO-SSD-001",
    storageType: "SSD",
    capacity: "512 GB",
    manufacturer: "Demo Manufacturer",
    modelNumber: "DEMO-SSD-512",
    deviceType: "Solid State Drive",
    storagePath: "DEMO://SYSTEM-DRIVE",
    status: "Ready",
    agentId: "DEMO-AGENT",
    isDemo: true,
  },
  {
    _id: "demo-drive-002",
    deviceName: "Demo External Drive",
    serialNumber: "DEMO-HDD-002",
    storageType: "HDD",
    capacity: "1 TB",
    manufacturer: "Demo Manufacturer",
    modelNumber: "DEMO-HDD-1TB",
    deviceType: "External Hard Drive",
    storagePath: "DEMO://EXTERNAL-DRIVE",
    status: "Ready",
    agentId: "DEMO-AGENT",
    isDemo: true,
  },
  {
    _id: "demo-drive-003",
    deviceName: "Demo USB Drive",
    serialNumber: "DEMO-USB-003",
    storageType: "Flash",
    capacity: "64 GB",
    manufacturer: "Demo Manufacturer",
    modelNumber: "DEMO-USB-64",
    deviceType: "USB Flash Drive",
    storagePath: "DEMO://USB-DRIVE",
    status: "Ready",
    agentId: "DEMO-AGENT",
    isDemo: true,
  },
];

// ------------------------------------------------------------
// HELPER: NORMALIZE ERROR RESPONSE
// ------------------------------------------------------------

const sendError = (res, status, message, code) => {
  return res.status(status).json({
    success: false,
    code,
    message,
  });
};

// ------------------------------------------------------------
// AUTO DISCOVER DRIVES
// ------------------------------------------------------------

export const autoDiscoverDevices = async (req, res) => {
  try {
    // ------------------------------------------
    // PUBLIC VISITOR: SIMULATED DISCOVERY ONLY
    // ------------------------------------------

    if (!req.user?.id) {
      if (!PUBLIC_DEMO_ENABLED) {
        return sendError(
          res,
          401,
          "Please log in to discover your devices.",
          "AUTHENTICATION_REQUIRED"
        );
      }

      return res.status(200).json({
        success: true,
        demo: true,
        message: "Demo drives loaded successfully.",
        devices: getDemoDevices(),
      });
    }

    // ------------------------------------------
    // LOGGED-IN USER: REAL AGENT DISCOVERY
    // ------------------------------------------

    const result = await requestDriveDiscovery(req.user.id);

    if (!result || result.success !== true) {
      return res.status(503).json({
        success: false,
        demo: false,
        message:
          result?.message ||
          "No trusted device agent is currently available.",
        devices: [],
      });
    }

    return res.status(200).json({
      success: true,
      demo: false,
      message: result.message || "Drives discovered successfully.",
      devices: result.devices || [],
    });
  } catch (err) {
    console.error("Drive Discovery Error:", err);

    return sendError(
      res,
      500,
      "Unable to discover devices at this time.",
      "DRIVE_DISCOVERY_FAILED"
    );
  }
};

// ------------------------------------------------------------
// CREATE DEVICE
// ------------------------------------------------------------

export const createDevice = async (req, res) => {
  try {
    if (!req.user?.id) {
      return sendError(
        res,
        401,
        "Authentication required.",
        "AUTHENTICATION_REQUIRED"
      );
    }

    const {
      deviceName,
      serialNumber,
      storageType,
      capacity,
      location,
      manufacturer,
      modelNumber,
      deviceType,
      storagePath,
      agentId,
    } = req.body;

    if (!deviceName || !serialNumber) {
      return sendError(
        res,
        400,
        "Device name and serial number are required.",
        "MISSING_DEVICE_DETAILS"
      );
    }

    // Do not allow demo records to be persisted as physical devices.
    if (
      req.body.isDemo === true ||
      String(storagePath || "").startsWith("DEMO://")
    ) {
      return sendError(
        res,
        400,
        "Demo devices cannot be registered as physical devices.",
        "DEMO_DEVICE_NOT_ALLOWED"
      );
    }

    const device = await Device.create({
      owner: req.user.id,
      deviceName,
      serialNumber,
      storageType,
      capacity,
      location,
      manufacturer,
      modelNumber,
      deviceType,
      storagePath,

      files: [
        {
          fileName: storagePath
            ? path.basename(storagePath)
            : "Unknown",
          fileSize: "Unknown",
          path: storagePath,
          status: "Pending",
        },
      ],

      status: "Pending",
      agentId,
    });

    return res.status(201).json({
      success: true,
      message: "Device registered successfully.",
      device,
    });
  } catch (err) {
    console.error("Create Device Error:", err);

    return sendError(
      res,
      500,
      "Unable to register device.",
      "DEVICE_CREATE_FAILED"
    );
  }
};

// ------------------------------------------------------------
// GET ALL DEVICES
// ------------------------------------------------------------

export const getDevices = async (req, res) => {
  try {
    if (!req.user?.id) {
      return sendError(
        res,
        401,
        "Authentication required.",
        "AUTHENTICATION_REQUIRED"
      );
    }

    const devices = await Device.find({
      owner: req.user.id,
    }).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      devices,
    });
  } catch (err) {
    console.error("Get Devices Error:", err);

    return sendError(
      res,
      500,
      "Unable to retrieve devices.",
      "DEVICE_FETCH_FAILED"
    );
  }
};

// ------------------------------------------------------------
// GET DEVICE BY ID
// ------------------------------------------------------------

export const getDeviceById = async (req, res) => {
  try {
    if (!req.user?.id) {
      return sendError(
        res,
        401,
        "Authentication required.",
        "AUTHENTICATION_REQUIRED"
      );
    }

    const device = await Device.findOne({
      _id: req.params.id,
      owner: req.user.id,
    });

    if (!device) {
      return sendError(
        res,
        404,
        "Device not found.",
        "DEVICE_NOT_FOUND"
      );
    }

    return res.status(200).json({
      success: true,
      device,
    });
  } catch (err) {
    console.error("Get Device Error:", err);

    return sendError(
      res,
      500,
      "Unable to retrieve device.",
      "DEVICE_FETCH_FAILED"
    );
  }
};

// ------------------------------------------------------------
// UPDATE DEVICE
// ------------------------------------------------------------

export const updateDevice = async (req, res) => {
  try {
    if (!req.user?.id) {
      return sendError(
        res,
        401,
        "Authentication required.",
        "AUTHENTICATION_REQUIRED"
      );
    }

    // Only allow ordinary device information to be updated.
    // Ownership, status, agent association and wipe state must
    // not be changed through this general-purpose endpoint.
    const allowedFields = [
      "deviceName",
      "location",
      "manufacturer",
      "modelNumber",
      "deviceType",
    ];

    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return sendError(
        res,
        400,
        "No valid device fields were supplied.",
        "NO_VALID_UPDATES"
      );
    }

    const device = await Device.findOneAndUpdate(
      {
        _id: req.params.id,
        owner: req.user.id,
      },
      { $set: updates },
      {
        new: true,
        runValidators: true,
      }
    );

    if (!device) {
      return sendError(
        res,
        404,
        "Device not found.",
        "DEVICE_NOT_FOUND"
      );
    }

    return res.status(200).json({
      success: true,
      message: "Device updated successfully.",
      device,
    });
  } catch (err) {
    console.error("Update Device Error:", err);

    return sendError(
      res,
      500,
      "Unable to update device.",
      "DEVICE_UPDATE_FAILED"
    );
  }
};

// ------------------------------------------------------------
// DELETE DEVICE
// ------------------------------------------------------------

export const deleteDevice = async (req, res) => {
  try {
    if (!req.user?.id) {
      return sendError(
        res,
        401,
        "Authentication required.",
        "AUTHENTICATION_REQUIRED"
      );
    }

    const device = await Device.findOneAndDelete({
      _id: req.params.id,
      owner: req.user.id,
    });

    if (!device) {
      return sendError(
        res,
        404,
        "Device not found.",
        "DEVICE_NOT_FOUND"
      );
    }

    return res.status(200).json({
      success: true,
      message: "Device deleted successfully.",
    });
  } catch (err) {
    console.error("Delete Device Error:", err);

    return sendError(
      res,
      500,
      "Unable to delete device.",
      "DEVICE_DELETE_FAILED"
    );
  }
};
