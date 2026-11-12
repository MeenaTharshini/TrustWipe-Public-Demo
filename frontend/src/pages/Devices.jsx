
import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import "./Devices.css";

import {
  FiMonitor,
  FiHardDrive,
  FiCpu,
  FiRefreshCw,
  FiWifi,
} from "react-icons/fi";

import { Link } from "react-router-dom";

const API_URL =
  import.meta.env.VITE_API_URL ||
  "https://trustwipe-public-demo.onrender.com";

function Devices() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);

  const [search, setSearch] = useState("");

  const [isDemoMode, setIsDemoMode] = useState(
    !localStorage.getItem("token")
  );

  const [authError, setAuthError] = useState(false);

  const [form, setForm] = useState({
    deviceName: "",
    manufacturer: "",
    modelNumber: "",
    serialNumber: "",
    deviceType: "",
    storageType: "",
    capacity: "",
    location: "",
    storagePath: "",
    agentId: "",
  });

  // ---------------------------------
  // AUTHENTICATION
  // ---------------------------------

  const getToken = () => localStorage.getItem("token");

  const handleExpiredToken = () => {
    localStorage.removeItem("token");
    setAuthError(true);
    setIsDemoMode(true);
    setDevices([]);
  };

  // ---------------------------------
  // LOAD PUBLIC DEMO DRIVES
  // ---------------------------------

  const loadDemoDevices = useCallback(async () => {
    try {
      setLoading(true);
      setDiscovering(true);

      const response = await axios.get(
        `${API_URL}/api/devices/discover`
      );

      if (
        response.data?.success &&
        Array.isArray(response.data.devices)
      ) {
        setDevices(response.data.devices);
        setIsDemoMode(true);
        setAuthError(false);
      } else {
        setDevices([]);
      }
    } catch (error) {
      console.error(
        "Demo loading error:",
        error.response?.data || error.message
      );

      setDevices([]);
    } finally {
      setLoading(false);
      setDiscovering(false);
    }
  }, []);

  // ---------------------------------
  // LOAD AUTHENTICATED REAL DEVICES
  // ---------------------------------

  const loadRealDevices = useCallback(async () => {
    const token = getToken();

    if (!token) {
      setIsDemoMode(true);
      await loadDemoDevices();
      return;
    }

    try {
      setLoading(true);

      const response = await axios.get(
        `${API_URL}/api/devices`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const realDevices = Array.isArray(response.data)
        ? response.data
        : response.data?.devices || [];

      // Never display simulated drives as real devices.
      setDevices(
        realDevices.filter(
          (device) =>
            !device.isDemo &&
            !String(device.storagePath || "").startsWith("DEMO://")
        )
      );

      setIsDemoMode(false);
      setAuthError(false);
    } catch (error) {
      console.error(
        "Real device loading error:",
        error.response?.data || error.message
      );

      if (error.response?.status === 401) {
        handleExpiredToken();
        await loadDemoDevices();
      }
    } finally {
      setLoading(false);
    }
  }, [loadDemoDevices]);

  // ---------------------------------
  // INITIAL LOAD
  // ---------------------------------

  useEffect(() => {
    if (getToken()) {
      loadRealDevices();
    } else {
      loadDemoDevices();
    }
  }, [loadRealDevices, loadDemoDevices]);

  // ---------------------------------
  // REFRESH
  // ---------------------------------

  const loadDevices = () => {
    if (getToken() && !authError) {
      loadRealDevices();
    } else {
      loadDemoDevices();
    }
  };

  // ---------------------------------
  // MANUAL REGISTER
  // ---------------------------------

  const registerDevice = async () => {
    if (isDemoMode) {
      alert(
        "Device registration is available only after logging in. Demo drives are simulated."
      );
      return;
    }

    const token = getToken();

    if (!token) {
      handleExpiredToken();
      alert("Please log in to register a real device.");
      return;
    }

    if (!form.deviceName || !form.serialNumber) {
      alert("Please enter at least the device name and serial number.");
      return;
    }

    try {
      await axios.post(
        `${API_URL}/api/devices`,
        form,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      setForm({
        deviceName: "",
        manufacturer: "",
        modelNumber: "",
        serialNumber: "",
        deviceType: "",
        storageType: "",
        capacity: "",
        location: "",
        storagePath: "",
        agentId: "",
      });

      alert("Device registered successfully.");
      loadRealDevices();
    } catch (error) {
      console.error(
        "Registration error:",
        error.response?.data || error.message
      );

      if (error.response?.status === 401) {
        handleExpiredToken();
        alert("Your session expired. Please log in again.");
      } else {
        alert(
          error.response?.data?.message ||
          "Device registration failed."
        );
      }
    }
  };

  // ---------------------------------
  // DELETE DEVICE
  // ---------------------------------

  const deleteDevice = async (id) => {
    if (isDemoMode) {
      alert("Simulated demo drives cannot be deleted.");
      return;
    }

    const token = getToken();

    if (!token) {
      handleExpiredToken();
      alert("Please log in to delete a device.");
      return;
    }

    const confirmed = window.confirm(
      "Are you sure you want to delete this device?"
    );

    if (!confirmed) return;

    try {
      await axios.delete(
        `${API_URL}/api/devices/${id}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      setDevices((previous) =>
        previous.filter((device) => device._id !== id)
      );

      alert("Device deleted successfully.");
    } catch (error) {
      console.error(
        "Delete error:",
        error.response?.data || error.message
      );

      if (error.response?.status === 401) {
        handleExpiredToken();
        alert("Your session expired. Please log in again.");
      } else {
        alert("Failed to delete device.");
      }
    }
  };

  // ---------------------------------
  // PUBLIC DEMO DRIVE DISCOVERY
  // ---------------------------------

  const runDriveDiscovery = async () => {
    try {
      setDiscovering(true);

      const response = await axios.get(
        `${API_URL}/api/devices/discover`
      );

      if (
        response.data?.success &&
        Array.isArray(response.data.devices)
      ) {
        setDevices(response.data.devices);
        setIsDemoMode(true);

        alert("Simulated demo drives loaded successfully.");
      } else {
        alert("No demo drives found.");
      }
    } catch (error) {
      console.error(
        "Discovery error:",
        error.response?.data || error.message
      );

      alert(
        error.response?.data?.message ||
        "Demo drive discovery failed."
      );
    } finally {
      setDiscovering(false);
    }
  };

  // ---------------------------------
  // SEARCH
  // ---------------------------------

  const filtered = devices.filter((device) => {
    const query = search.toLowerCase();

    return (
      device.deviceName?.toLowerCase().includes(query) ||
      device.serialNumber?.toLowerCase().includes(query)
    );
  });

  // ---------------------------------
  // DEVICE ICONS
  // ---------------------------------

  const getDeviceIcon = (type) => {
    switch ((type || "").toLowerCase()) {
      case "desktop":
      case "laptop":
        return <FiMonitor />;

      case "server":
        return <FiCpu />;

      case "external hdd":
      case "usb drive":
      case "hdd":
      case "ssd":
        return <FiHardDrive />;

      default:
        return <FiMonitor />;
    }
  };

  // ---------------------------------
  // UI
  // ---------------------------------

  return (
    <div className="devices">

      {/* HERO */}

      <section className="devices-hero">
        <div className="hero-content">
          <p className="hero-label">ASSET MANAGEMENT</p>

          <h1>Device Command Center</h1>

          <p>
            Real-time inventory + secure wipe readiness system
          </p>

          {isDemoMode && (
            <p className="demo-notice">
              PUBLIC DEMO MODE — Displaying simulated devices only
            </p>
          )}
        </div>

        <div className="hero-card">
          <FiHardDrive size={50} />
          <h2>{devices.length}</h2>
          <span>Total Devices</span>
        </div>
      </section>

      {/* KPI */}

      <section className="kpi">
        <div>
          Total
          <h3>{devices.length}</h3>
        </div>

        <div className="warn">
          Pending
          <h3>
            {devices.filter(
              (device) => device.status === "Pending"
            ).length}
          </h3>
        </div>

        <div className="ok">
          Completed
          <h3>
            {devices.filter(
              (device) => device.status === "Completed"
            ).length}
          </h3>
        </div>

        <div className="info">
          System
          <h3>{isDemoMode ? "DEMO" : "LIVE"}</h3>
        </div>
      </section>

      {/* DISCOVERY */}

      <section className="panel">
        <h2>System Drive Discovery</h2>

        <button
          className="btn"
          onClick={runDriveDiscovery}
          disabled={discovering}
        >
          <FiWifi />

          {discovering
            ? "Loading demo drives..."
            : "Run Drive Discovery"}
        </button>

        <button
          className="btn"
          onClick={loadDevices}
          disabled={loading}
        >
          <FiRefreshCw />

          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </section>

      {/* MANUAL REGISTRATION */}

      {!isDemoMode && (
        <section className="panel">
          <h2>Manual Device Registration</h2>

          <div className="form">

            <input
              placeholder="Device Name"
              value={form.deviceName}
              onChange={(e) =>
                setForm({
                  ...form,
                  deviceName: e.target.value,
                })
              }
            />

            <input
              placeholder="Manufacturer"
              value={form.manufacturer}
              onChange={(e) =>
                setForm({
                  ...form,
                  manufacturer: e.target.value,
                })
              }
            />

            <input
              placeholder="Model Number"
              value={form.modelNumber}
              onChange={(e) =>
                setForm({
                  ...form,
                  modelNumber: e.target.value,
                })
              }
            />

            <input
              placeholder="Serial Number"
              value={form.serialNumber}
              onChange={(e) =>
                setForm({
                  ...form,
                  serialNumber: e.target.value,
                })
              }
            />

            <select
              value={form.deviceType}
              onChange={(e) =>
                setForm({
                  ...form,
                  deviceType: e.target.value,
                })
              }
            >
              <option value="">Device Type</option>
              <option>Laptop</option>
              <option>Desktop</option>
              <option>Server</option>
            </select>

            <select
              value={form.storageType}
              onChange={(e) =>
                setForm({
                  ...form,
                  storageType: e.target.value,
                })
              }
            >
              <option value="">Storage Type</option>
              <option>HDD</option>
              <option>SSD</option>
              <option>NVMe</option>
              <option>USB</option>
            </select>

            <input
              placeholder="Capacity (GB)"
              value={form.capacity}
              onChange={(e) =>
                setForm({
                  ...form,
                  capacity: e.target.value,
                })
              }
            />

            <input
              placeholder="Location"
              value={form.location}
              onChange={(e) =>
                setForm({
                  ...form,
                  location: e.target.value,
                })
              }
            />

            <input
              placeholder="Storage Path"
              value={form.storagePath}
              onChange={(e) =>
                setForm({
                  ...form,
                  storagePath: e.target.value,
                })
              }
            />

          </div>

          <button
            className="btn"
            onClick={registerDevice}
          >
            Register Device
          </button>
        </section>
      )}

      {/* SEARCH */}

      <section className="searchBox">
        <input
          placeholder="Search devices..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </section>

      {/* DEVICE GRID */}

      {loading && devices.length === 0 && (
        <p>Loading devices...</p>
      )}

      {!loading && filtered.length === 0 && (
        <p>No devices found.</p>
      )}

      <section className="grid">

        {filtered.map((device) => {
          const isDemoDevice =
            device.isDemo === true ||
            String(device.storagePath || "").startsWith("DEMO://");

          return (
            <div
              className="device-card"
              key={device._id}
            >

              <div className="device-header">

                <div className="device-avatar">
                  {getDeviceIcon(device.deviceType)}
                </div>

                <div className="device-title">
                  <h3>{device.deviceName}</h3>
                  <p>{device.serialNumber}</p>
                </div>

                <span
                  className={`status-pill ${device.status?.toLowerCase()}`}
                >
                  {device.status}
                </span>

              </div>

              <div className="device-specs">

                <div className="mini-stat">
                  <span>Storage</span>
                  <h4>{device.storageType}</h4>
                </div>

                <div className="mini-stat">
                  <span>Capacity</span>
                  <h4>{device.capacity}</h4>
                </div>

                <div className="mini-stat">
                  <span>Location</span>
                  <h4>{device.location}</h4>
                </div>

                <div className="mini-stat">
                  <span>Status</span>
                  <h4>{device.status}</h4>
                </div>

              </div>

              <div className="device-actions">

                {isDemoDevice ? (
                  <span className="demo-device-label">
                    SIMULATED DEVICE
                  </span>
                ) : (
                  <>
                    {device.status?.toLowerCase() === "pending" && (
                      <Link
                        to={`/dashboard/${device._id}`}
                        className="details-btn"
                      >
                        Go to Wipe
                      </Link>
                    )}

                    {device.status?.toLowerCase() === "completed" && (
                      <Link
                        to={`/dashboard/${device._id}`}
                        className="details-btn"
                      >
                        Go to Verify
                      </Link>
                    )}

                    <button
                      className="delete-btn"
                      onClick={() => deleteDevice(device._id)}
                    >
                      Delete
                    </button>
                  </>
                )}

              </div>

            </div>
          );
        })}

      </section>

    </div>
  );
}

export default Devices;
