
import mongoose from "mongoose";

const deviceSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    deviceName: {
      type: String,
      required: true,
      trim: true
    },

    serialNumber: {
      type: String,
      required: true,
      trim: true
    },

    manufacturer: {
      type: String,
      default: ""
    },

    modelNumber: {
      type: String,
      default: ""
    },

    deviceType: {
      type: String,
      default: ""
    },

    storageType: {
      type: String,
      default: "Unknown"
    },

    capacity: {
      type: String,
      default: "N/A"
    },

    location: {
      type: String,
      default: ""
    },

    storagePath: {
      type: String,
      default: ""
    },

    // Dynamically assigned by trusted agent enrollment.
    agentId: {
      type: String,
      default: null,
      index: true
    },

    // Explicitly distinguishes simulated demo devices.
    isDemo: {
      type: Boolean,
      default: false,
      index: true
    },

    files: [
      {
        fileName: String,
        fileSize: String,
        path: String,
        status: {
          type: String,
          default: "Pending"
        }
      }
    ],

    status: {
      type: String,
      enum: [
        "Pending",
        "Wiping",
        "Completed",
        "Failed"
      ],
      default: "Pending"
    },

    currentJobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WipeJob",
      default: null
    },

    lastJobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WipeJob",
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Prevent duplicate serial numbers for the same owner.
deviceSchema.index(
  { owner: 1, serialNumber: 1 },
  { unique: true }
);

export default mongoose.model("Device", deviceSchema);
