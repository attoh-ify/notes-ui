"use client";

import { apiFetch } from "@/src/lib/api";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RegisterPage() {
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
      await apiFetch("users/register", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setEmail("");
      setPassword("");
      router.push("/login");
    } catch (err: any) {
      setErrorMessage(err.message || "User registration failed failed");
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
        Sign Up
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
          {isLoading ? "Registering..." : "Sign up"}
        </button>
      </form>

      {errorMessage && (
        <p
          style={{
            color: "#ef4444",
            textAlign: "center",
            fontSize: "0.875rem",
            marginTop: "1rem",
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
        Already have an Account?{" "}
        <a href="/login" style={{ color: "var(--primary)" }}>
          Sign in
        </a>
      </p>
    </main>
  );
}
