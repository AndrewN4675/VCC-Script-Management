import { Navigate, useLocation } from "react-router-dom";

// handles get stored role
const getStoredRole = () => {
  if (typeof window === "undefined") return "";
  return (localStorage.getItem("role") || "").trim().toLowerCase();
};

// handles has legacy session
const hasLegacySession = () => {
  if (typeof window === "undefined") return false;
  const token = localStorage.getItem("token");
  const user = localStorage.getItem("user");
  return Boolean(token || user);
};

// handles role guard
const RoleGuard = ({ children, requiredRole, redirectTo = "/dashboard", location }) => {
  if (!requiredRole) return children;

  const role = getStoredRole();
  if (role !== String(requiredRole).trim().toLowerCase()) {
    return <Navigate to={redirectTo} replace state={{ from: location }} />;
  }

  return children;
};

// handles require auth legacy
const RequireAuthLegacy = ({ children, requiredRole = null, redirectTo = "/dashboard" }) => {
  const location = useLocation();

  if (!hasLegacySession()) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return (
    <RoleGuard requiredRole={requiredRole} redirectTo={redirectTo} location={location}>
      {children}
    </RoleGuard>
  );
};

// handles require auth
const RequireAuth = ({ children, requiredRole = null, redirectTo = "/dashboard" }) => (
  <RequireAuthLegacy requiredRole={requiredRole} redirectTo={redirectTo}>
    {children}
  </RequireAuthLegacy>
);

export default RequireAuth;
