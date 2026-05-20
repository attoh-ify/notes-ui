import Link from "next/link";
import { ArrowRight, FileText, Globe2, ShieldCheck, Sparkles, Users, Zap } from "lucide-react";
import { BrandMark } from "@/components/ui";

const features = [
  { icon: Zap, title: "Live collaboration", text: "Write with your team in real time without losing review context." },
  { icon: ShieldCheck, title: "Clear permissions", text: "Keep notes private, public, or shared with viewer/editor roles." },
  { icon: FileText, title: "Version-aware notes", text: "Review changes and audit history with a focused writing experience." },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200/80 bg-white/80 backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <BrandMark />
          <div className="flex items-center gap-2">
            <Link href="/login" className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950">
              Sign in
            </Link>
            <Link href="/register" className="hidden rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 sm:inline-flex">
              Get started
            </Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:py-24">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
              <Sparkles size={14} /> Collaborative notes
            </div>
            <h1 className="max-w-4xl text-5xl font-black tracking-tight text-slate-950 sm:text-6xl lg:text-7xl">
              Write together, review clearly, ship cleaner notes.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              Notes gives teams a simple, professional space for real-time writing, permissions, review mode, and audit-friendly collaboration.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/register" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-6 py-3 text-base font-black text-white shadow-lg shadow-emerald-900/15 transition hover:bg-emerald-700">
                Start writing free <ArrowRight size={18} />
              </Link>
              <Link href="/login" className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 py-3 text-base font-black text-slate-700 shadow-sm transition hover:bg-slate-50">
                I already have an account
              </Link>
            </div>
            <div className="mt-10 flex flex-wrap gap-3 text-sm font-bold text-slate-500">
              <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 ring-1 ring-slate-200"><Users size={16} className="text-emerald-600" /> Team access</span>
              <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 ring-1 ring-slate-200"><Globe2 size={16} className="text-emerald-600" /> Public/private notes</span>
              <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 ring-1 ring-slate-200"><ShieldCheck size={16} className="text-emerald-600" /> Review-safe workflow</span>
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-900/10">
            <div className="rounded-[1.5rem] bg-slate-950 p-4 text-white">
              <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-300">Live note</p>
                  <h2 className="mt-1 text-xl font-black">Product roadmap</h2>
                </div>
                <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-black text-emerald-200">3 online</span>
              </div>
              <div className="space-y-3 rounded-2xl bg-white p-4 text-slate-800">
                <div className="h-3 w-2/3 rounded-full bg-slate-200" />
                <div className="h-3 w-full rounded-full bg-slate-100" />
                <div className="h-3 w-5/6 rounded-full bg-slate-100" />
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                  Review suggestion ready for approval
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                  Autosaved and synced
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-4 px-4 pb-16 sm:px-6 lg:grid-cols-3 lg:px-8">
          {features.map((feature) => (
            <div key={feature.title} className="rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm shadow-slate-900/5">
              <feature.icon className="mb-4 h-7 w-7 text-emerald-600" />
              <h3 className="text-lg font-black text-slate-950">{feature.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">{feature.text}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
