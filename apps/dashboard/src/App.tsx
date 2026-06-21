import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { ToastProvider } from "./context/ToastContext";
import { AuthProvider } from "./lib/auth";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Layout } from "./components/Layout";
import { Toaster } from "./components/Toaster";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { ImpersonatePage } from "./pages/ImpersonatePage";
import { AppsPage } from "./pages/AppsPage";
import { AppDetailPage } from "./pages/AppDetailPage";
import { ErrorsPage } from "./pages/ErrorsPage";
import { ErrorDetailPage } from "./pages/ErrorDetailPage";
import { AccountPage } from "./pages/AccountPage";

// The New App flow now lives in a modal on the Apps page. /apps/new is kept
// only so the GitHub OAuth callback (which redirects there with
// ?github=connected) lands somewhere — forward to /apps so the modal reopens,
// preserving the github param.
function NewAppRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set("new", "1");
  return <Navigate to={`/apps?${params.toString()}`} replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/impersonate" element={<ImpersonatePage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/apps" replace />} />
        <Route path="apps" element={<AppsPage />} />
        <Route path="apps/new" element={<NewAppRedirect />} />
        <Route path="apps/:id" element={<AppDetailPage />} />
        <Route path="errors" element={<ErrorsPage />} />
        <Route path="notifications/:id" element={<ErrorDetailPage />} />
        <Route path="account" element={<AccountPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
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
            <Toaster />
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
