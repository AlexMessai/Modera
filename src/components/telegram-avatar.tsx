import Image from "next/image";

export function TelegramAvatar({
  userId,
  displayName,
  size,
  className = ""
}: {
  userId: string;
  displayName: string;
  size: number;
  className?: string;
}) {
  return (
    <span
      className={`telegram-avatar ${className}`.trim()}
      style={{ width: size, height: size }}
    >
      <Image
        src={`/api/telegram/users/${userId}/avatar`}
        alt={`Аватар ${displayName}`}
        width={size}
        height={size}
        sizes={`${size}px`}
        unoptimized
      />
    </span>
  );
}
