import type {
  AiAnalysis,
  AuditFinding,
  BrokenLinkResult,
  ConsoleErrorResult,
  LighthouseReportData,
  NetworkErrorResult
} from "./types.js";
import { toSafeErrorDetails } from "./lib/redaction.js";

interface GenerateAiAnalysisInput {
  url: string;
  overallScore: number | null;
  lighthouse: LighthouseReportData;
  issues: AuditFinding[];
  brokenLinks: BrokenLinkResult[];
  consoleErrors: ConsoleErrorResult[];
  networkErrors: NetworkErrorResult[];
  enabled?: boolean;
}

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

export async function generateAiAnalysis(
  input: GenerateAiAnalysisInput,
  parentSignal?: AbortSignal
): Promise<AiAnalysis> {
  if (input.enabled === false) {
    return {
      ...fallbackAnalysis(input),
      enabled: false,
      provider: "DETERMINISTIC",
      disclaimer: "Análise generativa desabilitada na configuração desta auditoria."
    };
  }
  if (!process.env.OPENAI_API_KEY) {
    console.info("[ai] OPENAI_API_KEY não configurada. Usando fallback heurístico.");
    return { ...fallbackAnalysis(input), enabled: true, provider: "DETERMINISTIC" };
  }

  try {
    const prompt = [
      "Você é um auditor sênior de produtos digitais com foco em produto SaaS, UX e operação técnica.",
      "Analise os dados abaixo e retorne APENAS um JSON válido.",
      "Campos obrigatórios:",
      "executiveTitle, executiveSummary, confidenceLabel, releaseReadiness, topProblems, quickWins, practicalSuggestions, correctionPriorities, userImpact, businessImpact, technicalRecommendations.",
      "Escreva em português do Brasil.",
      "Use listas curtas com 3 a 6 itens quando aplicável.",
      JSON.stringify(input)
    ].join("\n");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: 0.15,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Responda somente com JSON válido, sem markdown."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      }),
      signal: parentSignal
        ? AbortSignal.any([parentSignal, AbortSignal.timeout(45_000)])
        : AbortSignal.timeout(45_000)
    });

    if (!response.ok) {
      console.warn(`[ai] OpenAI respondeu com status ${response.status}. Usando fallback heurístico.`);
      return { ...fallbackAnalysis(input), enabled: true, provider: "DETERMINISTIC" };
    }

    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;

    if (!content || typeof content !== "string") {
      return { ...fallbackAnalysis(input), enabled: true, provider: "DETERMINISTIC" };
    }

    const parsed = JSON.parse(extractJson(content)) as Partial<AiAnalysis>;
    return { ...normalizeAnalysis(parsed, input), enabled: true, provider: "OPENAI" };
  } catch (error) {
    if (parentSignal?.aborted) {
      throw parentSignal.reason instanceof Error ? parentSignal.reason : error;
    }
    console.warn("[ai] Falha ao gerar análise com OpenAI. Usando fallback heurístico.", toSafeErrorDetails(error));
    return { ...fallbackAnalysis(input), enabled: true, provider: "DETERMINISTIC" };
  }
}

function normalizeAnalysis(data: Partial<AiAnalysis>, input: GenerateAiAnalysisInput): AiAnalysis {
  const fallback = fallbackAnalysis(input);

  return {
    executiveTitle: data.executiveTitle?.trim() || fallback.executiveTitle,
    executiveSummary: data.executiveSummary?.trim() || fallback.executiveSummary,
    confidenceLabel: data.confidenceLabel?.trim() || fallback.confidenceLabel,
    releaseReadiness: data.releaseReadiness?.trim() || fallback.releaseReadiness,
    topProblems: sanitizeList(data.topProblems, fallback.topProblems),
    quickWins: sanitizeList(data.quickWins, fallback.quickWins),
    practicalSuggestions: sanitizeList(data.practicalSuggestions, fallback.practicalSuggestions),
    correctionPriorities: sanitizeList(data.correctionPriorities, fallback.correctionPriorities),
    userImpact: data.userImpact?.trim() || fallback.userImpact,
    businessImpact: data.businessImpact?.trim() || fallback.businessImpact,
    technicalRecommendations: sanitizeList(data.technicalRecommendations, fallback.technicalRecommendations)
  };
}

function sanitizeList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const items = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return items.length > 0 ? items.slice(0, 6) : fallback;
}

function extractJson(content: string): string {
  const match = content.match(/\{[\s\S]*\}/);
  return match?.[0] || content;
}

function fallbackAnalysis(input: GenerateAiAnalysisInput): AiAnalysis {
  const criticalIssues = input.issues.filter((issue) => issue.severity === "CRITICAL").length;
  const accessibilityScore = input.lighthouse.scores.accessibility;
  const performanceScore = input.lighthouse.scores.performance;
  const overallScore = input.overallScore;
  const lighthouseAvailable = overallScore !== null;

  return {
    executiveTitle:
      !lighthouseAvailable
        ? "Auditoria concluída com métricas Lighthouse indisponíveis"
        : overallScore >= 85
        ? "Base forte com ajustes pontuais de alto retorno"
        : "Auditoria aponta risco técnico e oportunidade clara de evolução",
    executiveSummary:
      !lighthouseAvailable
        ? "A navegação, acessibilidade automatizada e evidências funcionais foram consolidadas, mas os scores do Lighthouse não ficaram disponíveis nesta execução. Eles devem ser medidos novamente antes de concluir sobre performance, SEO e boas práticas."
        : overallScore >= 85
        ? "O site apresenta uma base consistente de qualidade, mas ainda existem ajustes relevantes para melhorar experiência, acessibilidade e previsibilidade operacional."
        : "A auditoria encontrou gargalos técnicos e de experiência que afetam percepção de qualidade, confiança do usuário e maturidade do produto.",
    confidenceLabel:
      criticalIssues === 0 && input.brokenLinks.length === 0
        ? "Confiança alta"
        : criticalIssues <= 2
          ? "Confiança moderada"
          : "Confiança cautelosa",
    releaseReadiness:
      criticalIssues === 0
        ? "A release está relativamente pronta, mas vale atacar melhorias de impacto rápido antes de promover como referência."
        : "A release não está no melhor estado para ser apresentada como benchmark sem corrigir os itens mais críticos.",
    topProblems: [
      input.brokenLinks.length > 0
        ? `Foram encontrados ${input.brokenLinks.length} links quebrados com impacto direto em navegação e SEO.`
        : "Não foram encontrados links quebrados relevantes, o que ajuda a preservar a confiabilidade do fluxo.",
      input.consoleErrors.length > 0
        ? `O navegador registrou ${input.consoleErrors.length} erros de console durante a carga da página.`
        : "Não houve erros graves de console durante a auditoria automatizada.",
      criticalIssues > 0
        ? `Há ${criticalIssues} problemas críticos priorizados na consolidação dos achados.`
        : "Os gaps mais relevantes estão concentrados em ajustes médios e baixos."
    ],
    quickWins: [
      "Corrigir links quebrados e falhas de carregamento visíveis no runtime.",
      "Atacar as oportunidades do Lighthouse com maior impacto em renderização e peso.",
      "Revisar alt, labels e elementos de navegação para subir a acessibilidade rapidamente."
    ],
    practicalSuggestions: [
      performanceScore === null
        ? "Repita o Lighthouse em ambiente estável antes de priorizar otimizações baseadas em score."
        : performanceScore < 80
        ? "Reduzir recursos bloqueantes, otimizar imagens e revisar a ordem de carregamento dos assets."
        : "Preservar a boa base de performance e monitorar regressão nas próximas entregas.",
      accessibilityScore === null
        ? "Use os achados do axe-core e complemente a medição do Lighthouse em uma nova execução."
        : accessibilityScore < 85
        ? "Corrigir itens do axe-core como alt ausente, rótulos incompletos e contraste onde aplicável."
        : "Aprofundar a acessibilidade com revisão manual por teclado e leitores de tela.",
      "Refinar CTA, hierarquia visual e feedbacks de interface para melhorar entendimento e conversão."
    ],
    correctionPriorities: [
      "Resolver erros de runtime e links quebrados antes de qualquer refinamento estético.",
      "Atacar violações críticas de acessibilidade antes de promover a aplicação como produto maduro.",
      "Executar uma nova auditoria após as correções para validar o ganho real de score."
    ],
    userImpact:
      "Os problemas encontrados podem aumentar abandono, gerar desconfiança em fluxos importantes e reduzir a qualidade percebida em mobile.",
    businessImpact:
      "Se os gargalos permanecerem, o produto perde força comercial em demos, onboarding e operação recorrente com clientes mais exigentes.",
    technicalRecommendations: [
      "Instrumentar monitoramento de erros front-end e falhas de rede.",
      "Automatizar auditorias Lighthouse e axe-core em pipeline CI/CD.",
      "Padronizar componentes com critérios mínimos de acessibilidade, responsividade e telemetria."
    ]
  };
}
