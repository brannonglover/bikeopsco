import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] gap-10 px-4">
      <div className="text-center space-y-4">
        <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 tracking-tight">
          BikeOps
        </h1>
        <p className="text-slate-600 text-lg max-w-xl mx-auto leading-relaxed">
          Manage your bike repair jobs, track progress, and keep customers informed.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-4">
        <Link
          href="/calendar"
          className="group px-8 py-3.5 bg-indigo-600 text-white rounded-xl font-semibold shadow-soft hover:bg-indigo-700 hover:shadow-soft-lg transition-all duration-200"
        >
          Go to Job Board
          <span className="inline-block ml-2 group-hover:translate-x-0.5 transition-transform">→</span>
        </Link>
        <Link
          href="/jobs/new"
          className="px-8 py-3.5 bg-amber-500 text-white rounded-xl font-semibold shadow-soft hover:bg-amber-600 hover:shadow-soft-lg transition-all duration-200"
        >
          Create Job
        </Link>
      </div>
    </div>
  );
}
