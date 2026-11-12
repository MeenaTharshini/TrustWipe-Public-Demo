
/**
 * TrustWipe Public Demo Controller
 *
 * Returns simulated drives only.
 * Does not connect to physical agents.
 * Does not discover physical drives.
 * Does not save demo devices to MongoDB.
 */

export const discoverDemoDrives = async (req, res) => {
  try {
    const demoDevices = [
      {
        _id: "demo-drive-001",
        deviceName: "Demo USB Drive",
        serialNumber: "TW-DEMO-USB-001",
        manufacturer: "TrustWipe Simulation",
        modelNumber: "DEMO-USB",
        deviceType: "Removable Drive",
        storageType: "USB",
        capacity: "32 GB",
        location: "Demo Environment",
        storagePath: "DEMO://USB-001",
        agentId: "DEMO-AGENT",
        isDemo: true,
        status: "Pending",
        files: [
          {
            fileName: "sample-document.pdf",
            fileSize: "2 MB",
            path: "DEMO://USB-001/sample-document.pdf",
            status: "Pending"
          },
          {
            fileName: "sample-image.jpg",
            fileSize: "5 MB",
            path: "DEMO://USB-001/sample-image.jpg",
            status: "Pending"
          }
        ]
      },

      {
        _id: "demo-drive-002",
        deviceName: "Demo External HDD",
        serialNumber: "TW-DEMO-HDD-002",
        manufacturer: "TrustWipe Simulation",
        modelNumber: "DEMO-HDD",
        deviceType: "External Hard Drive",
        storageType: "HDD",
        capacity: "1 TB",
        location: "Demo Environment",
        storagePath: "DEMO://HDD-002",
        agentId: "DEMO-AGENT",
        isDemo: true,
        status: "Pending",
        files: [
          {
            fileName: "backup.zip",
            fileSize: "250 MB",
            path: "DEMO://HDD-002/backup.zip",
            status: "Pending"
          }
        ]
      },

      {
        _id: "demo-drive-003",
        deviceName: "Demo SSD",
        serialNumber: "TW-DEMO-SSD-003",
        manufacturer: "TrustWipe Simulation",
        modelNumber: "DEMO-SSD",
        deviceType: "Solid State Drive",
        storageType: "SSD",
        capacity: "512 GB",
        location: "Demo Environment",
        storagePath: "DEMO://SSD-003",
        agentId: "DEMO-AGENT",
        isDemo: true,
        status: "Pending",
        files: [
          {
            fileName: "project-files.zip",
            fileSize: "120 MB",
            path: "DEMO://SSD-003/project-files.zip",
            status: "Pending"
          }
        ]
      }
    ];

    return res.status(200).json({
      success: true,
      demo: true,
      count: demoDevices.length,
      devices: demoDevices,
      message: "Simulated demo drives loaded successfully."
    });

  } catch (error) {
    console.error("DEMO DISCOVERY ERROR:", error);

    return res.status(500).json({
      success: false,
      demo: true,
      message: "Unable to load simulated demo drives."
    });
  }
};
