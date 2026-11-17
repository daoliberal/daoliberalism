import { LIMITS, sanitizeText } from "@/data/metadata";
import { lengthError } from "@/lib/text";
import { isAddressInput } from "@/lib/validation";

/** Error text for the agent key field; undefined while it is empty (the form just stays disabled) or valid. */
export function keyError(v: string): string | undefined {
  return v.trim() === "" || isAddressInput(v.trim()) ? undefined : "Enter a valid 0x address.";
}
export function nameError(v: string): string | undefined {
  return lengthError(v, LIMITS.name);
}
export function descriptionError(v: string): string | undefined {
  return lengthError(v, LIMITS.description);
}
/** A long address is shown shortened; the full text stays in the data. */
export function displayUri(uri: string): string {
  const t = sanitizeText(uri, 4096);
  return t.length > 48 ? `${t.slice(0, 28)}…${t.slice(-12)}` : t;
}
