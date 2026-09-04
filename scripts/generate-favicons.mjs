import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "../auditor-service/node_modules/playwright/index.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "frontend", "public");
const svgPath = path.join(publicDir, "favicon.svg");
const svgUrl = pathToFileURL(svgPath).href;

const targets = [
  { file: "favicon-16x16.png", size: 16 },
  { file: "favicon-32x32.png", size: 32 },
  { file: "apple-touch-icon.png", size: 180 },
  { file: "android-chrome-192x192.png", size: 192 },
  { file: "android-chrome-512x512.png", size: 512 }
];

await fs.mkdir(publicDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();

  for (const target of targets) {
    await page.setViewportSize({ width: target.size, height: target.size });
    await page.setContent(`
      <!doctype html>
      <html lang="en">
        <head>
          <style>
            html, body {
              margin: 0;
              width: 100%;
              height: 100%;
              overflow: hidden;
              background: transparent;
              display: grid;
              place-items: center;
            }
            img {
              display: block;
              width: ${target.size}px;
              height: ${target.size}px;
            }
          </style>
        </head>
        <body>
          <img src="${svgUrl}" alt="AI Web Auditor favicon" />
        </body>
      </html>
    `);

    await page.locator("img").screenshot({
      path: path.join(publicDir, target.file),
      omitBackground: true
    });
  }
} finally {
  await browser.close();
}

const favicon16 = await fs.readFile(path.join(publicDir, "favicon-16x16.png"));
const favicon32 = await fs.readFile(path.join(publicDir, "favicon-32x32.png"));
const ico = buildIco([
  { size: 16, data: favicon16 },
  { size: 32, data: favicon32 }
]);

await fs.writeFile(path.join(publicDir, "favicon.ico"), ico);

function buildIco(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = header.length;
  const chunks = [header];

  images.forEach((image, index) => {
    const entryOffset = 6 + index * 16;
    header.writeUInt8(image.size, entryOffset);
    header.writeUInt8(image.size, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(image.data.length, entryOffset + 8);
    header.writeUInt32LE(offset, entryOffset + 12);
    chunks.push(image.data);
    offset += image.data.length;
  });

  return Buffer.concat(chunks);
}
