-- ============================================================================
-- Split job bikes that share one customer profile bike.
--
-- Two bikes on ONE job pointing at the SAME "Bike" row is the bug: editing that
-- row propagates make/model/nickname to every job bike linked to it, so all of
-- them take on one model. This gives each extra bike its own profile row.
--
-- NOTE: this cannot recover models or nicknames the fan-out already overwrote --
-- those values are gone. After this runs the bikes are independent, so
-- re-entering the correct model and nickname per bike will stick.
--
-- Run STEP 1 first and SAVE ITS OUTPUT -- it is your rollback record.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- STEP 1 -- PREVIEW. Read-only. Save this output before running step 2.
-- ---------------------------------------------------------------------------
WITH shared AS (
  SELECT jb.id AS job_bike_id,
         jb."jobId",
         jb."bikeId" AS original_bike_id,
         ROW_NUMBER() OVER (
           PARTITION BY jb."jobId", jb."bikeId"
           ORDER BY jb."sortOrder", jb."createdAt"
         ) AS rn
  FROM "JobBike" jb
  WHERE jb."bikeId" IS NOT NULL
    AND (jb."jobId", jb."bikeId") IN (
      SELECT "jobId", "bikeId"
      FROM "JobBike"
      WHERE "bikeId" IS NOT NULL
      GROUP BY "jobId", "bikeId"
      HAVING COUNT(*) > 1
    )
)
SELECT s.job_bike_id,
       s."jobId",
       j.stage,
       jb.make,
       jb.model,
       jb.nickname,
       s.original_bike_id,
       CASE WHEN s.rn = 1 THEN 'keep on existing profile bike'
            ELSE 'move to new profile bike ' || 'cbk_' || substr(md5(s.job_bike_id), 1, 24)
       END AS action
FROM shared s
JOIN "JobBike" jb ON jb.id = s.job_bike_id
JOIN "Job"     j  ON j.id  = s."jobId"
ORDER BY s."jobId", s.rn;


-- ---------------------------------------------------------------------------
-- STEP 2 -- APPLY. Run the whole block; it commits or rolls back as one unit.
-- ---------------------------------------------------------------------------
BEGIN;

-- 2a. Create one new profile bike per job bike that needs its own.
--     The id is derived from the job bike id, so 2b can find it without a
--     round trip and re-running this block is a no-op.
INSERT INTO "Bike" (
  id, "shopId", "customerId", make, model, year, "bikeType",
  nickname, "imageUrl", "createdAt", "updatedAt"
)
SELECT 'cbk_' || substr(md5(jb.id), 1, 24),
       jb."shopId",
       j."customerId",
       -- Prefer this bike's own snapshot, fall back to the row it was sharing.
       COALESCE(NULLIF(btrim(jb.make), ''), b.make),
       COALESCE(NULLIF(btrim(jb.model), ''), b.model),
       COALESCE(jb.year, b.year),
       COALESCE(jb."bikeType", b."bikeType"),
       NULLIF(btrim(jb.nickname), ''),
       COALESCE(NULLIF(btrim(jb."imageUrl"), ''), b."imageUrl"),
       NOW(),
       NOW()
FROM (
  SELECT jb2.id,
         ROW_NUMBER() OVER (
           PARTITION BY jb2."jobId", jb2."bikeId"
           ORDER BY jb2."sortOrder", jb2."createdAt"
         ) AS rn
  FROM "JobBike" jb2
  WHERE jb2."bikeId" IS NOT NULL
    AND (jb2."jobId", jb2."bikeId") IN (
      SELECT "jobId", "bikeId" FROM "JobBike" WHERE "bikeId" IS NOT NULL
      GROUP BY "jobId", "bikeId" HAVING COUNT(*) > 1
    )
) ranked
JOIN "JobBike" jb ON jb.id = ranked.id
JOIN "Job"     j  ON j.id  = jb."jobId"
JOIN "Bike"    b  ON b.id  = jb."bikeId"
WHERE ranked.rn > 1
  AND j."customerId" IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- 2b. Point each of those job bikes at its own new profile bike.
UPDATE "JobBike" jb
SET "bikeId" = 'cbk_' || substr(md5(jb.id), 1, 24)
FROM (
  SELECT jb2.id,
         ROW_NUMBER() OVER (
           PARTITION BY jb2."jobId", jb2."bikeId"
           ORDER BY jb2."sortOrder", jb2."createdAt"
         ) AS rn
  FROM "JobBike" jb2
  WHERE jb2."bikeId" IS NOT NULL
    AND (jb2."jobId", jb2."bikeId") IN (
      SELECT "jobId", "bikeId" FROM "JobBike" WHERE "bikeId" IS NOT NULL
      GROUP BY "jobId", "bikeId" HAVING COUNT(*) > 1
    )
) ranked
JOIN "Job" j ON j.id = (SELECT "jobId" FROM "JobBike" WHERE id = ranked.id)
WHERE jb.id = ranked.id
  AND ranked.rn > 1
  AND j."customerId" IS NOT NULL;

COMMIT;


-- ---------------------------------------------------------------------------
-- STEP 3 -- VERIFY. Expect 0.
-- ---------------------------------------------------------------------------
SELECT COALESCE(SUM(extra), 0) AS job_bikes_still_sharing
FROM (
  SELECT COUNT(*) - 1 AS extra
  FROM "JobBike"
  WHERE "bikeId" IS NOT NULL
  GROUP BY "jobId", "bikeId"
  HAVING COUNT(*) > 1
) x;
