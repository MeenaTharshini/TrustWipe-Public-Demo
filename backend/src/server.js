
// backend/src/server.js

import express from "express";
import cors from "cors";
import http from "http";
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

// ------------------------------------------------------------
// PATH CONFIGURATION
// ------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load backend/.env before reading environment variables.
dotenv.config({
  path: path.join(__dirname, "../.env"),
});

// ------------------------------------------------------------
// ROUTES
// ------------------------------------------------------------

import authRoutes from "./routes/authRoutes.js";
import deviceRoutes from "./routes/deviceRoutes.js";
import wipeRoutes from "./routes/wipeRoutes.js";
import verificationRoutes from "./routes/verificationRoutes.js";
import certificateRoutes from "./routes/certificateRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import forensicRoutes from "./routes/forensic.js";

// ------------------------------------------------------------
// SOCKET
// ------------------------------------------------------------

import * as agentBridge from "./socket/agentBridge.js";
import { initAgentClient } from "./socket/index.js";

// ------------------------------------------------------------
// APPLICATION
// ------------------------------------------------------------

const app = express();
const server = http.createServer(app);

// ------------------------------------------------------------
// CORS CONFIGURATION
// ------------------------------------------------------------

// Supports comma-separated values in FRONTEND_URL,
// FRONTEND_ORIGIN, and FRONTEND_URLS.
//
// Example:
// FRONTEND_URL=https://trust-wipe-public-demo.vercel.app
// FRONTEND_ORIGIN=http://localhost:5173

const configuredOrigins = [
  process.env.FRONTEND_URL,
  process.env.FRONTEND_ORIGIN,
  process.env.FRONTEND_URLS,
]
  .filter(Boolean)
  .flatMap((value) => value.split(","))
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

// Local development and deployed frontend origins.
const defaultOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://trust-wipe-public-demo.vercel.app",
];

const allowedOrigins = [
  ...new Set([
    ...defaultOrigins,
    ...configuredOrigins,
  ]),
];

console.log("🌐 Allowed frontend origins:", allowedOrigins);

const corsOptions = {
  origin(origin, callback) {
    // Allow requests without Origin, such as curl and server-to-server.
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.warn(`⚠️ CORS blocked origin: ${origin}`);

    return callback(new Error("Origin not allowed by CORS"));
  },

  credentials: true,

  methods: [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
  ],

  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept",
    "X-Forensic-Api-Key",
    "X-Requested-With",
  ],

  optionsSuccessStatus: 204,
};

// CORS must be registered before routes and authentication middleware.
app.use(cors(corsOptions));

// Explicitly handle browser preflight requests.
app.options(/.*/, cors(corsOptions));

// ------------------------------------------------------------
// BODY PARSING
// ------------------------------------------------------------

app.use(
  express.json({
    limit: "10mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb",
  })
);

// ------------------------------------------------------------
// REQUEST LOGGING
// ------------------------------------------------------------

if (process.env.NODE_ENV !== "production") {
  app.use((req, res, next) => {
    console.log(`[API] ${req.method} ${req.originalUrl}`);
    next();
  });
}

// ------------------------------------------------------------
// SOCKET.IO / TRUSTWIPE AGENT
// ------------------------------------------------------------

initAgentClient(server);

// Make the agent bridge available to forensic routes.
app.set("agentBridge", agentBridge);

console.log(
  "🔌 Agent Bridge:",
  typeof agentBridge.sendForensicTask === "function"
    ? "READY"
    : "UNAVAILABLE"
);

// ------------------------------------------------------------
// API ROUTES
// ------------------------------------------------------------

app.use("/api/auth", authRoutes);

app.use("/api/devices", deviceRoutes);

app.use("/api/wipe", wipeRoutes);

app.use("/api/verification", verificationRoutes);

app.use("/api/certificate", certificateRoutes);

app.use("/api/reports", reportRoutes);

// ------------------------------------------------------------
// FORENSICS
// ------------------------------------------------------------

app.use("/api/forensic", forensicRoutes);

// ------------------------------------------------------------
// DOWNLOADS
// ------------------------------------------------------------

const downloadsDirectory = path.join(
  __dirname,
  "../downloads"
);

app.use(
  "/downloads",
  express.static(downloadsDirectory)
);

// ------------------------------------------------------------
// HEALTH CHECK
// ------------------------------------------------------------

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    success: true,
    status: "OK",
    application: "TrustWipe Enterprise API",
    version: "1.0.0",
    forensic: true,
  });
});

// ------------------------------------------------------------
// FORENSIC HEALTH
// ------------------------------------------------------------

app.get("/api/forensic-health", (_req, res) => {
  res.status(200).json({
    success: true,
    service: "TrustWipe Digital Forensics",
    mounted: true,
    endpoint: "/api/forensic",
  });
});

// ------------------------------------------------------------
// ROOT
// ------------------------------------------------------------

app.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    application: "TrustWipe Enterprise API",
    version: "1.0.0",
    services: {
      api: true,
      forensic: true,
      socket: true,
    },
  });
});

// ------------------------------------------------------------
// 404 HANDLER
// ------------------------------------------------------------

app.use((req, res) => {
  console.warn(
    `⚠️ 404 NOT FOUND: ${req.method} ${req.originalUrl}`
  );

  res.status(404).json({
    success: false,
    code: "ROUTE_NOT_FOUND",
    message: "Route not found",
    path: req.originalUrl,
  });
});

// ------------------------------------------------------------
// GLOBAL ERROR HANDLER
// ------------------------------------------------------------

app.use((err, req, res, next) => {
  console.error("❌ SERVER ERROR:", err.message || err);

  if (res.headersSent) {
    return next(err);
  }

  // CORS rejection is not an application route failure.
  if (err.message === "Origin not allowed by CORS") {
    return res.status(403).json({
      success: false,
      code: "CORS_ORIGIN_DENIED",
      message: "This frontend origin is not allowed.",
    });
  }

  res.status(err.status || 500).json({
    success: false,
    message:
      process.env.NODE_ENV === "production"
        ? "Internal Server Error"
        : err.message || "Internal Server Error",
  });
});

// ------------------------------------------------------------
// DATABASE + SERVER START
// ------------------------------------------------------------

const PORT = Number(process.env.PORT) || 5000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ MONGO_URI is not configured.");
  process.exit(1);
}

async function startServer() {
  try {
    await mongoose.connect(MONGO_URI);

    console.log("✅ MongoDB Connected");

    server.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 TrustWipe Server Running on port ${PORT}`);
      console.log(`🔗 Health: http://localhost:${PORT}/api/health`);
      console.log(
        `🔬 Forensics: http://localhost:${PORT}/api/forensic/test`
      );
      console.log(
        `🛡️ Forensic Health: http://localhost:${PORT}/api/forensic-health`
      );
    });
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err.message);
    process.exit(1);
  }
}

startServer();
