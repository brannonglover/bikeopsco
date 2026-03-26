"use client";

import { useEffect, useState } from "react";

/** Matches Tailwind `md` (768px): true when viewport is below `md`. */
export function useIsMobileBoard() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return isMobile;
}
