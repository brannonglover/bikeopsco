#!/usr/bin/env bash
# Apply schema + seed demo data on the BikeOps develop Supabase project.
# Never run against production DATABASE_URL values.
#
# Usage:
#   DATABASE_URL="postgresql://postgres.[develop-ref]:..." \
#   DIRECT_URL="postgresql://postgres.[develop-ref]:..." \
#   ADMIN_EMAIL="you@example.com" \
#   ADMIN_PASSWORD="your-staging-password" \
#   ./scripts/setup-staging-db.sh
#
# See docs/staging-environment.md and DEPLOYMENT.md.

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" || -z "${DIRECT_URL:-}" ]]; then
  echo "Error: DATABASE_URL and DIRECT_URL must be set to your develop Supabase pooler URLs." >&2
  exit 1
fi

if [[ -n "${PRODUCTION_SUPABASE_PROJECT_REF:-}" ]]; then
  node - <<'NODE'
const { diagnosePair } = require("./scripts/db-url-diagnostics");
const ref = diagnosePair(process.env.DATABASE_URL, process.env.DIRECT_URL).database?.projectRef;
if (ref && ref === process.env.PRODUCTION_SUPABASE_PROJECT_REF) {
  console.error(
    `Error: DATABASE_URL uses production Supabase ref ${ref}. Use the BikeOps develop project instead.`
  );
  process.exit(1);
}
NODE
fi

echo "→ Validating staging DATABASE_URL / DIRECT_URL structure…"
npm run db:validate-env

echo "→ Applying schema (prisma migrate deploy)…"
npm run db:migrate

echo "→ Seeding staging demo data…"
npm run db:seed:staging

echo ""
echo "Done. Next steps:"
echo "  1. vercel env add DATABASE_URL preview develop   # paste develop Transaction URL (6543)"
echo "  2. vercel env add DIRECT_URL preview develop     # paste develop Session URL (5432)"
echo "  3. Redeploy develop (push commit or Vercel → Redeploy)"
echo "  4. Verify: curl -sL https://dev.bikeops.co/api/debug/env | jq .databaseUrlHostHint"
