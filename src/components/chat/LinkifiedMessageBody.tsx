"use client";

/**
 * Renders plain text with http(s) URLs as clickable links (opens in new tab).
 */
export function LinkifiedMessageBody({
  text,
  className,
  linkClassName,
}: {
  text: string;
  className?: string;
  linkClassName?: string;
}) {
  const parts = text.split(/(https?:\/\/[^\s<]+)/g);
  return (
    <p className={className}>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className={`underline break-all ${linkClassName ?? ""}`}
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </p>
  );
}
