"use client";

import mammoth from "mammoth";

/**
 * IMPORTANT:
 * pdfjs must only run in browser
 */
export async function convertDocumentToDelta(file: File): Promise<any> {
  const fileName = file.name.toLowerCase();

  if (fileName.endsWith(".txt")) {
    return convertTxtToDelta(file);
  }

  if (fileName.endsWith(".docx")) {
    return convertDocxToDelta(file);
  }

  if (fileName.endsWith(".pdf")) {
    return convertPdfToDelta(file);
  }

  throw new Error("Unsupported file type. Please upload TXT, DOCX, or PDF.");
}

// ------------------ Quill (client-only) ------------------

async function createQuill() {
  if (typeof window === "undefined") {
    throw new Error("Quill can only run in browser");
  }

  const QuillModule = await import("quill");
  const Quill = QuillModule.default || QuillModule;

  return new Quill(document.createElement("div"));
}

// ------------------ TXT ------------------

async function convertTxtToDelta(file: File) {
  const text = await file.text();

  const quill = await createQuill();
  quill.setText(text);

  return quill.getContents();
}

// ------------------ DOCX → HTML → Delta (BEST PATH) ------------------

async function convertDocxToDelta(file: File) {
  const arrayBuffer = await file.arrayBuffer();

  const result = await mammoth.convertToHtml({ arrayBuffer });

  const quill = await createQuill();
  quill.clipboard.dangerouslyPasteHTML(result.value);

  return quill.getContents();
}

// ------------------ PDF → STRUCTURED HTML → DELTA ------------------

async function convertPdfToDelta(file: File) {
  // ✅ dynamic import (prevents SSR/Turbopack crashes)
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // ✅ stable worker setup (NO CDN, NO missing file issues)
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const arrayBuffer = await file.arrayBuffer();

  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let html = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    // 🔥 better structure than raw join
    const items = textContent.items.map((item: any) => ({
      text: item.str,
      x: item.transform[4],
      y: item.transform[5],
    }));

    // group by Y-axis (lines)
    const lines = new Map<number, any[]>();

    for (const item of items) {
      const y = Math.round(item.y / 5) * 5; // normalize spacing
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y)!.push(item);
    }

    const sortedLines = Array.from(lines.entries())
      .sort((a, b) => b[0] - a[0]) // top → bottom
      .map(([_, lineItems]) =>
        lineItems
          .sort((a, b) => a.x - b.x) // left → right
          .map(i => i.text)
          .join(" ")
      );

    // wrap page into HTML
    html += `<p>${sortedLines.join("<br/>")}</p>`;
  }

  const quill = await createQuill();
  quill.clipboard.dangerouslyPasteHTML(html);

  return quill.getContents();
}