"use client";

import { useAuth } from "@/src/context/AuthContext";
import { apiFetch } from "@/src/lib/api";
import { LoginResponse } from "@/src/types";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const { setUser } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsloading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setIsloading(true);

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
        body: JSON.stringify({ token: data.token }),
      });

      if (!authResponse.ok) {
        throw new Error("Failed to set session cookie");
      }

      setUser({ userId: data.userId, email });
      setEmail("");
      setPassword("");
      router.push("/notes");
      router.refresh();
    } catch (err: any) {
      setErrorMessage(err.message || "Login failed");
    } finally {
      setIsloading(false);
    }
  }

  return (
    <main className="container-center">
      <h1
        style={{
          textAlign: "center",
          marginBottom: "1.5rem",
          fontSize: "1.5rem",
        }}
      >
        Welcome Back
      </h1>

      <form
        className="flex-col-gap"
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
      >
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
        <button className="btn-primary" type="submit" disabled={isLoading}>
          {isLoading ? "Signing in..." : "Login"}
        </button>
      </form>

      {errorMessage && (
        <p
          style={{
            color: "#ef4444",
            fontSize: "0.875rem",
            marginTop: "1rem",
            textAlign: "center",
          }}
        >
          {errorMessage}
        </p>
      )}

      <p
        style={{
          marginTop: "1.5rem",
          textAlign: "center",
          fontSize: "0.875rem",
          color: "var(--text-muted)",
        }}
      >
        Don't have an account?{" "}
        <a href="/register" style={{ color: "var(--primary" }}>
          Sign up
        </a>
      </p>
    </main>
  );
}
