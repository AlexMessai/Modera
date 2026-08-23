-- Filters ("Фильтры") now covers all 12 restrictable content types
-- individually (see global-moderation-service.ts's MEDIA_FILTER_TYPES),
-- replacing the old flat blockedMessageTypes list entirely. Before dropping
-- the column, fold any existing per-chat/global blockedMessageTypes entries
-- into mediaFilters (enabled, no warn/notify -- matching how the type
-- behaved under the flat list) so no admin's existing restrictions are lost.
-- Skips a type already present in mediaFilters (Filters-managed types like
-- PHOTO could already have their own row there).
UPDATE "ChatModerationSettings" AS t
SET "mediaFilters" = t."mediaFilters" || (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'type', legacy.type,
    'enabled', true,
    'warnOnTrigger', false,
    'notifyEnabled', false,
    'notifyText', '🚫 Этот тип контента запрещён в этом чате.'
  )), '[]'::jsonb)
  FROM unnest(t."blockedMessageTypes") AS legacy(type)
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(t."mediaFilters") AS existing
    WHERE existing->>'type' = legacy.type
  )
)
WHERE array_length(t."blockedMessageTypes", 1) > 0;

UPDATE "GlobalModerationSettings" AS t
SET "mediaFilters" = t."mediaFilters" || (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'type', legacy.type,
    'enabled', true,
    'warnOnTrigger', false,
    'notifyEnabled', false,
    'notifyText', '🚫 Этот тип контента запрещён в этом чате.'
  )), '[]'::jsonb)
  FROM unnest(t."blockedMessageTypes") AS legacy(type)
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(t."mediaFilters") AS existing
    WHERE existing->>'type' = legacy.type
  )
)
WHERE array_length(t."blockedMessageTypes", 1) > 0;

ALTER TABLE "ChatModerationSettings" DROP COLUMN "blockedMessageTypes";
ALTER TABLE "GlobalModerationSettings" DROP COLUMN "blockedMessageTypes";
