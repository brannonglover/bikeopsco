import { SettingsSectionNav } from "./settings-section-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-6 lg:flex-row lg:items-start">
      <SettingsSectionNav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
