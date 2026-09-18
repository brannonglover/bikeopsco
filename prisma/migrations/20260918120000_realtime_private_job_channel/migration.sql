-- Private Realtime channel authorization for the staff job board.
--
-- Staff browsers subscribe to `shop:<shopId>:jobs` using a short-lived JWT
-- minted by /api/realtime/token, which derives the shop from the server-side
-- NextAuth session and puts it in the `shop_id` claim. This policy is what
-- makes that claim binding: Realtime evaluates it for every private channel
-- subscription, so a tampered client cannot join another tenant's topic.
--
-- SELECT only, deliberately. Broadcasts are published server-side with the
-- service role key (which bypasses RLS), so no client is ever allowed to
-- write to realtime.messages and forge job events.

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bikeops staff read own shop job events" ON realtime.messages;

CREATE POLICY "bikeops staff read own shop job events"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  extension = 'broadcast'
  -- coalesce keeps a token with no shop_id from matching a real topic
  -- (it would have to be literally 'shop::jobs').
  AND realtime.topic() = 'shop:' || coalesce(auth.jwt() ->> 'shop_id', '') || ':jobs'
);
