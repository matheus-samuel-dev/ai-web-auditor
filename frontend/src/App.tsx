import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { PageSkeleton } from "./components/PageSkeleton";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AuthProvider } from "./context/AuthContext";
import { AppShell } from "./layout/AppShell";

const DashboardPage = lazy(async () => import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const NewAuditPage = lazy(async () => import("./pages/NewAuditPage").then((module) => ({ default: module.NewAuditPage })));
const ProjectsPage = lazy(async () => import("./pages/ProjectsPage").then((module) => ({ default: module.ProjectsPage })));
const AuditHistoryPage = lazy(async () => import("./pages/AuditHistoryPage").then((module) => ({ default: module.AuditHistoryPage })));
const AuditReportPage = lazy(async () => import("./pages/AuditReportPage").then((module) => ({ default: module.AuditReportPage })));
const SettingsPage = lazy(async () => import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const LoginPage = lazy(async () => import("./pages/LoginPage").then((module) => ({ default: module.LoginPage })));
const RegisterPage = lazy(async () => import("./pages/RegisterPage").then((module) => ({ default: module.RegisterPage })));

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<PageSkeleton message="Carregando módulo da aplicação..." />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            <Route element={<ProtectedRoute />}>
              <Route element={<AppShell />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/audits/new" element={<NewAuditPage />} />
                <Route path="/audits/history" element={<AuditHistoryPage />} />
                <Route path="/audits/:auditId" element={<AuditReportPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}
