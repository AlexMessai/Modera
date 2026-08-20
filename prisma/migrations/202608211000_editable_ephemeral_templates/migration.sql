-- Makes the two ephemeral (receiver_user_id) message texts in the project
-- admin-editable instead of hardcoded in .ts files: the join captcha
-- challenge, and the punishment ephemeral notice (added in #66) for
-- WARNING/MUTE/BAN, stored alongside the existing manual-moderation
-- announcement templates since it's the same per-action shape.
ALTER TABLE "ChatCaptchaSettings" ADD COLUMN "challengeMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT 'Подтвердите, что вы не бот — нажмите кнопку ниже. Пока не подтвердите, вы не сможете писать в этом чате; если долго не подтвердите, вас исключат (без блокировки — сможете зайти снова).';
ALTER TABLE "GlobalCaptchaSettings" ADD COLUMN "challengeMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT 'Подтвердите, что вы не бот — нажмите кнопку ниже. Пока не подтвердите, вы не сможете писать в этом чате; если долго не подтвердите, вас исключат (без блокировки — сможете зайти снова).';

ALTER TABLE "ChatManualModerationSettings" ADD COLUMN "warnEphemeralMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT E'⚠️ В чате «%chat%» вам выдано: предупреждение. %reason%\n\nЧтобы оспорить или узнать детали, напишите %contact%';
ALTER TABLE "ChatManualModerationSettings" ADD COLUMN "muteEphemeralMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT E'⚠️ В чате «%chat%» вам выдано: временное ограничение (mute). %reason%\n\nЧтобы оспорить или узнать детали, напишите %contact%';
ALTER TABLE "ChatManualModerationSettings" ADD COLUMN "banEphemeralMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT E'⚠️ В чате «%chat%» вам выдано: блокировка (ban). %reason%\n\nЧтобы оспорить или узнать детали, напишите %contact%';

ALTER TABLE "GlobalManualModerationSettings" ADD COLUMN "warnEphemeralMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT E'⚠️ В чате «%chat%» вам выдано: предупреждение. %reason%\n\nЧтобы оспорить или узнать детали, напишите %contact%';
ALTER TABLE "GlobalManualModerationSettings" ADD COLUMN "muteEphemeralMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT E'⚠️ В чате «%chat%» вам выдано: временное ограничение (mute). %reason%\n\nЧтобы оспорить или узнать детали, напишите %contact%';
ALTER TABLE "GlobalManualModerationSettings" ADD COLUMN "banEphemeralMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT E'⚠️ В чате «%chat%» вам выдано: блокировка (ban). %reason%\n\nЧтобы оспорить или узнать детали, напишите %contact%';
