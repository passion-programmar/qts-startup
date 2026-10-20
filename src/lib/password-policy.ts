export const minimumPasswordLength = 12;

export function passwordLengthError(label = "The password"): string {
  return `${label} must be at least ${minimumPasswordLength} characters.`;
}
