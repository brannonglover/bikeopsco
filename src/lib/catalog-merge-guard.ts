import { NextResponse } from "next/server";
import { catalogPrisma } from "../../bike-catalog/lib/db";

/**
 * Admin edits to soft-merged catalog rows. A merged row is kept only so its
 * links and a revert keep working, so it isn't edited, verified or deleted on
 * its own — that would make it drift from the row that now covers its years.
 * A survivor can't be deleted while rows are merged into it.
 */
export async function catalogMergeConflict(
  id: string,
  action: "edit" | "verify" | "delete"
): Promise<NextResponse | null> {
  const row = await catalogPrisma.catalogBike.findUnique({
    where: { id },
    select: { mergedIntoId: true, _count: { select: { mergedRows: true } } },
  });
  if (!row) return null;
  if (row.mergedIntoId) {
    return NextResponse.json(
      {
        error: `This build sheet was merged into another row; ${action === "delete" ? "revert the merge to remove it" : "make the change there instead"}.`,
        mergedIntoId: row.mergedIntoId,
      },
      { status: 409 }
    );
  }
  if (action === "delete" && row._count.mergedRows > 0) {
    return NextResponse.json(
      { error: `${row._count.mergedRows} other row(s) were merged into this one. Revert that merge before deleting it.` },
      { status: 409 }
    );
  }
  return null;
}
