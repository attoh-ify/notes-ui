"use client";

import { Button, ErrorBanner, FormField, Input } from "@/components/ui";
import { apiFetch } from "@/src/lib/api";
import Link from "next/link";
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
    if (!isValidEmail(cleanEmail)) return setErrorMessage("Please enter a valid email address.");
    const passwordError = getPasswordError(password);
    if (passwordError) return setErrorMessage(passwordError);

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
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <section className="w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-900/10 sm:p-8">
        <div className="mb-8 text-center">
          <Link href="/" className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-xl font-black text-emerald-700">N</Link>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Create account</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Start using Notes</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">Create your workspace and invite collaborators when you are ready.</p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <FormField label="Email address">
            <Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </FormField>
          <FormField label="Password" hint="Use at least 8 characters.">
            <Input type="password" placeholder="Create a password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </FormField>
          <ErrorBanner message={errorMessage} />
          <Button className="w-full" type="submit" disabled={isLoading}>{isLoading ? "Creating account..." : "Create account"}</Button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          Already have an account? <Link href="/login" className="font-black text-emerald-700 hover:text-emerald-800">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
