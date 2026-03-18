// generate_docx.js — reads session JSON from stdin, writes DOCX binary to stdout
// Run: echo '{"session":{...},"iterations":[...]}' | node generate_docx.js

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, BorderStyle, WidthType,
  ShadingType, VerticalAlign, PageNumber, PageBreak, HeadingLevel,
} = require('/opt/homebrew/lib/node_modules/docx');

// ── helpers ─────────────────────────────────────────────────────────────────

const BLUE    = "1A3A5C";
const LBLUE   = "D6E4F0";
const GREEN   = "00A86B";
const ORANGE  = "E87722";
const RED     = "CC2936";
const GRAY_BG = "F4F6F8";
const GRAY_LINE="D0D5DB";
const WHITE   = "FFFFFF";
const BLACK   = "1A1A2E";

function scoreColor(v) {
  if (v >= 7) return GREEN;
  if (v >= 5) return ORANGE;
  return RED;
}

function scoreBar(v) {
  const filled = Math.round(v);           // 1-10
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

function msToStr(ms) {
  if (!ms) return "-";
  return ms > 1000 ? (ms/1000).toFixed(1) + "s" : ms + "ms";
}

function safeTxt(s) {
  return (s || "").replace(/\r?\n/g, " ").trim();
}

// ── border helpers ───────────────────────────────────────────────────────────

const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
const cellBorder = (color) => ({ style: BorderStyle.SINGLE, size: 4, color });
const allBorders = (color) => ({ top: cellBorder(color), bottom: cellBorder(color), left: cellBorder(color), right: cellBorder(color) });
const bottomBorder = (color, size=6) => ({ top: noBorder, bottom: { style: BorderStyle.SINGLE, size, color }, left: noBorder, right: noBorder });

// ── paragraph factories ──────────────────────────────────────────────────────

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, font: "Arial", size: 32, bold: true, color: BLUE })],
    spacing: { before: 400, after: 200 },
    border: bottomBorder(BLUE, 8),
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, font: "Arial", size: 24, bold: true, color: BLUE })],
    spacing: { before: 280, after: 120 },
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text, font: "Arial", size: 20, bold: true, color: "2E6DA4" })],
    spacing: { before: 200, after: 80 },
  });
}

function body(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text: text || "", font: "Arial", size: 22, color: BLACK, ...opts })],
    spacing: { before: 60, after: 60 },
  });
}

function mono(text) {
  // multi-line: split on newlines
  const lines = (text || "").split(/\r?\n/);
  return lines.map((line, i) => new Paragraph({
    children: [new TextRun({ text: line, font: "Courier New", size: 18, color: "333344" })],
    spacing: { before: i === 0 ? 60 : 0, after: i === lines.length-1 ? 60 : 0 },
    indent: { left: 240 },
  }));
}

function spacer() {
  return new Paragraph({ children: [new TextRun("")], spacing: { before: 120, after: 60 } });
}

function divider() {
  return new Paragraph({
    children: [new TextRun("")],
    border: bottomBorder(GRAY_LINE, 4),
    spacing: { before: 160, after: 160 },
  });
}

function labelValue(label, value) {
  return new Paragraph({
    children: [
      new TextRun({ text: label + ": ", font: "Arial", size: 20, bold: true, color: BLUE }),
      new TextRun({ text: value || "-", font: "Arial", size: 20, color: BLACK }),
    ],
    spacing: { before: 60, after: 60 },
  });
}

// Colored box (shaded background)
function boxPara(text, bgColor, textColor = BLACK, font = "Courier New", size = 18) {
  const lines = (text || "").split(/\r?\n/);
  return lines.map((line, i) => new Paragraph({
    children: [new TextRun({ text: line || " ", font, size, color: textColor })],
    shading: { type: ShadingType.CLEAR, fill: bgColor },
    spacing: { before: i === 0 ? 80 : 0, after: i === lines.length - 1 ? 80 : 0 },
    indent: { left: 200, right: 200 },
  }));
}

// Big score display
function bigScore(score, label) {
  const color = scoreColor(score);
  return new Paragraph({
    children: [
      new TextRun({ text: score.toFixed(1), font: "Arial", size: 72, bold: true, color }),
      new TextRun({ text: "/10", font: "Arial", size: 32, color: "888899" }),
      new TextRun({ text: "  " + label, font: "Arial", size: 24, color: "555566" }),
    ],
    spacing: { before: 100, after: 100 },
  });
}

// ── score table ──────────────────────────────────────────────────────────────

function scoreTable(scores) {
  const COL = [2800, 800, 2700, 2726]; // sum = 9026 (A4 content width)
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      mkCell("Szempont", COL[0], BLUE, "FFFFFF", true),
      mkCell("Pont", COL[1], BLUE, "FFFFFF", true, "center"),
      mkCell("Vizuális", COL[2], BLUE, "FFFFFF", true),
      mkCell("Minősítés", COL[3], BLUE, "FFFFFF", true),
    ],
  });

  const rows = Object.entries(scores).map(([key, val]) => {
    const color = scoreColor(val);
    return new TableRow({
      children: [
        mkCell(key, COL[0], GRAY_BG, BLACK),
        mkCell(String(val), COL[1], WHITE, color, true, "center"),
        mkCell(scoreBar(val), COL[2], WHITE, color, false, "left", "Courier New", 16),
        mkCell(val >= 7 ? "Kiváló" : val >= 5 ? "Átlagos" : "Fejlesztendő", COL[3], WHITE, color),
      ],
    });
  });

  return new Table({
    width: { size: 9026, type: WidthType.DXA },
    columnWidths: COL,
    rows: [headerRow, ...rows],
  });
}

function mkCell(text, width, bgFill, textColor, bold = false, align = "left", font = "Arial", size = 20) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: bgFill },
    borders: allBorders(GRAY_LINE),
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      alignment: align === "center" ? AlignmentType.CENTER : AlignmentType.LEFT,
      children: [new TextRun({ text, font, size, bold, color: textColor })],
    })],
  });
}

// ── score progress table ─────────────────────────────────────────────────────

function summaryTable(iterations) {
  const COL = [1200, 1200, 1600, 5026]; // sum = 9026
  const header = new TableRow({
    tableHeader: true,
    children: [
      mkCell("Iteráció", COL[0], BLUE, "FFFFFF", true, "center"),
      mkCell("Pontszám", COL[1], BLUE, "FFFFFF", true, "center"),
      mkCell("Változás", COL[2], BLUE, "FFFFFF", true, "center"),
      mkCell("Prompt (első 80 kar.)", COL[3], BLUE, "FFFFFF", true),
    ],
  });

  const rows = iterations.map((it, i) => {
    const score = it.overall_score || 0;
    const prev  = i > 0 ? (iterations[i-1].overall_score || 0) : null;
    const diff  = prev !== null ? (score - prev) : null;
    const diffStr = diff === null ? "-" : (diff >= 0 ? "+" : "") + diff.toFixed(1);
    const diffColor = diff === null ? BLACK : diff > 0 ? GREEN : diff < 0 ? RED : BLACK;
    const promptPreview = (it.prompt_text || "").slice(0, 80) + ((it.prompt_text||"").length > 80 ? "..." : "");

    return new TableRow({
      children: [
        mkCell(String(it.iteration_num), COL[0], GRAY_BG, BLACK, false, "center"),
        mkCell(score.toFixed(1), COL[1], WHITE, scoreColor(score), true, "center"),
        mkCell(diffStr, COL[2], WHITE, diffColor, true, "center"),
        mkCell(promptPreview, COL[3], WHITE, BLACK),
      ],
    });
  });

  return new Table({ width: { size: 9026, type: WidthType.DXA }, columnWidths: COL, rows: [header, ...rows] });
}

// ── bullet list helper ───────────────────────────────────────────────────────

function bulletItems(items, color = BLACK) {
  if (!items || !items.length) return [];
  return items.map(item => new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    children: [new TextRun({ text: item, font: "Arial", size: 20, color })],
    spacing: { before: 40, after: 40 },
  }));
}

// ── main document builder ────────────────────────────────────────────────────

function buildDoc(session, iterations) {
  const date = session.created_at
    ? new Date(session.created_at).toLocaleString("hu-HU")
    : new Date().toLocaleString("hu-HU");

  let evalCriteria = [];
  try { evalCriteria = JSON.parse(session.evaluation_criteria || "[]"); } catch(_) {}

  const children = [];

  // ── TITLE ──
  children.push(new Paragraph({
    children: [new TextRun({ text: "Iteratív PromptAI", font: "Arial", size: 56, bold: true, color: BLUE })],
    spacing: { before: 0, after: 80 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: "Session Riport", font: "Arial", size: 36, color: "4A6FA5" })],
    spacing: { before: 0, after: 240 },
    border: bottomBorder(LBLUE, 6),
  }));
  children.push(spacer());
  children.push(labelValue("Session ID",    session.session_id));
  children.push(labelValue("Dátum",         date));
  children.push(labelValue("Preset",        session.preset_name || "egyéni"));
  children.push(labelValue("Mód",           session.mode === "auto" ? "Automata" : "Lépésenkénti"));
  children.push(labelValue("Generátor",     session.generator_model));
  children.push(labelValue("Értékelő",      session.evaluator_model));
  children.push(labelValue("Finomító",      session.refiner_model));
  children.push(labelValue("Max iteráció",  String(session.max_iterations || "-")));
  children.push(labelValue("Iterációk",     String(iterations.length)));

  // Scores summary inline
  const scores = iterations.map(it => it.overall_score).filter(Boolean);
  if (scores.length > 0) {
    children.push(labelValue("Induló pontszám",   scores[0].toFixed(1) + "/10"));
    children.push(labelValue("Végső pontszám",    scores[scores.length-1].toFixed(1) + "/10"));
    const imp = scores[scores.length-1] - scores[0];
    children.push(labelValue("Összesített javulás", (imp >= 0 ? "+" : "") + imp.toFixed(1) + " pont"));
  }

  // ── EVALUATOR EXPERT ──
  if (session.domain_detected || session.generated_evaluator_prompt) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(h1("Értékelő Szakértő"));

    if (session.domain_detected) {
      children.push(labelValue("Szakterület", session.domain_detected));
    }
    if (session.expert_title) {
      children.push(new Paragraph({
        children: [new TextRun({ text: session.expert_title, font: "Arial", size: 28, bold: true, color: GREEN })],
        spacing: { before: 80, after: 60 },
      }));
    }
    if (session.expert_description) {
      children.push(body(session.expert_description, { italic: true, color: "555566" }));
    }
    if (evalCriteria.length) {
      children.push(spacer());
      children.push(h3("Értékelési kritériumok"));
      evalCriteria.forEach(c => {
        children.push(new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [new TextRun({ text: c, font: "Arial", size: 20, color: BLACK })],
          spacing: { before: 40, after: 40 },
        }));
      });
    }
    if (session.generated_evaluator_prompt) {
      children.push(spacer());
      children.push(h3("Generált értékelő system prompt"));
      children.push(...boxPara(session.generated_evaluator_prompt, GRAY_BG, "333344", "Courier New", 17));
    }
  }

  // ── ORIGINAL PROMPT ──
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(h1("Induló Prompt"));
  children.push(...boxPara(session.user_prompt, "EEF4FF", BLUE, "Arial", 21));

  // ── ITERATIONS ──
  iterations.forEach((it, idx) => {
    const isLast = idx === iterations.length - 1;
    let evalData = {};
    try { evalData = JSON.parse(it.evaluation_json || "{}"); } catch(_) {}

    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(h1(`${it.iteration_num}. Iteráció`));

    // Timing strip
    children.push(new Paragraph({
      children: [
        new TextRun({ text: "Generálás: ", font: "Arial", size: 18, bold: true, color: "888899" }),
        new TextRun({ text: msToStr(it.generator_ms), font: "Arial", size: 18, color: BLACK }),
        new TextRun({ text: "   Értékelés: ", font: "Arial", size: 18, bold: true, color: "888899" }),
        new TextRun({ text: msToStr(it.evaluator_ms), font: "Arial", size: 18, color: BLACK }),
        new TextRun({ text: "   Finomítás: ", font: "Arial", size: 18, bold: true, color: "888899" }),
        new TextRun({ text: msToStr(it.refiner_ms), font: "Arial", size: 18, color: BLACK }),
      ],
      spacing: { before: 60, after: 120 },
    }));

    // Prompt
    children.push(h2("Prompt"));
    children.push(...boxPara(it.prompt_text, "EEF4FF", BLUE, "Arial", 20));

    // Output
    children.push(h2("Generált Kimenet"));
    children.push(...mono(it.output_text));

    // Evaluation
    children.push(h2("Értékelés"));
    if (evalData.overall !== undefined) {
      const expertLine = evalData._expert_title
        ? `${evalData._expert_title}${evalData._domain ? " · " + evalData._domain : ""}`
        : null;
      if (expertLine) {
        children.push(new Paragraph({
          children: [new TextRun({ text: "🎓 " + expertLine, font: "Arial", size: 20, italic: true, color: "4A6FA5" })],
          spacing: { before: 60, after: 80 },
        }));
      }
      children.push(bigScore(evalData.overall, "összpontszám"));
    }
    if (evalData.scores && Object.keys(evalData.scores).length) {
      children.push(spacer());
      children.push(scoreTable(evalData.scores));
    }
    if (evalData.feedback) {
      children.push(spacer());
      children.push(h3("Visszajelzés"));
      children.push(body(evalData.feedback, { italic: true }));
    }
    if (evalData.strengths && evalData.strengths.length) {
      children.push(spacer());
      children.push(h3("Erősségek"));
      children.push(...bulletItems(evalData.strengths, GREEN));
    }
    if (evalData.weaknesses && evalData.weaknesses.length) {
      children.push(h3("Gyengeségek"));
      children.push(...bulletItems(evalData.weaknesses, ORANGE));
    }
    if (evalData.suggestions && evalData.suggestions.length) {
      children.push(h3("Fejlesztési javaslatok"));
      children.push(...bulletItems(evalData.suggestions, "2E6DA4"));
    }

    // Refined prompt (not on last iteration)
    if (!isLast && it.refined_prompt) {
      children.push(h2("Finomított Prompt (következő iterációhoz)"));
      children.push(...boxPara(it.refined_prompt, "F0FFF4", "1A5C35", "Arial", 20));
    }
  });

  // ── SUMMARY ──
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(h1("Összefoglaló"));

  if (iterations.length > 0) {
    const scores2 = iterations.map(it => it.overall_score || 0);
    const best = iterations.reduce((a, b) => (b.overall_score||0) > (a.overall_score||0) ? b : a);
    const first = scores2[0], last = scores2[scores2.length-1];
    const improvement = last - first;

    children.push(spacer());
    children.push(summaryTable(iterations));
    children.push(spacer());

    children.push(labelValue("Legjobb iteráció",     `${best.iteration_num}. (${(best.overall_score||0).toFixed(1)}/10)`));
    children.push(labelValue("Induló pontszám",      `${first.toFixed(1)}/10`));
    children.push(labelValue("Végső pontszám",       `${last.toFixed(1)}/10`));
    children.push(labelValue("Összesített javulás",  `${improvement >= 0 ? "+" : ""}${improvement.toFixed(1)} pont`));

    // Final prompt highlight
    if (iterations[iterations.length-1].refined_prompt) {
      children.push(spacer());
      children.push(h2("Legjobb / Végső finomított prompt"));
      children.push(...boxPara(iterations[iterations.length-1].refined_prompt || iterations[iterations.length-1].prompt_text, "F0FFF4", "1A5C35", "Arial", 20));
    }
  }

  // ── BUILD DOC ──
  return new Document({
    numbering: {
      config: [{
        reference: "bullets",
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: "\u2022",
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      }],
    },
    styles: {
      default: { document: { run: { font: "Arial", size: 22 } } },
      paragraphStyles: [
        {
          id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 32, bold: true, font: "Arial", color: BLUE },
          paragraph: { spacing: { before: 400, after: 200 }, outlineLevel: 0 },
        },
        {
          id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 24, bold: true, font: "Arial", color: BLUE },
          paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1 },
        },
        {
          id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 20, bold: true, font: "Arial", color: "2E6DA4" },
          paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 },
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // A4
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 }, // ~2cm
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [
              new TextRun({ text: "Iteratív PromptAI  |  Session: " + session.session_id, font: "Arial", size: 16, color: "888899" }),
            ],
            border: bottomBorder(LBLUE, 4),
            spacing: { after: 80 },
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              new TextRun({ text: "Generálva: " + new Date().toLocaleString("hu-HU") + "  |  Oldal: ", font: "Arial", size: 16, color: "888899" }),
              new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 16, color: "888899" }),
            ],
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: LBLUE }, bottom: noBorder, left: noBorder, right: noBorder },
            spacing: { before: 80 },
          })],
        }),
      },
      children,
    }],
  });
}

// ── entry point ──────────────────────────────────────────────────────────────

let inputData = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { inputData += chunk; });
process.stdin.on("end", async () => {
  try {
    const { session, iterations } = JSON.parse(inputData);
    const doc = buildDoc(session, iterations || []);
    const buffer = await Packer.toBuffer(doc);
    process.stdout.write(buffer);
  } catch (err) {
    process.stderr.write("ERROR: " + err.message + "\n" + err.stack + "\n");
    process.exit(1);
  }
});
