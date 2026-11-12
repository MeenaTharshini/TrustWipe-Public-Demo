
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";

// =========================================================
// LAYOUT / COMPONENTS
// =========================================================

import Sidebar from "./components/Sidebar";

// =========================================================
// PAGES
// =========================================================

import Dashboard from "./pages/Dashboard";
import Devices from "./pages/Devices";
import Verification from "./pages/Verification";
import Certificates from "./pages/Certificates";
import Reports from "./pages/Reports";
import Forensics from "./pages/Forensics";

import Services from "./pages/Services";
import About from "./pages/About";
import VerifyCertificate from "./pages/VerifyCertificate";

// =========================================================
// GLOBAL APP CSS
// =========================================================

import "./App.css";

// =========================================================
// APPLICATION LAYOUT
// =========================================================

function Layout() {
  const location = useLocation();

  // Routes that should not display the dashboard sidebar
  const publicRoutes = [
    "/",
    "/services",
    "/about",
    "/verify",
    "/verify-certificate",
  ];

  // Certificate verification with an ID is also public
  const isVerifyRoute =
    location.pathname.startsWith("/verify/");

  const hideSidebar =
    publicRoutes.includes(location.pathname) ||
    isVerifyRoute;

  return (
    <div className="app-layout">

      {/* SIDEBAR */}

      {!hideSidebar && <Sidebar />}

      {/* MAIN CONTENT */}

      <main
        className={
          hideSidebar
            ? "auth-content"
            : "main-content"
        }
      >

        <Routes>

          {/* =================================================
              HOME - DIRECT DASHBOARD REDIRECT
              ================================================= */}

          <Route
            path="/"
            element={<Navigate to="/dashboard" replace />}
          />

          {/* =================================================
              PUBLIC INFORMATION PAGES
              ================================================= */}

          <Route
            path="/services"
            element={<Services />}
          />

          <Route
            path="/about"
            element={<About />}
          />

          {/* =================================================
              PUBLIC CERTIFICATE VERIFICATION
              ================================================= */}

          <Route
            path="/verify"
            element={<VerifyCertificate />}
          />

          <Route
            path="/verify/:id"
            element={<VerifyCertificate />}
          />

          <Route
            path="/verify-certificate"
            element={<Navigate to="/verify" replace />}
          />

          {/* =================================================
              PUBLIC DASHBOARD
              ================================================= */}

          <Route
            path="/dashboard"
            element={<Dashboard />}
          />

          <Route
            path="/dashboard/:id"
            element={<Dashboard />}
          />

          {/* =================================================
              PUBLIC DEVICE MANAGEMENT DEMO
              ================================================= */}

          <Route
            path="/devices"
            element={<Devices />}
          />

          {/* =================================================
              PUBLIC WIPE VERIFICATION DEMO
              ================================================= */}

          <Route
            path="/verification"
            element={<Verification />}
          />

          {/* =================================================
              PUBLIC CERTIFICATES
              ================================================= */}

          <Route
            path="/certificates"
            element={<Certificates />}
          />

          {/* =================================================
              PUBLIC REPORTS
              ================================================= */}

          <Route
            path="/reports"
            element={<Reports />}
          />

          {/* =================================================
              PUBLIC FORENSIC OVERVIEW
              ================================================= */}

          <Route
            path="/forensics"
            element={<Forensics />}
          />

          {/* =================================================
              LEGACY WIPE JOB ROUTE
              ================================================= */}

          <Route
            path="/wipe-jobs"
            element={<Navigate to="/dashboard" replace />}
          />

          {/* =================================================
              404 PAGE
              ================================================= */}

          <Route
            path="*"
            element={
              <div className="not-found">
                <h1>404</h1>
                <h2>Page Not Found</h2>

                <p>
                  The page you are looking for
                  does not exist.
                </p>

                <button
                  className="btn btn-primary"
                  onClick={() => {
                    window.location.href = "/dashboard";
                  }}
                >
                  Go to Dashboard
                </button>
              </div>
            }
          />

        </Routes>

      </main>
    </div>
  );
}

// =========================================================
// APP
// =========================================================

function App() {
  return (
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  );
}

export default App;
