import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import type {
  AiAnalysis,
  AuditFinding,
  BrokenLinkResult,
  ConsoleErrorResult,
  LighthouseReportData
} from "./types.js";

interface GeneratePdfInput {
  outputPath: string;
  url: string;
  auditedAt: string;
  scores: LighthouseReportData["scores"] & { overall: number | null };
  ai: AiAnalysis;
  issues: AuditFinding[];
  brokenLinks: BrokenLinkResult[];
  consoleErrors: ConsoleErrorResult[];
  desktopScreenshotPath: string;
  mobileScreenshotPath: string;
  lighthouse: LighthouseReportData;
  issueSummary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    brokenLinks: number;
    consoleErrors: number;
    networkErrors: number;
  };
}

export async function generatePdfReport(input: GeneratePdfInput): Promise<string> {
  await fs.promises.mkdir(path.dirname(input.outputPath), { recursive: true });

  const doc = new PDFDocument({
    size: "A4",
    margin: 36,
    compress: true
  });

  const stream = fs.createWriteStream(input.outputPath);
  doc.pipe(stream);

  drawPageBackground(doc);
  drawHeader(doc, "AI Web Auditor", "Relatório executivo da auditoria");
  drawScoreHero(doc, input);
  drawAiSummary(doc, input.ai);

  doc.addPage();
  drawPageBackground(doc);
  drawHeader(doc, "Visão operacional", "Riscos, impacto e ganhos rápidos");
  drawIssueOverview(doc, input);
  drawSectionTitle(doc, 360, "Ganhos rápidos");
  drawBulletList(doc, 388, input.ai.quickWins.slice(0, 4), "#E6ECFF");
  drawSectionTitle(doc, 480, "Impacto no negócio");
  doc.font("Helvetica").fontSize(11).fillColor("#D6DCEF").text(input.ai.businessImpact, 60, 508, {
    width: 485,
    lineGap: 4
  });

  doc.addPage();
  drawPageBackground(doc);
  drawHeader(doc, "Capturas", "Evidências em desktop e mobile");
  drawScreenshotBlock(doc, 36, 110, 360, 260, input.desktopScreenshotPath, "Desktop");
  drawScreenshotBlock(doc, 416, 110, 143, 260, input.mobileScreenshotPath, "Mobile");
  drawSectionTitle(doc, 405, "Lighthouse metrics");

  const metrics = [
    `FCP: ${input.lighthouse.metrics.firstContentfulPaint ?? "-"}`,
    `LCP: ${input.lighthouse.metrics.largestContentfulPaint ?? "-"}`,
    `Speed Index: ${input.lighthouse.metrics.speedIndex ?? "-"}`,
    `TTI: ${input.lighthouse.metrics.timeToInteractive ?? "-"}`,
    `TBT: ${input.lighthouse.metrics.totalBlockingTime ?? "-"}`,
    `CLS: ${input.lighthouse.metrics.cumulativeLayoutShift ?? "-"}`
  ];
  drawMetricGrid(doc, 433, metrics);

  doc.addPage();
  drawPageBackground(doc);
  drawHeader(doc, "Problemas e recomendações", "Resumo executivo para priorização");
  drawIssueTable(doc, input.issues);
  drawSectionTitle(doc, 520, "Recomendações técnicas");
  drawBulletList(doc, 548, input.ai.technicalRecommendations.slice(0, 4), "#E6ECFF");

  doc.end();

  await new Promise<void>((resolve, reject) => {
    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });

  return input.outputPath;
}

function drawPageBackground(doc: PDFKit.PDFDocument) {
  doc.save();
  doc.rect(0, 0, doc.page.width, doc.page.height).fill("#070B16");
  doc.restore();
}

function drawHeader(doc: PDFKit.PDFDocument, title: string, subtitle: string) {
  doc.font("Helvetica-Bold").fontSize(22).fillColor("#F7FAFF").text(title, 36, 34);
  doc.font("Helvetica").fontSize(10).fillColor("#8C97B5").text(subtitle, 36, 60);
}

function drawScoreHero(doc: PDFKit.PDFDocument, input: GeneratePdfInput) {
  roundedCard(doc, 36, 96, 523, 150);
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#F7FAFF").text(input.ai.executiveTitle, 60, 118, {
    width: 210
  });
  doc.font("Helvetica-Bold").fontSize(42).fillColor("#6C63FF").text(formatScore(input.scores.overall), 60, 160);
  doc.font("Helvetica").fontSize(10).fillColor("#8C97B5").text(
    `${input.scores.overall === null ? "Métrica indisponível" : "/100"} | ${formatDate(input.auditedAt)}`,
    63,
    208
  );
  doc.font("Helvetica").fontSize(11).fillColor("#C3CAE2").text(input.url, 60, 228, { width: 470 });

  const cards: Array<[string, number | null]> = [
    ["Performance", input.scores.performance],
    ["Acessibilidade", input.scores.accessibility],
    ["SEO", input.scores.seo],
    ["Boas práticas", input.scores.bestPractices]
  ];

  cards.forEach(([label, value], index) => {
    const x = 245 + index * 78;
    doc.roundedRect(x, 124, 66, 90, 14).fillAndStroke("#0E1323", "#1A2340");
    doc.font("Helvetica").fontSize(8).fillColor("#8C97B5").text(label, x + 6, 138, {
      width: 54,
      align: "center"
    });
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#F7FAFF").text(formatScore(value), x + 6, 174, {
      width: 54,
      align: "center"
    });
  });
}

function drawAiSummary(doc: PDFKit.PDFDocument, ai: AiAnalysis) {
  roundedCard(doc, 36, 270, 523, 250);
  drawSectionTitle(doc, 292, "Resumo executivo");
  doc.font("Helvetica").fontSize(11).fillColor("#D6DCEF").text(ai.executiveSummary, 60, 320, {
    width: 485,
    lineGap: 4
  });
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#CFCBFF").text(ai.confidenceLabel, 60, 392);
  doc.font("Helvetica").fontSize(10).fillColor("#8C97B5").text(ai.releaseReadiness, 60, 410, {
    width: 485,
    lineGap: 4
  });
}

function drawIssueOverview(doc: PDFKit.PDFDocument, input: GeneratePdfInput) {
  roundedCard(doc, 36, 98, 523, 220);
  drawSectionTitle(doc, 120, "Visão dos problemas");

  const items = [
    ["Crítico", input.issueSummary.critical],
    ["Alto", input.issueSummary.high],
    ["Médio", input.issueSummary.medium],
    ["Baixo", input.issueSummary.low],
    ["Links quebrados", input.issueSummary.brokenLinks],
    ["Erros de console", input.issueSummary.consoleErrors],
    ["Erros de rede", input.issueSummary.networkErrors]
  ];

  items.forEach(([label, value], index) => {
    const row = Math.floor(index / 4);
    const col = index % 4;
    const x = 60 + col * 120;
    const y = 148 + row * 64;
    doc.roundedRect(x, y, 110, 48, 14).fillAndStroke("#10192D", "#1A2340");
    doc.font("Helvetica").fontSize(9).fillColor("#8C97B5").text(String(label), x + 12, y + 10);
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#F7FAFF").text(String(value), x + 12, y + 22);
  });
}

function drawSectionTitle(doc: PDFKit.PDFDocument, y: number, title: string) {
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#F7FAFF").text(title, 60, y);
}

function drawBulletList(doc: PDFKit.PDFDocument, y: number, items: string[], textColor: string) {
  items.forEach((item, index) => {
    const top = y + index * 20;
    doc.circle(64, top + 6, 2).fill("#6C63FF");
    doc.font("Helvetica").fontSize(10).fillColor(textColor).text(item, 74, top, { width: 470 });
  });
}

function drawScreenshotBlock(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  imagePath: string,
  label: string
) {
  roundedCard(doc, x, y, width, height);
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#F7FAFF").text(label, x + 16, y + 16);
  if (imagePath && fs.existsSync(imagePath)) {
    doc.image(imagePath, x + 16, y + 42, { fit: [width - 32, height - 58], align: "center", valign: "center" });
  } else {
    doc.font("Helvetica").fontSize(9).fillColor("#8C97B5").text(
      "Captura indisponível; consulte as limitações do relatório JSON.",
      x + 16,
      y + 92,
      { width: width - 32, align: "center" }
    );
  }
}

function drawMetricGrid(doc: PDFKit.PDFDocument, startY: number, metrics: string[]) {
  metrics.forEach((metric, index) => {
    const row = Math.floor(index / 2);
    const col = index % 2;
    const x = 36 + col * 262;
    const y = startY + row * 52;
    roundedCard(doc, x, y, 250, 40);
    doc.font("Helvetica").fontSize(10).fillColor("#D6DCEF").text(metric, x + 16, y + 14);
  });
}

function drawIssueTable(doc: PDFKit.PDFDocument, issues: AuditFinding[]) {
  const rows = issues.slice(0, 8);
  roundedCard(doc, 36, 108, 523, 380);

  rows.forEach((issue, index) => {
    const y = 128 + index * 42;
    if (index > 0) {
      doc.moveTo(56, y - 8).lineTo(539, y - 8).strokeColor("#18213B").lineWidth(1).stroke();
    }

    doc.font("Helvetica-Bold").fontSize(11).fillColor("#F7FAFF").text(issue.title, 60, y);
    doc.font("Helvetica").fontSize(9).fillColor("#8C97B5").text(issue.description, 60, y + 14, {
      width: 350,
      height: 22
    });
    doc.font("Helvetica-Bold").fontSize(8).fillColor(severityColor(issue.severity)).text(formatSeverity(issue.severity), 428, y + 4, {
      width: 55,
      align: "right"
    });
    doc.font("Helvetica").fontSize(8).fillColor("#8C97B5").text(issue.source, 492, y + 4, {
      width: 38,
      align: "right"
    });
  });
}

function roundedCard(doc: PDFKit.PDFDocument, x: number, y: number, width: number, height: number) {
  doc.roundedRect(x, y, width, height, 18).fillAndStroke("#0D1220", "#1A2340");
}

function severityColor(severity: string) {
  if (severity === "CRITICAL") {
    return "#FF5D73";
  }
  if (severity === "HIGH") {
    return "#FF8A5B";
  }
  if (severity === "MEDIUM") {
    return "#FFB648";
  }
  return "#53E0A1";
}

function formatScore(score: number | null): string {
  return score === null ? "N/D" : String(score);
}

function formatSeverity(severity: AuditFinding["severity"]): string {
  const labels: Record<AuditFinding["severity"], string> = {
    CRITICAL: "CRÍTICO",
    HIGH: "ALTO",
    MEDIUM: "MÉDIO",
    LOW: "BAIXO",
    INFO: "INFO"
  };
  return labels[severity];
}

function formatDate(input: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(input));
}
