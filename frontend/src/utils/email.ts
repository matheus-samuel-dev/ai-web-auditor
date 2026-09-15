export const EMAIL_ERROR = "Informe um email válido, com domínio completo (ex.: nome@empresa.com).";

// Basic public-domain validation; leaves uncommon but valid local parts unrestricted.
export function isValidEmail(value: string): boolean {
  return value.length <= 160 && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value);
}
