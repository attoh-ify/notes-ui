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
    <main
      style={{
        maxWidth: 400,
        margin: "100px auto",
        padding: 20,
        backgroundColor: "white",
        borderRadius: 8,
        boxShadow: "0 0 10px rgba(0,0,0,0.1)",
      }}
    >
      <h1 style={{ textAlign: "center", color: "#2F855A", marginBottom: 20 }}>
        Sign Up
      </h1>

      <form style={{ display: "flex", flexDirection: "column", gap: 15 }} onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{
            padding: 10,
            borderRadius: 4,
            border: "1px solid #CBD5E0",
            fontSize: 16,
            color: "black",
          }}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{
            padding: 10,
            borderRadius: 4,
            border: "1px solid #CBD5E0",
            fontSize: 16,
            color: "black",
          }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: 10,
            backgroundColor: "#2F855A",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: loading ? "not-allowed" : "pointer",
            fontWeight: "bold",
            fontSize: 16,
          }}
        >
          {loading ? "Registering..." : "Sign up"}
        </button>
      </form>

      {error && <p style={{ color: "red", marginTop: 10 }}>{error}</p>}
    </main>
  );
}
