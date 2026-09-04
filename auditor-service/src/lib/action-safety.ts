export type ActionSafetyLevel = "SAFE" | "REQUIRES_AUTHORIZATION" | "DESTRUCTIVE" | "BLOCKED";

export interface ActionSafetyInput {
  kind: string;
  label?: string;
  accessibleName?: string;
  text?: string;
  url?: string;
  formAction?: string;
  method?: string;
  inputType?: string;
  attributes?: Readonly<Record<string, string | undefined>>;
}

export interface ActionSafetyAssessment {
  level: ActionSafetyLevel;
  reasonCode:
    | "SECURITY_CHALLENGE"
    | "ARBITRARY_SCRIPT"
    | "DESTRUCTIVE_METHOD"
    | "DESTRUCTIVE_INTENT"
    | "FINANCIAL_INTENT"
    | "SENSITIVE_INPUT"
    | "STATE_CHANGING_METHOD"
    | "STATE_CHANGING_INTENT"
    | "READ_ONLY_ACTION"
    | "UNKNOWN_ACTION";
  reason: string;
  matchedTerms: readonly string[];
}

export interface ActionPermissionContext {
  hasUserAuthorization: boolean;
  domainAuthorized: boolean;
  flowConfigured?: boolean;
  testEnvironment?: boolean;
  destructiveActionsEnabled?: boolean;
}

export interface ActionPermissionDecision {
  allowed: boolean;
  status:
    | "ALLOWED"
    | "SKIPPED_UNAUTHORIZED_DOMAIN"
    | "SKIPPED_REQUIRES_AUTHORIZATION"
    | "SKIPPED_DESTRUCTIVE"
    | "SKIPPED_BLOCKED";
  reason: string;
}

const BLOCKED_PATTERNS: readonly RegExp[] = [
  /\b(?:captcha|recaptcha|hcaptcha|turnstile)\b/,
  /\b(?:mfa|2fa|otp)\b/,
  /\b(?:two factor|multi factor|one time password|codigo de verificacao|security challenge)\b/,
  /\b(?:bypass|contornar|evadir|disable security|desativar seguranca)\b/
];

const DESTRUCTIVE_PATTERNS: readonly RegExp[] = [
  /\b(?:delete|destroy|erase|purge|excluir|deletar|apagar|destruir)\b/,
  /\b(?:remove|remover)\b/,
  /\b(?:cancel|cancelar|unsubscribe|encerrar conta|close account|terminate)\b/,
  /\b(?:reset database|drop database|formatar|factory reset)\b/
];

const FINANCIAL_PATTERNS: readonly RegExp[] = [
  /\b(?:pay|payment|purchase|buy now|checkout|charge|withdraw|transfer|wire|refund)\b/,
  /\b(?:pagar|pagamento|comprar|finalizar compra|cobrar|sacar|saque|transferir|estornar)\b/
];

const STATE_CHANGING_PATTERNS: readonly RegExp[] = [
  /\b(?:submit|save|create|update|edit|publish|send|upload|approve|reject|confirm)\b/,
  /\b(?:enviar|salvar|criar|atualizar|editar|publicar|aprovar|rejeitar|confirmar)\b/,
  /\b(?:login|log in|sign in|logout|log out|sign out|entrar|sair)\b/,
  /\b(?:subscribe|inscrever|registrar|register|sign up)\b/
];

const READ_ONLY_KINDS = new Set([
  "NAVIGATE",
  "READ",
  "INSPECT",
  "SCREENSHOT",
  "SCROLL",
  "HOVER",
  "WAIT",
  "SEARCH",
  "FILTER",
  "SORT"
]);

const READ_ONLY_PATTERNS: readonly RegExp[] = [
  /\b(?:view|open|details|next|previous|search|filter|sort|expand|collapse|read more)\b/,
  /\b(?:ver|abrir|detalhes|proximo|anterior|buscar|pesquisar|filtrar|ordenar|expandir|recolher|saiba mais)\b/
];

export function classifyActionSafety(input: ActionSafetyInput): ActionSafetyAssessment {
  const kind = normalizeKind(input.kind);
  const searchable = buildSearchableText(input);

  const blockedTerms = matchingTerms(searchable, BLOCKED_PATTERNS);
  if (blockedTerms.length > 0) {
    return assessment(
      "BLOCKED",
      "SECURITY_CHALLENGE",
      "A ação envolve CAPTCHA, MFA ou tentativa de contornar uma proteção.",
      blockedTerms
    );
  }

  if (kind === "EXECUTE_SCRIPT" || kind === "EVALUATE_SCRIPT") {
    return assessment(
      "BLOCKED",
      "ARBITRARY_SCRIPT",
      "A execução arbitrária de scripts não faz parte das ações automáticas permitidas.",
      [kind]
    );
  }

  const method = (input.method ?? input.attributes?.method ?? "").trim().toUpperCase();
  if (method === "DELETE") {
    return assessment(
      "DESTRUCTIVE",
      "DESTRUCTIVE_METHOD",
      "O método HTTP DELETE representa uma alteração destrutiva.",
      ["DELETE"]
    );
  }

  const destructiveTerms = matchingTerms(searchable, DESTRUCTIVE_PATTERNS);
  if (destructiveTerms.length > 0) {
    return assessment(
      "DESTRUCTIVE",
      "DESTRUCTIVE_INTENT",
      "O texto ou destino da ação indica uma operação destrutiva ou irreversível.",
      destructiveTerms
    );
  }

  const financialTerms = matchingTerms(searchable, FINANCIAL_PATTERNS);
  if (financialTerms.length > 0) {
    return assessment(
      "DESTRUCTIVE",
      "FINANCIAL_INTENT",
      "A ação pode iniciar pagamento, compra ou movimentação financeira.",
      financialTerms
    );
  }

  const inputType = (input.inputType ?? input.attributes?.type ?? "").trim().toLowerCase();
  if (["password", "file", "hidden"].includes(inputType) || kind === "UPLOAD") {
    return assessment(
      "REQUIRES_AUTHORIZATION",
      "SENSITIVE_INPUT",
      "A ação manipula credenciais, arquivos ou outro campo sensível.",
      [inputType || kind]
    );
  }

  if (["POST", "PUT", "PATCH"].includes(method)) {
    return assessment(
      "REQUIRES_AUTHORIZATION",
      "STATE_CHANGING_METHOD",
      `O método HTTP ${method} pode alterar dados.`,
      [method]
    );
  }

  const stateChangingTerms = matchingTerms(searchable, STATE_CHANGING_PATTERNS);
  if (stateChangingTerms.length > 0 || ["SUBMIT", "TYPE", "FILL", "SELECT", "CHECK"].includes(kind)) {
    return assessment(
      "REQUIRES_AUTHORIZATION",
      "STATE_CHANGING_INTENT",
      "A ação pode alterar estado e só deve ocorrer em um fluxo explicitamente configurado.",
      stateChangingTerms.length > 0 ? stateChangingTerms : [kind]
    );
  }

  const readOnlyTerms = matchingTerms(searchable, READ_ONLY_PATTERNS);
  if (READ_ONLY_KINDS.has(kind) || readOnlyTerms.length > 0) {
    return assessment(
      "SAFE",
      "READ_ONLY_ACTION",
      "A ação é de navegação, inspeção ou leitura e não indica alteração de estado.",
      readOnlyTerms.length > 0 ? readOnlyTerms : [kind]
    );
  }

  return assessment(
    "REQUIRES_AUTHORIZATION",
    "UNKNOWN_ACTION",
    "A intenção da ação não pôde ser provada como somente leitura.",
    []
  );
}

export function evaluateActionPermission(
  classification: ActionSafetyAssessment | ActionSafetyLevel,
  context: ActionPermissionContext
): ActionPermissionDecision {
  const level = typeof classification === "string" ? classification : classification.level;

  if (level === "BLOCKED") {
    return {
      allowed: false,
      status: "SKIPPED_BLOCKED",
      reason: "A política bloqueia esta classe de ação em qualquer ambiente."
    };
  }

  if (!context.hasUserAuthorization || !context.domainAuthorized) {
    return {
      allowed: false,
      status: "SKIPPED_UNAUTHORIZED_DOMAIN",
      reason: "A auditoria e o domínio precisam de autorização explícita."
    };
  }

  if (level === "SAFE") {
    return { allowed: true, status: "ALLOWED", reason: "Ação de leitura autorizada." };
  }

  if (level === "REQUIRES_AUTHORIZATION") {
    if (!context.flowConfigured) {
      return {
        allowed: false,
        status: "SKIPPED_REQUIRES_AUTHORIZATION",
        reason: "A ação exige um fluxo funcional configurado explicitamente."
      };
    }
    return { allowed: true, status: "ALLOWED", reason: "Ação autorizada pelo fluxo configurado." };
  }

  if (
    !context.flowConfigured ||
    !context.testEnvironment ||
    !context.destructiveActionsEnabled
  ) {
    return {
      allowed: false,
      status: "SKIPPED_DESTRUCTIVE",
      reason: "Ações destrutivas exigem fluxo configurado, ambiente de teste e habilitação explícita."
    };
  }

  return {
    allowed: true,
    status: "ALLOWED",
    reason: "Ação destrutiva explicitamente autorizada em ambiente de teste."
  };
}

function buildSearchableText(input: ActionSafetyInput): string {
  const values = [
    input.kind,
    input.label,
    input.accessibleName,
    input.text,
    safeUrlText(input.url),
    safeUrlText(input.formAction),
    input.attributes?.name,
    input.attributes?.title,
    input.attributes?.["aria-label"],
    input.attributes?.value
  ];
  return normalizeText(values.filter(Boolean).join(" "));
}

function safeUrlText(rawUrl?: string): string {
  if (!rawUrl) return "";
  try {
    const url = new URL(rawUrl, "https://audit.invalid");
    return `${url.pathname} ${url.searchParams.get("action") ?? ""}`;
  } catch {
    return rawUrl.slice(0, 500);
  }
}

function matchingTerms(text: string, patterns: readonly RegExp[]): string[] {
  const matches: string[] = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0] && !matches.includes(match[0])) matches.push(match[0]);
  }
  return matches;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeKind(kind: string): string {
  return normalizeText(kind).replace(/ /g, "_").toUpperCase();
}

function assessment(
  level: ActionSafetyLevel,
  reasonCode: ActionSafetyAssessment["reasonCode"],
  reason: string,
  matchedTerms: readonly string[]
): ActionSafetyAssessment {
  return { level, reasonCode, reason, matchedTerms };
}
