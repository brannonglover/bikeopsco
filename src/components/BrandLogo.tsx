"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const DEFAULT_LOGO = "/bike-ops-logo.png";

type BrandLogoProps = {
  className: string;
  width: number;
  height: number;
  priority?: boolean;
  defaultSrc?: string;
};

type BrandingResponse = {
  logoUrl?: string | null;
  logoAlt?: string | null;
};

export function BrandLogo({ className, width, height, priority, defaultSrc = DEFAULT_LOGO }: BrandLogoProps) {
  const [branding, setBranding] = useState<BrandingResponse>({});
  const src = branding.logoUrl || defaultSrc;
  const isDefaultLogo = src === DEFAULT_LOGO || src === defaultSrc;

  useEffect(() => {
    let cancelled = false;
    const loadBranding = () => {
      fetch("/api/settings/branding", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: BrandingResponse | null) => {
          if (!cancelled && data) setBranding(data);
        })
        .catch(() => {
          if (!cancelled) setBranding({});
        });
    };

    loadBranding();
    window.addEventListener("bikeops:branding-updated", loadBranding);

    return () => {
      cancelled = true;
      window.removeEventListener("bikeops:branding-updated", loadBranding);
    };
  }, []);

  return (
    <Image
      src={src}
      alt={branding.logoAlt || "Bike Ops"}
      width={width}
      height={height}
      className={className}
      priority={priority && isDefaultLogo}
      unoptimized={!isDefaultLogo}
    />
  );
}
