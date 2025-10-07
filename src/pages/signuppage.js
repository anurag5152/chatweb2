import React from "react";
import { motion } from "framer-motion";
import { UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Signup() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0D1117] relative overflow-hidden">
      {/* Soft gradient background animation */}
      <motion.div
        className="absolute inset-0 bg-gradient-to-br from-[#0D1117] via-[#161B22] to-[#0D1117]"
        animate={{
          backgroundPosition: ["0% 0%", "100% 100%", "0% 0%"],
        }}
        transition={{
          duration: 25,
          repeat: Infinity,
          ease: "linear",
        }}
        style={{
          backgroundSize: "200% 200%",
          zIndex: 0,
        }}
      ></motion.div>

      <div className="relative z-10 flex flex-col sm:flex-row items-center justify-between w-full max-w-6xl px-6 py-10">
        {/* LEFT SIDE - Intro text */}
        <motion.div
          initial={{ x: -60, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.9, ease: "easeOut" }}
          className="flex-1 text-left space-y-4 sm:pr-10 mb-10 sm:mb-0"
        >
          <div className="flex items-center space-x-1 mb-3">
            <h2 className="text-5xl sm:text-6xl font-extrabold text-[#00FF99] tracking-tight flex items-center">
              <span>Chatbo</span>
              <img
                src="/favicon.ico"
                alt="logo"
                className="w-8 h-18 mx-1 inline-block align-middle"
              />
              <span>t</span>
            </h2>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-[#E6EDF3]">
            Start Conversations That Matter.
          </h1>
          <p className="text-[#8B949E] text-lg leading-relaxed">
            Create your account to join the network — find friends by email, send real-time messages, and collaborate seamlessly in a clean, secure environment.
          </p>
        </motion.div>

        {/* RIGHT SIDE - Signup form */}
        <motion.div
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.9, ease: "easeOut" }}
          className="flex-1 max-w-md bg-[#161B22]/80 backdrop-blur-lg border border-[#238636]/40 rounded-2xl shadow-lg p-8"
        >
          <div className="flex flex-col items-center">
            <UserPlus size={36} className="text-[#00FF99] mb-4" />
            <h1 className="text-2xl font-bold text-[#E6EDF3] text-center">
              Create Your Account
            </h1>
            <p className="mt-2 text-center text-[#8B949E]">
              Join now and get started instantly
            </p>
          </div>

          <form action="/signup" method="post" className="mt-8 space-y-5">
            <div>
              <label className="block text-sm font-medium text-[#E6EDF3]">
                Name
              </label>
              <input
                name="name"
                type="text"
                required
                className="mt-2 w-full rounded-xl border border-[#238636]/40 bg-[#0D1117] px-4 py-2.5 text-[#E6EDF3] placeholder-[#8B949E] focus:outline-none focus:ring-2 focus:ring-[#00FF99]/50 transition"
                placeholder="Your name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#E6EDF3]">
                Email
              </label>
              <input
                name="email"
                type="email"
                required
                className="mt-2 w-full rounded-xl border border-[#238636]/40 bg-[#0D1117] px-4 py-2.5 text-[#E6EDF3] placeholder-[#8B949E] focus:outline-none focus:ring-2 focus:ring-[#00FF99]/50 transition"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#E6EDF3]">
                Password
              </label>
              <input
                name="password"
                type="password"
                required
                className="mt-2 w-full rounded-xl border border-[#238636]/40 bg-[#0D1117] px-4 py-2.5 text-[#E6EDF3] placeholder-[#8B949E] focus:outline-none focus:ring-2 focus:ring-[#00FF99]/50 transition"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              className="w-full inline-flex items-center justify-center rounded-xl bg-[#238636] px-4 py-3 text-[#E6EDF3] font-medium shadow-sm hover:bg-[#00FF99] hover:text-[#0D1117] focus:outline-none focus:ring-2 focus:ring-[#00FF99]/50 focus:ring-offset-2 transition-all duration-300"
            >
              Sign up
            </button>

            {/* Login redirect */}
            <p className="text-center text-sm text-[#8B949E] mt-4">
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="text-[#00FF99] font-medium hover:underline hover:text-[#00FF99]/80 transition-colors duration-300"
              >
                Log in
              </button>
            </p>
          </form>
        </motion.div>
      </div>
    </div>
  );
}
