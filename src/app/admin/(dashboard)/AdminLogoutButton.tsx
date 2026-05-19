"use client";

export function AdminLogoutButton() {
  return (
    <form action="/api/platform/auth/logout" method="post">
      <button
        type="submit"
        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Sign out
      </button>
    </form>
  );
}
