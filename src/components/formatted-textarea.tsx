"use client";

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  className?: string;
  id?: string;
  autoFocus?: boolean;
  "aria-label"?: string;
};

export function FormattedTextarea({
  value,
  onChange,
  disabled = false,
  rows = 5,
  maxLength,
  placeholder,
  className,
  id,
  autoFocus,
  "aria-label": ariaLabel
}: Props) {
  return (
    <textarea
      id={id}
      className={`formatted-textarea${className ? ` ${className}` : ""}`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      rows={rows}
      maxLength={maxLength}
      placeholder={placeholder}
      autoFocus={autoFocus}
      aria-label={ariaLabel ?? "Текст сообщения"}
    />
  );
}
