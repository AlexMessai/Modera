-- Captcha rule simplified to a fixed policy: mute immediately on join,
-- kick (never ban) whoever is still unverified at the next daily sweep.
-- No more per-chat/global timeout or kick-vs-ban choice.
ALTER TABLE "ChatCaptchaSettings" DROP COLUMN "timeoutMinutes";
ALTER TABLE "ChatCaptchaSettings" DROP COLUMN "failAction";
ALTER TABLE "GlobalCaptchaSettings" DROP COLUMN "timeoutMinutes";
ALTER TABLE "GlobalCaptchaSettings" DROP COLUMN "failAction";
DROP TYPE "CaptchaFailAction";
