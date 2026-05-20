"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/notes" className="flex items-center gap-2 text-[#2F855A]">
      <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-100 font-black text-emerald-700 shadow-sm shadow-emerald-900/5">
        N
      </span>
      {!compact && <span className="text-lg font-black tracking-tight">Notes</span>}
    </Link>
  );
}

export function PageShell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <main className={cx("mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8", className)}>{children}</main>;
}

export function AppTopbar({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <BrandMark />
        {children && <div className="flex min-w-0 items-center gap-2">{children}</div>}
      </div>
    </header>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5 sm:p-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">{eyebrow}</p>}
        <h1 className="truncate text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-[1.25rem] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5", className)}>{children}</section>;
}

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const variants = {
    primary: "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 disabled:hover:bg-emerald-600",
    secondary: "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
    danger: "border-red-600 bg-red-600 text-white hover:bg-red-700 disabled:hover:bg-red-600",
    ghost: "border-transparent bg-transparent text-slate-600 hover:bg-slate-100",
  };

  return (
    <button
      {...props}
      className={cx(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60",
        variants[variant],
        className,
      )}
    />
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500",
        className,
      )}
    />
  );
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cx(
        "h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500",
        className,
      )}
    />
  );
}

export function FormField({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-bold text-slate-700">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs leading-5 text-slate-500">{hint}</span>}
      {error && <span className="block text-xs font-semibold leading-5 text-red-600">{error}</span>}
    </label>
  );
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "emerald" | "blue" | "purple" | "amber" | "red" | "slate" }) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    blue: "bg-blue-50 text-blue-700 ring-blue-200",
    purple: "bg-purple-50 text-purple-700 ring-purple-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
    red: "bg-red-50 text-red-700 ring-red-200",
    slate: "bg-slate-100 text-slate-600 ring-slate-200",
  };
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-black uppercase tracking-wide ring-1", tones[tone])}>{children}</span>;
}

export function ErrorBanner({ message }: { message?: string | null }) {
  if (!message) return null;
  return <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{message}</div>;
}

export function LoadingState({ title = "Loading", message = "Please wait while we get things ready." }: { title?: string; message?: string }) {
  return (
    <div className="flex min-h-[55vh] items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-[1.5rem] border border-slate-200 bg-white p-6 text-center shadow-sm shadow-slate-900/5">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-emerald-100 border-t-emerald-600" />
        <h2 className="text-lg font-black text-slate-950">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{message}</p>
      </div>
    </div>
  );
}

export function EmptyState({ icon = "📝", title, message, action }: { icon?: ReactNode; title: string; message: string; action?: ReactNode }) {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm shadow-slate-900/5">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-2xl text-emerald-700">{icon}</div>
      <h2 className="text-xl font-black text-slate-950">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{message}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function Modal({ title, eyebrow, children, footer, onClose, widthClass = "max-w-lg" }: { title: string; eyebrow?: string; children: ReactNode; footer?: ReactNode; onClose: () => void; widthClass?: string }) {
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className={cx("flex max-h-[90vh] w-full flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-2xl shadow-slate-950/20", widthClass)}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            {eyebrow && <p className="mb-1 text-xs font-black uppercase tracking-[0.16em] text-emerald-700">{eyebrow}</p>}
            <h2 className="text-lg font-black text-slate-950">{title}</h2>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900" aria-label="Close modal">
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}
