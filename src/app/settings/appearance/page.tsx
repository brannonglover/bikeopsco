"use client";

import { useTheme, type ThemeMode } from "@/contexts/ThemeContext";

const THEME_OPTIONS: { value: ThemeMode; label: string; description: string }[] = [
  { value: "light", label: "Light", description: "Always use the light colour scheme" },
  { value: "dark", label: "Dark", description: "Always use the dark colour scheme" },
  { value: "system", label: "System", description: "Follow your device settings" },
];

function ThemeIcon({ mode, active }: { mode: ThemeMode; active: boolean }) {
  const base = active ? "text-primary-500" : "text-text-secondary";

  if (mode === "light") {
    return (
      <svg className={`h-6 w-6 ${base}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
        />
      </svg>
    );
  }

  if (mode === "dark") {
    return (
      <svg className={`h-6 w-6 ${base}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
        />
      </svg>
    );
  }

  return (
    <svg className={`h-6 w-6 ${base}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    </svg>
  );
}

export default function AppearanceSettingsPage() {
  const { themeMode, setThemeMode } = useTheme();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Appearance</h1>
        <p className="mt-1 text-text-secondary">Customise how Bike Ops looks on your device.</p>
      </div>

      <section className="rounded-xl border border-surface-border bg-surface p-4">
        <div className="space-y-3">
          {THEME_OPTIONS.map((opt) => {
            const selected = themeMode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setThemeMode(opt.value)}
                className={`flex w-full items-center gap-4 rounded-xl border px-4 py-4 text-left transition-all ${
                  selected
                    ? "border-primary-500 bg-primary-500/10 ring-2 ring-primary-500/20"
                    : "border-surface-border bg-background hover:border-text-muted"
                }`}
              >
                <div
                  className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
                    selected ? "bg-primary-500/15" : "bg-subtle-bg"
                  }`}
                >
                  <ThemeIcon mode={opt.value} active={selected} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-foreground">{opt.label}</div>
                  <div className="text-sm text-text-secondary">{opt.description}</div>
                </div>
                <div
                  className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                    selected ? "border-primary-500 bg-primary-500" : "border-text-muted bg-transparent"
                  }`}
                >
                  {selected && (
                    <svg className="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 12 12">
                      <path d="M10.28 2.28a.75.75 0 00-1.06-1.06L4.5 5.94 2.78 4.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l5.25-5.25z" />
                    </svg>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
