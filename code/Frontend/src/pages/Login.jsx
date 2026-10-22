import { useState } from "react";
import { useNavigate } from "react-router-dom";

const useMock = import.meta.env.VITE_USE_MOCK === "true";

// handles login form
const LoginForm = ({ onSubmit, email, setEmail, password, setPassword }) => (
  <form onSubmit={onSubmit} className="flex flex-col gap-4">
    <input
      type="email"
      placeholder="Email"
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
    <input
      type="password"
      placeholder="Password"
      value={password}
      onChange={(e) => setPassword(e.target.value)}
      className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
    <button
      type="submit"
      className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-white font-medium hover:bg-blue-700"
    >
      Login
    </button>
  </form>
);

// handles login
const Login = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // handles handle login
  const handleLogin = async (e) => {
    e.preventDefault();

    if (useMock) {
      localStorage.removeItem("role");
      localStorage.setItem("user", email || "guest");
      navigate("/dashboard");
      return;
    }

    try {
      const { api } = await import("../api/client");
      const res = await api.login(email, password);
      if (res?.token) localStorage.setItem("token", res.token);
      if (res?.user?.email || email) localStorage.setItem("user", res.user?.email || email);
      localStorage.removeItem("role");
      navigate("/dashboard");
    } catch {
      alert("Login failed");
    }
  };

  return (
    <section className="max-w-md mx-auto my-8 p-6 bg-white rounded-lg shadow">
      <h1 className="text-3xl font-bold mb-6">Login</h1>
      <LoginForm
        onSubmit={handleLogin}
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
      />
    </section>
  );
};

export default Login;
