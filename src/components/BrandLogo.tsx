"use client";

import Image from "next/image";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

const DEFAULT_LOGO = "/bike-ops-logo.png";

type BrandLogoProps = {
  className: string;
  width: number;
  height: number;
  priority?: boolean;
  defaultSrc?: string;
};

export type BrandingResponse = {
  logoUrl?: string | null;
  logoAlt?: string | null;
};

const BrandingContext = createContext<BrandingResponse>({});

export function BrandingProvider({
  children,
  initialBranding,
}: {
  children: React.ReactNode;
  initialBranding?: BrandingResponse;
}) {
  const [branding, setBranding] = useState<BrandingResponse>(initialBranding ?? {});

  useEffect(() => {
    let cancelled = false;
    const loadBranding = () => {
      fetch("/api/settings/branding", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: BrandingResponse | null) => {
          if (!cancelled && data) setBranding(data);
        })
        .catch(() => {});
    };

    loadBranding();
    window.addEventListener("bikeops:branding-updated", loadBranding);

    return () => {
      cancelled = true;
      window.removeEventListener("bikeops:branding-updated", loadBranding);
    };
  }, []);

  const value = useMemo(() => branding, [branding]);

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function BrandLogo({ className, width, height, priority, defaultSrc = DEFAULT_LOGO }: BrandLogoProps) {
  const branding = useContext(BrandingContext);
  const src = branding.logoUrl || defaultSrc;
  const isDefaultLogo = src === DEFAULT_LOGO || src === defaultSrc;

  return (
    <Image
      src={src}
      alt={branding.logoAlt || "Bike Ops"}
      width={width}
      height={height}
      className={className}
      priority={priority}
      unoptimized={!isDefaultLogo}
    />
  );
}
