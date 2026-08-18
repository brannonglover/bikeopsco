-- Drop marketing-site chat (bikeops.co widget + Quo SMS relay).
DROP TABLE IF EXISTS "SiteChatMessage";
DROP TABLE IF EXISTS "SiteChatConversation";
DROP TYPE IF EXISTS "SiteChatSender";
DROP TYPE IF EXISTS "SiteChatMessageSource";
