-- GlobalCaptchaSettings, GlobalContentSettings, GlobalAntiRaidSettings, and
-- GlobalReportSettings were never read by anything that actually delivers a
-- captcha/welcome message or applies anti-raid/report policy -- every
-- resolveEffective*Settings() reads only the chat's own row. useGlobalProfile
-- on the six Chat*Settings tables below was likewise always ignored (hardcoded
-- false in every service). Both were pure write-only debris.

DROP TABLE "GlobalCaptchaSettings";
DROP TABLE "GlobalContentSettings";
DROP TABLE "GlobalAntiRaidSettings";
DROP TABLE "GlobalReportSettings";

ALTER TABLE "GlobalModerationSettings" DROP COLUMN "mediaFilters";

ALTER TABLE "ChatModerationSettings" DROP COLUMN "useGlobalProfile";
ALTER TABLE "ChatCaptchaSettings" DROP COLUMN "useGlobalProfile";
ALTER TABLE "ChatAntiRaidSettings" DROP COLUMN "useGlobalProfile";
ALTER TABLE "ChatManualModerationSettings" DROP COLUMN "useGlobalProfile";
ALTER TABLE "ChatReportSettings" DROP COLUMN "useGlobalProfile";
ALTER TABLE "ChatContentSettings" DROP COLUMN "useGlobalProfile";
