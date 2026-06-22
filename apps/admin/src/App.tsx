import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { ToastProvider } from "./context/ToastContext";
import { Toaster } from "./components/Toaster";
import { AuthProvider } from "./components/AuthProvider";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { useAuth } from "./lib/auth";
import { LoginPage } from "./pages/LoginPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { MetricsPage } from "./pages/MetricsPage";
import { ResourcesPage } from "./pages/ResourcesPage";
import { UsersPage } from "./pages/UsersPage";
import { OrganizationsPage } from "./pages/OrganizationsPage";
import { AppsPage } from "./pages/AppsPage";
import { RootAccessPage } from "./pages/RootAccessPage";
import { AuditPage } from "./pages/AuditPage";
import { ErrorsPage } from "./pages/ErrorsPage";
import { DnsPage } from "./pages/DnsPage";
import { ZoneCliPage } from "./pages/ZoneCliPage";
import { SettingsPage } from "./pages/SettingsPage";

function ProtectedLayout() {
  return (
    <ProtectedRoute>
      <Layout />
    </ProtectedRoute>
  );
}

// Guard for the forced password-change screen: requires a signed-in user but —
// unlike ProtectedRoute — does NOT redirect a flagged user away (that would
// loop). Once the flag is cleared, send them on to the panel.
function ChangePasswordRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.mustChangePassword) return <Navigate to="/metrics" replace />;
  return <ChangePasswordPage />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<ChangePasswordRoute />} />
      <Route element={<ProtectedLayout />}>
        <Route index element={<Navigate to="/metrics" replace />} />
        <Route path="/metrics" element={<MetricsPage />} />
        <Route path="/resources" element={<ResourcesPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/organizations" element={<OrganizationsPage />} />
        <Route path="/apps" element={<AppsPage />} />
        <Route path="/root-access" element={<RootAccessPage />} />
        <Route path="/errors" element={<ErrorsPage />} />
        <Route path="/dns" element={<DnsPage />} />
        <Route path="/zone-cli" element={<ZoneCliPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/metrics" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
          <Toaster />
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
