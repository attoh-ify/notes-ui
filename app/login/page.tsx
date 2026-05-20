"use client";

import { Button, ErrorBanner, FormField, Input } from "@/components/ui";
import { useAuth } from "@/src/context/AuthContext";
import { apiFetch } from "@/src/lib/api";
import { LoginResponse } from "@/src/types";
import Link from "next/link";
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data.token }),
      });

      if (!authResponse.ok) throw new Error("Failed to set session cookie");

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
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <section className="w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-900/10 sm:p-8">
        <div className="mb-8 text-center">
          <Link href="/" className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-xl font-black text-emerald-700">N</Link>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Welcome back</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Sign in to Notes</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">Continue writing, reviewing, and collaborating with your team.</p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <FormField label="Email address">
            <Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </FormField>
          <FormField label="Password">
            <Input type="password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </FormField>
          <ErrorBanner message={errorMessage} />
          <Button className="w-full" type="submit" disabled={isLoading}>{isLoading ? "Signing in..." : "Sign in"}</Button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          Don&apos;t have an account? <Link href="/register" className="font-black text-emerald-700 hover:text-emerald-800">Create one</Link>
        </p>
      </section>
    </main>
  );
}
