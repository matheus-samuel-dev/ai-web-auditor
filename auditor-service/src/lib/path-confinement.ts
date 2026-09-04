import { realpath } from "node:fs/promises";
import path from "node:path";

export type PathConfinementCode =
  | "EMPTY_PATH"
  | "ABSOLUTE_PATH"
  | "PATH_TRAVERSAL"
  | "ENCODED_PATH"
  | "INVALID_PATH_CHARACTER"
  | "OUTSIDE_ROOT"
  | "INVALID_FILENAME"
  | "SYMLINK_ESCAPE";

export class PathConfinementError extends Error {
  readonly code: PathConfinementCode;

  constructor(code: PathConfinementCode, message: string) {
    super(message);
    this.name = "PathConfinementError";
    this.code = code;
  }
}

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const WINDOWS_ABSOLUTE = /^(?:[a-z]:[\\/]|\\\\|\\\?\\|\\\.\\)/i;
const ENCODED_SEPARATOR_OR_DOT = /%(?:00|2e|2f|5c)/i;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const INVALID_FILENAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;

/**
 * Converts an untrusted relative artifact path to a platform-native absolute
 * path and guarantees that the result remains below `root`.
 */
export function resolvePathWithinRoot(root: string, untrustedRelativePath: string): string {
  const absoluteRoot = path.resolve(root);
  const segments = validateRelativePath(untrustedRelativePath);
  const candidate = path.resolve(absoluteRoot, ...segments);

  if (!isPathWithinRoot(absoluteRoot, candidate) || candidate === absoluteRoot) {
    throw new PathConfinementError("OUTSIDE_ROOT", "O caminho solicitado está fora da raiz permitida.");
  }
  return candidate;
}

/**
 * Performs the lexical check above and then resolves filesystem symlinks. Use
 * this before reading an existing artifact to prevent a symlink escape.
 */
export async function assertExistingPathWithinRoot(
  root: string,
  untrustedRelativePath: string
): Promise<string> {
  const lexicalCandidate = resolvePathWithinRoot(root, untrustedRelativePath);
  const [realRoot, realCandidate] = await Promise.all([realpath(path.resolve(root)), realpath(lexicalCandidate)]);

  if (!isPathWithinRoot(realRoot, realCandidate) || realCandidate === realRoot) {
    throw new PathConfinementError(
      "SYMLINK_ESCAPE",
      "O artefato resolve para fora da raiz permitida."
    );
  }
  return realCandidate;
}

export function isPathWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/** Returns a normalized POSIX relative path suitable for persistence. */
export function normalizeArtifactRelativePath(untrustedRelativePath: string): string {
  return validateRelativePath(untrustedRelativePath).join("/");
}

export function assertSafeFileName(fileName: string): string {
  if (typeof fileName !== "string" || !fileName.trim()) {
    throw new PathConfinementError("INVALID_FILENAME", "O nome do arquivo está vazio.");
  }
  if (
    fileName !== fileName.trim() ||
    fileName === "." ||
    fileName === ".." ||
    fileName.endsWith(".") ||
    fileName.endsWith(" ") ||
    INVALID_FILENAME_CHARACTERS.test(fileName) ||
    WINDOWS_RESERVED_NAME.test(fileName)
  ) {
    INVALID_FILENAME_CHARACTERS.lastIndex = 0;
    throw new PathConfinementError("INVALID_FILENAME", "O nome do arquivo contém caracteres inseguros.");
  }
  INVALID_FILENAME_CHARACTERS.lastIndex = 0;
  return fileName;
}

/**
 * Produces a portable filename for generated artifacts. It never returns an
 * empty or Windows-reserved name and caps the UTF-16 length for portability.
 */
export function sanitizeFileName(
  fileName: string,
  options: { fallback?: string; maxLength?: number } = {}
): string {
  const fallback = cleanFallback(options.fallback ?? "artifact");
  const maxLength = clampInteger(options.maxLength ?? 120, 16, 240);
  let sanitized = String(fileName ?? "")
    .normalize("NFKC")
    .replace(INVALID_FILENAME_CHARACTERS, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .trim()
    .replace(/[. ]+$/g, "");

  if (!sanitized || sanitized === "." || sanitized === ".." || WINDOWS_RESERVED_NAME.test(sanitized)) {
    sanitized = fallback;
  }

  if (sanitized.length > maxLength) {
    const extension = path.extname(sanitized).slice(0, 20);
    const stemLimit = Math.max(1, maxLength - extension.length);
    sanitized = `${sanitized.slice(0, stemLimit).replace(/[. ]+$/g, "")}${extension}`;
  }

  return assertSafeFileName(sanitized || fallback);
}

function validateRelativePath(untrustedRelativePath: string): string[] {
  if (typeof untrustedRelativePath !== "string" || !untrustedRelativePath.trim()) {
    throw new PathConfinementError("EMPTY_PATH", "O caminho relativo está vazio.");
  }
  if (CONTROL_CHARACTERS.test(untrustedRelativePath)) {
    throw new PathConfinementError("INVALID_PATH_CHARACTER", "O caminho contém caracteres de controle.");
  }
  if (ENCODED_SEPARATOR_OR_DOT.test(untrustedRelativePath)) {
    throw new PathConfinementError(
      "ENCODED_PATH",
      "Separadores e segmentos codificados não são aceitos no caminho."
    );
  }

  const portablePath = untrustedRelativePath.replace(/\\/g, "/");
  if (portablePath.startsWith("/") || WINDOWS_ABSOLUTE.test(untrustedRelativePath) || /^[a-z]:/i.test(portablePath)) {
    throw new PathConfinementError("ABSOLUTE_PATH", "Somente caminhos relativos são permitidos.");
  }

  const segments = portablePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new PathConfinementError("PATH_TRAVERSAL", "O caminho contém segmentos de travessia.");
  }
  for (const segment of segments) {
    if (segment.endsWith(".") || segment.endsWith(" ") || segment.includes(":")) {
      throw new PathConfinementError(
        "INVALID_PATH_CHARACTER",
        "O caminho contém um segmento não portável."
      );
    }
    if (WINDOWS_RESERVED_NAME.test(segment)) {
      throw new PathConfinementError(
        "INVALID_PATH_CHARACTER",
        "O caminho contém um nome reservado pelo sistema."
      );
    }
  }
  return segments;
}

function cleanFallback(fallback: string): string {
  const value = String(fallback).replace(INVALID_FILENAME_CHARACTERS, "-").trim().replace(/[. ]+$/g, "");
  if (!value || WINDOWS_RESERVED_NAME.test(value)) return "artifact";
  return value.slice(0, 80);
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
