"use client";

import { apiFetch } from "@/src/lib/api";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RegisterPage() {
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
      await apiFetch("users/register", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setEmail("");
      setPassword("");
      router.push("/login");
    } catch (err: any) {
      setError(err.message || "User registration failed failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container-center">
      <h1 style={{ textAlign: "center", marginBottom: "1.5rem", fontSize: "1.5rem" }}>Sign Up</h1>

      <form className="flex-col-gap" onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem"}}>
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
          {loading ? "Registering..." : "Sign up"}
        </button>
      </form>

      {error &&
        <p style={{ color: "#ef4444", textAlign: "center", fontSize: "0.875rem", marginTop: "1rem" }}>{error}</p>
      }

      <p style={{ marginTop: "1.5rem", textAlign: "center", fontSize: "0.875rem", color: "var(--text-muted)" }}>Already have an Account? <a href="/login"style={{ color: "var(--primary)"}}>Sign in</a></p>
    </main>
  );
}
