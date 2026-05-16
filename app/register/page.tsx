"use client";

import { apiFetch } from "@/src/lib/api";
import { useRouter } from "next/navigation";
import { useState } from "react";

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function getPasswordError(password: string) {
  if (password.length < 8) return "Password must be at least 8 characters.";
  return null;
}

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsloading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);

    const cleanEmail = email.trim();

    if (!isValidEmail(cleanEmail)) {
      setErrorMessage("Please enter a valid email address.");
      return;
    }

    const passwordError = getPasswordError(password);
    if (passwordError) {
      setErrorMessage(passwordError);
      return;
    }

    setIsloading(true);

    try {
      await apiFetch("users/register", {
        method: "POST",
        body: JSON.stringify({ email: cleanEmail, password }),
      });

      setEmail("");
      setPassword("");
      router.push("/login");
    } catch (err: any) {
      setErrorMessage(err.message || "User registration failed");
    } finally {
      setIsloading(false);
    }
  }

  return (
    <main className="container-center">
      <h1 style={{ textAlign: "center", marginBottom: "1.5rem", fontSize: "1.5rem" }}>
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
          minLength={8}
        />

        <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
          Password must be 8+ characters.
        </p>

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