// src/pages/Login.jsx
import React, { useState } from "react";
import { motion } from "framer-motion";
import { Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { setToken, setUser } from "../utils/auth"; // adjust path if needed

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        // server may return { error: '...' } or { message: '...' }
        setError(data?.error || data?.message || "Login failed");
        setLoading(false);
        return;
      }

      // ensure token present
      if (!data.token) {
        setError("Login failed: no token returned");
        setLoading(false);
        return;
      }

      // store token & optional user (synchronously) BEFORE navigation
      console.log('Token from server:', data.token);
      setToken(data.token);
      if (data.user) setUser(data.user);

      // navigate after storing token - use replace so back button doesn't return to login
      navigate("/chatpage", { replace: true });
    } catch (err) {
      console.error("Login error:", err);
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0D1117] relative overflow-hidden">
      <motion.div
        className="absolute inset-0 bg-gradient-to-br from-[#0D1117] via-[#161B22] to-[#0D1117]"
        animate={{ backgroundPosition: ["0% 0%", "100% 100%", "0% 0%"] }}
        transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
        style={{ backgroundSize: "200% 200%", zIndex: 0 }}
      />
      <div className="relative z-10 flex flex-col sm:flex-row items-center justify-between w-full max-w-6xl px-6 py-10">
        <motion.div
          initial={{ x: -60, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.9, ease: "easeOut" }}
          className="flex-1 text-left space-y-4 sm:pr-10 mb-10 sm:mb-0"
        >
          <div className="flex items-center space-x-1 mb-3">
            <h2 className="text-5xl sm:text-6xl font-extrabold text-[#00FF99] tracking-tight flex items-center">
              <span>Chatbo</span>
              <img src="/favicon.ico" alt="logo" className="w-8 h-18 mx-1 inline-block align-middle" />
              <span>t</span>
            </h2>
          </div>

          <h1 className="text-4xl sm:text-5xl font-bold text-[#E6EDF3]">Connect. Chat. Collaborate.</h1>
          <p className="text-[#8B949E] text-lg leading-relaxed">
            A modern, real-time messaging platform built for seamless conversations. Find friends by email, send requests instantly,
            and chat live with a smooth, secure, and lightning-fast experience.
          </p>
        </motion.div>

        <motion.div
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.9, ease: "easeOut" }}
          className="flex-1 max-w-md bg-[#161B22]/80 backdrop-blur-lg border border-[#238636]/40 rounded-2xl shadow-lg p-8"
        >
          <div className="flex flex-col items-center">
            <Lock size={36} className="text-[#00FF99] mb-4" />
            <h1 className="text-2xl font-bold text-[#E6EDF3] text-center">Welcome Back</h1>
            <p className="mt-2 text-center text-[#8B949E]">Log in to continue your conversations</p>
          </div>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5" autoComplete="off">
            <div>
              <label className="block text-sm font-medium text-[#E6EDF3]">Email</label>
              <input
                name="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-2 w-full rounded-xl border border-[#238636]/40 bg-[#0D1117] px-4 py-2.5 text-[#E6EDF3] placeholder-[#8B949E] focus:outline-none focus:ring-2 focus:ring-[#00FF99]/50 transition"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#E6EDF3]">Password</label>
              <input
                name="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-2 w-full rounded-xl border border-[#238636]/40 bg-[#0D1117] px-4 py-2.5 text-[#E6EDF3] placeholder-[#8B949E] focus:outline-none focus:ring-2 focus:ring-[#00FF99]/50 transition"
                placeholder="••••••••"
              />
            </div>

            {error && <div className="text-center text-sm text-red-400">{error}</div>}

            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center rounded-xl bg-[#238636] px-4 py-3 text-[#E6EDF3] font-medium shadow-sm hover:bg-[#00FF99] hover:text-[#0D1117] focus:outline-none focus:ring-2 focus:ring-[#00FF99]/50 focus:ring-offset-2 transition-all duration-300 disabled:opacity-60"
            >
              {loading ? "Logging in..." : "Log in"}
            </button>

            <p className="text-center text-sm text-[#8B949E] mt-4">
              Don’t have an account?{" "}
              <a href="/signup" className="text-[#00FF99] font-medium hover:underline hover:text-[#00FF99]/80 transition-colors duration-300">
                Sign up
              </a>
            </p>
          </form>
        </motion.div>
      </div>
    </div>
  );
}
