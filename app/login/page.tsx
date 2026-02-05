"use client";

import { apiFetch } from "@/src/lib/api";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface LoginResponse {
  userId: string;
  token: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const data = await apiFetch<LoginResponse>("users/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      const authResponse = await fetch("/api/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token: data.token }), // Make sure data.token exists!
      });

      if (!authResponse.ok) {
        throw new Error("Failed to set session cookie");
      }
      
      setEmail("");
      setPassword("");
      router.push(`/notes?email=${encodeURIComponent(email)}&userId=${encodeURIComponent(data.userId)}`);
      router.refresh()
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container-center">
      <h1 style={{ textAlign: "center", marginBottom: "1.5rem", fontSize: "1.5rem" }}>Welcome Back</h1>

      <form className="flex-col-gap" onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <input
          className="input-field"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="input-field"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button
          className="btn-primary"
          type="submit"
          disabled={loading}
        >
          {loading ? "Signing in..." : "Login"}
        </button>
      </form>

      {error && 
        <p style={{ color: "#ef4444", fontSize: "0.875rem", marginTop: "1rem", textAlign: "center" }}>{error}</p>
      }

      <p style={{ marginTop: "1.5rem", textAlign: "center", fontSize: "0.875rem", color: "var(--text-muted)" }}>Don't have an account? <a href="/register" style={{ color: "var(--primary"}}>Sign up</a></p>
    </main>
  );
}
