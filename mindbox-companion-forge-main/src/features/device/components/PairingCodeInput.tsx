import { REGEXP_ONLY_DIGITS } from "input-otp";

import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

/**
 * Segmented 6-digit pairing-code entry. Big touch targets, numeric keyboard on
 * phones, paste-friendly, and auto-advancing — a far better mobile experience
 * than one cramped text box. Fires `onComplete` when all six digits are in.
 */
export function PairingCodeInput({
  value,
  onChange,
  onComplete,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <InputOTP
      maxLength={6}
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      disabled={disabled}
      pattern={REGEXP_ONLY_DIGITS}
      inputMode="numeric"
      autoComplete="one-time-code"
      containerClassName="justify-center sm:justify-start"
      aria-label="6-digit pairing code"
    >
      <InputOTPGroup>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <InputOTPSlot key={i} index={i} className="h-12 w-11 text-lg font-mono" />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}
