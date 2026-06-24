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
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.js");

  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";

  const arrayBuffer = await file.arrayBuffer();

  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let html = "";

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();

    const items = textContent.items.map((item: any) => ({
      text: item.str,
      x: item.transform[4],
      y: item.transform[5],
    }));

    const lines = new Map<number, any[]>();

    for (const item of items) {
      const y = Math.round(item.y / 5) * 5;

      if (!lines.has(y)) {
        lines.set(y, []);
      }

      lines.get(y)!.push(item);
    }

    const sortedLines = Array.from(lines.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([_, lineItems]) =>
        lineItems
          .sort((a, b) => a.x - b.x)
          .map((lineItem: any) => lineItem.text)
          .join(" ")
      );

    html += `<p>${sortedLines.join("<br/>")}</p>`;
  }

  const quill = await createQuill();
  quill.clipboard.dangerouslyPasteHTML(html);

  return quill.getContents();
}