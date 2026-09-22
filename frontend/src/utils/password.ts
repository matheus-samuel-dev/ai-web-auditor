export function passwordError(value: string, registering = false): string | null {
  if (!value.trim()) return "Informe uma senha.";
  if (registering && value.length < 8) return "A senha deve ter entre 8 e 72 caracteres.";
  if (value.length > 72) return "A senha deve ter no máximo 72 caracteres.";
  if (new TextEncoder().encode(value).length > 72) return "A senha deve ter no máximo 72 bytes em UTF-8.";
  return null;
}
