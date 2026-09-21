-- Extend private Realtime channel authorization to the staff chat channel.
--
-- Chat previously had no Realtime channel: the staff web app learned about new
-- messages from an SSE endpoint that re-queried the database every few seconds,
-- so a text could sit for seconds after the staff phone had already been pushed
-- the same message. Staff now also subscribe to `shop:<shopId>:chat`, which
-- this policy authorizes.
--
-- Same shape and same guarantees as the jobs channel: the `shop_id` claim comes
-- from a token minted by /api/realtime/token off the server-side NextAuth
-- session, and Realtime evaluates this policy on every private subscription, so
-- a tampered client cannot join another tenant's topic. The allowed topics are
-- an explicit two-item list rather than a prefix match, so a future
-- `shop:<id>:anything` topic has to be added here deliberately.
--
-- SELECT only, deliberately. Broadcasts are published server-side with the
-- service role key (which bypasses RLS), so no client is ever allowed to write
-- to realtime.messages and forge a chat event.

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

-- Supersedes the jobs-only policy from 20260918120000. Dropped by its original
-- name so re-running this migration on a database that already has the new
-- policy is a no-op rather than an error.
DROP POLICY IF EXISTS "bikeops staff read own shop job events" ON realtime.messages;
DROP POLICY IF EXISTS "bikeops staff read own shop events" ON realtime.messages;

CREATE POLICY "bikeops staff read own shop events"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  extension = 'broadcast'
  -- coalesce keeps a token with no shop_id from matching a real topic
  -- (it would have to be literally 'shop::jobs' or 'shop::chat').
  AND realtime.topic() IN (
    'shop:' || coalesce(auth.jwt() ->> 'shop_id', '') || ':jobs',
    'shop:' || coalesce(auth.jwt() ->> 'shop_id', '') || ':chat'
  )
);
