import { SettingsSectionNav } from "./settings-section-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 lg:flex-row lg:items-start">
      <SettingsSectionNav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
