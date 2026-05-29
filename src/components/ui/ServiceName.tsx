import {
  EBIKE_SERVICE_NAME_BADGE_CLASS,
  splitServiceNameParts,
} from "@/lib/service-name";

export function ServiceName({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const parts = splitServiceNameParts(name);

  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.isEbike ? (
          <span key={i} className={EBIKE_SERVICE_NAME_BADGE_CLASS}>
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </span>
  );
}
