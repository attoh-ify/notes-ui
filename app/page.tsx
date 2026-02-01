import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-white font-sans text-zinc-900">
      <nav className="flex items-center justify-between px-6 py-6 md:px-12">
        <div className="text-xl font-bold tracking-tighter text-[#2F855A]">NOTES</div>
        <Link href="/login" className="text-sm font-medium text-zinc-500 hover:text-zinc-900">
          Sign in
        </Link>
      </nav>

      <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <h1 className="text-5xl font-extrabold tracking-tight sm:text-6xl">
          Write together, <br />
          <span className="text-[#2F855A]">in real-time.</span>
        </h1>
        
        <p className="mt-6 max-w-lg text-lg text-zinc-500">
          A simple, secure space for live collaboration. 
          Share notes with Viewers, Editors, or Supers instantly.
        </p>

        <div className="mt-10">
          <Link
            href="/register"
            className="rounded-full bg-[#2F855A] px-10 py-4 text-lg font-bold text-white transition-all hover:opacity-90"
          >
            Start writing free
          </Link>
        </div>

        <div className="mt-20 flex flex-wrap justify-center gap-8 text-sm font-medium text-zinc-400">
          <span className="flex items-center gap-2">⚡ Live Sync</span>
          <span className="flex items-center gap-2">🛡️ Granular Roles</span>
          <span className="flex items-center gap-2">🌐 Public/Private</span>
        </div>
      </main>

      <footer className="py-8 text-center text-xs text-zinc-300">
        &copy; 2026 Notes
      </footer>
    </div>
  );
}