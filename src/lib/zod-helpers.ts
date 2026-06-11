import { z } from "zod";

/** Optional string fields: null/undefined/""/whitespace become null; non-empty values are trimmed. */
export const optionalTrimmedString = z.preprocess(
  (val) => {
    if (val == null) return null;
    if (typeof val !== "string") return val;
    const trimmed = val.trim();
    return trimmed === "" ? null : trimmed;
  },
  z.string().nullable().optional()
);
