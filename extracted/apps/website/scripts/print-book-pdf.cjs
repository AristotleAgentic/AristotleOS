const { chromium } = require("playwright");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const htmlPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, "..", "dist", "book", "The-G-Plane-Architecture-Book-Package-Flow-Edited-print.html");
const pdfPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.resolve(__dirname, "..", "dist", "book", "The-G-Plane-Architecture-Book-Package-Flow-Edited.pdf");
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

(async () => {
  const browser = await chromium.launch({
    executablePath: edgePath,
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 816, height: 1056 } });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
  await page.pdf({
    path: pdfPath,
    format: "Letter",
    printBackground: true,
    displayHeaderFooter: false,
    margin: {
      top: "0.78in",
      right: "0.86in",
      bottom: "0.82in",
      left: "0.86in"
    }
  });
  await browser.close();
  console.log(pdfPath);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
