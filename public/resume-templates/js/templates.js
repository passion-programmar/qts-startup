/* =============================================================================
   Template registry and layout options, shared by render.js and the gallery.

   A template is two things:
     1. templates/<id>.css: fonts, colours, sizes and header decoration
     2. defaults (below): how each part of the resume and letter is laid out
   Every default can be overridden per resume from the JSON (theme.<option>)
   or, for previews, a URL parameter with the same name.

   To add a template: create the CSS file, add an entry here, and add the id
   to theme.template in data/resume.schema.json.
   ========================================================================== */
(() => {
  const FONTS = ["arial", "georgia", "times", "calibri", "cambria", "palatino", "verdana", "tahoma", "trebuchet", "mono"];

  window.RESUME_OPTIONS = {
    headerAlign: { label: "Header alignment", values: ["start", "center"] },
    contactStyle: { label: "Contact line", values: ["inline", "labeled"] },
    titleStyle: {
      label: "Section titles",
      values: ["rule", "plain", "band", "bar", "pill", "flanked", "topline", "double", "overbar", "underbar", "marker", "underline"],
    },
    titleCase: { label: "Title case", values: ["upper", "title", "lower"] },
    datePosition: { label: "Dates", values: ["inline", "below", "parentheses"] },
    bulletStyle: { label: "Bullets", values: ["disc", "dash", "chevron"] },
    itemStyle: { label: "Entries", values: ["plain", "divided", "timeline", "bordered"] },
    summaryStyle: { label: "Summary", values: ["plain", "boxed", "quote"] },
    skillsLayout: { label: "Skills layout", values: ["rows", "compact", "grid", "bubbles"] },
    skillDetail: { label: "Skill details", values: ["colon", "dash", "bracket"] },
    letterLayout: { label: "Letter layout", values: ["block", "modified"] },
    fontFamily: { label: "Body font", values: FONTS },
    headingFont: { label: "Heading font", values: FONTS },
    density: { label: "Density", values: ["auto", "normal", "compact"] },
  };

  const template = (id, name, description, fonts, bestFor, defaults) => ({ id, name, description, fonts, bestFor, defaults });

  window.RESUME_TEMPLATES = [
    template("qts-standard", "QTS Standard",
      "Navy accent rule, ruled uppercase titles, skill rows with bracketed details. The default.",
      "Arial", "Any role", {
        headerAlign: "start", contactStyle: "inline", titleStyle: "rule", titleCase: "upper",
        datePosition: "inline", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "plain",
        skillsLayout: "rows", skillDetail: "bracket", letterLayout: "block",
      }),
    template("classic", "Classic",
      "Black serif, double rule, dates in parentheses, skills as one flowing paragraph.",
      "Georgia", "Law, finance, administration", {
        headerAlign: "start", contactStyle: "inline", titleStyle: "rule", titleCase: "title",
        datePosition: "parentheses", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "plain",
        skillsLayout: "compact", skillDetail: "bracket", letterLayout: "modified",
      }),
    template("harvard", "Harvard",
      "Monochrome Times with a centred header, em-dash dates and skill rows with dashed details.",
      "Times New Roman", "Graduates, consulting, banking", {
        headerAlign: "center", contactStyle: "inline", titleStyle: "rule", titleCase: "upper",
        datePosition: "inline", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "plain",
        skillsLayout: "rows", skillDetail: "dash", letterLayout: "block",
      }),
    template("executive", "Executive",
      "Burgundy accent bars, labelled contacts, divided entries, a quoted summary and a skills grid.",
      "Georgia + Arial", "Senior and leadership roles", {
        headerAlign: "start", contactStyle: "labeled", titleStyle: "underbar", titleCase: "upper",
        datePosition: "inline", bulletStyle: "dash", itemStyle: "divided", summaryStyle: "quote",
        skillsLayout: "grid", skillDetail: "dash", letterLayout: "modified",
      }),
    template("minimal", "Minimal",
      "No rules, wide margins, quiet grey titles, dates on their own line and compact skills.",
      "Arial", "Design-aware and research roles", {
        headerAlign: "start", contactStyle: "inline", titleStyle: "plain", titleCase: "upper",
        datePosition: "below", bulletStyle: "dash", itemStyle: "plain", summaryStyle: "plain",
        skillsLayout: "compact", skillDetail: "dash", letterLayout: "block",
      }),
    template("swiss", "Swiss",
      "Oversized name, a red rule opening every section and a four-column skills grid.",
      "Arial", "Marketing, product, communications", {
        headerAlign: "start", contactStyle: "inline", titleStyle: "topline", titleCase: "title",
        datePosition: "inline", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "plain",
        skillsLayout: "grid", skillDetail: "colon", letterLayout: "block",
      }),
    template("corporate", "Corporate",
      "Tinted header panel, labelled contacts, accent bars on titles and a boxed summary.",
      "Calibri", "Corporate, sales, operations", {
        headerAlign: "start", contactStyle: "labeled", titleStyle: "bar", titleCase: "upper",
        datePosition: "inline", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "boxed",
        skillsLayout: "rows", skillDetail: "bracket", letterLayout: "block",
      }),
    template("technical", "Technical",
      "Monospaced lowercase titles, dashed rules, chevron bullets and outlined skill tags.",
      "Arial + Consolas", "Software, data, IT", {
        headerAlign: "start", contactStyle: "inline", titleStyle: "rule", titleCase: "lower",
        datePosition: "inline", bulletStyle: "chevron", itemStyle: "plain", summaryStyle: "plain",
        skillsLayout: "bubbles", skillDetail: "bracket", letterLayout: "block",
      }),
    template("timeline", "Timeline",
      "A vertical line with markers links each entry; accent dates below titles; skill tags.",
      "Trebuchet MS", "Career progression stories", {
        headerAlign: "start", contactStyle: "inline", titleStyle: "plain", titleCase: "upper",
        datePosition: "below", bulletStyle: "disc", itemStyle: "timeline", summaryStyle: "plain",
        skillsLayout: "bubbles", skillDetail: "dash", letterLayout: "block",
      }),
    template("banded", "Banded",
      "Section titles on tinted bands for fast scanning, with skill rows.",
      "Arial", "Operations, logistics, healthcare", {
        headerAlign: "start", contactStyle: "inline", titleStyle: "band", titleCase: "upper",
        datePosition: "inline", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "plain",
        skillsLayout: "rows", skillDetail: "dash", letterLayout: "block",
      }),
    template("elegant", "Elegant",
      "Palatino, a centred header, titles between hairlines and dash bullets.",
      "Palatino", "Hospitality, arts, education", {
        headerAlign: "center", contactStyle: "inline", titleStyle: "flanked", titleCase: "title",
        datePosition: "inline", bulletStyle: "dash", itemStyle: "plain", summaryStyle: "plain",
        skillsLayout: "compact", skillDetail: "bracket", letterLayout: "modified",
      }),
    template("bold", "Bold",
      "Heavy name, thick orange bar, large titles, accent-bordered entries and skill tags.",
      "Arial Black + Arial", "Sales, startups, creative leads", {
        headerAlign: "start", contactStyle: "inline", titleStyle: "plain", titleCase: "title",
        datePosition: "inline", bulletStyle: "disc", itemStyle: "bordered", summaryStyle: "plain",
        skillsLayout: "bubbles", skillDetail: "colon", letterLayout: "block",
      }),
    template("creative", "Creative",
      "Raspberry accent bar under the name, square title markers, a boxed summary and skill tags.",
      "Trebuchet MS", "Creative and customer-facing roles", {
        headerAlign: "start", contactStyle: "inline", titleStyle: "marker", titleCase: "title",
        datePosition: "inline", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "boxed",
        skillsLayout: "bubbles", skillDetail: "bracket", letterLayout: "block",
      }),
    template("compact", "Compact",
      "Tight spacing and margins for long careers, at a readable 10pt, with compact skills.",
      "Arial", "Experienced candidates with long histories", {
        headerAlign: "start", contactStyle: "inline", titleStyle: "rule", titleCase: "upper",
        datePosition: "inline", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "plain",
        skillsLayout: "compact", skillDetail: "dash", letterLayout: "block",
      }),
    template("academic", "Academic",
      "CV style in Cambria: centred header, titles between two rules, italic dates below titles.",
      "Cambria", "Research, teaching, publications", {
        headerAlign: "center", contactStyle: "inline", titleStyle: "double", titleCase: "upper",
        datePosition: "below", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "plain",
        skillsLayout: "rows", skillDetail: "bracket", letterLayout: "modified",
      }),
    template("nordic", "Nordic",
      "Airy hairlines above sections, regular-weight titles, dash bullets and a skills grid.",
      "Arial", "UX, product, sustainability", {
        headerAlign: "start", contactStyle: "inline", titleStyle: "topline", titleCase: "title",
        datePosition: "inline", bulletStyle: "dash", itemStyle: "plain", summaryStyle: "plain",
        skillsLayout: "grid", skillDetail: "dash", letterLayout: "block",
      }),
    template("slate", "Slate",
      "Slate bar beside the header, labelled contacts, dotted rules and divided entries.",
      "Tahoma", "Engineering, construction, public sector", {
        headerAlign: "start", contactStyle: "labeled", titleStyle: "rule", titleCase: "upper",
        datePosition: "inline", bulletStyle: "disc", itemStyle: "divided", summaryStyle: "plain",
        skillsLayout: "grid", skillDetail: "bracket", letterLayout: "block",
      }),
    template("ledger", "Ledger",
      "Georgia headings, green rules and hairlines between entries, with skill rows.",
      "Georgia + Arial", "Accounting, audit, finance", {
        headerAlign: "start", contactStyle: "inline", titleStyle: "rule", titleCase: "title",
        datePosition: "inline", bulletStyle: "disc", itemStyle: "divided", summaryStyle: "plain",
        skillsLayout: "rows", skillDetail: "dash", letterLayout: "block",
      }),
    template("startup", "Startup",
      "Purple pill titles, a pill headline, a boxed summary and tinted skill tags.",
      "Arial", "Startups, growth, tech", {
        headerAlign: "start", contactStyle: "inline", titleStyle: "pill", titleCase: "title",
        datePosition: "inline", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "boxed",
        skillsLayout: "bubbles", skillDetail: "colon", letterLayout: "block",
      }),
    template("professional", "Professional",
      "Calibri with title-case headings over a blue underline and a three-column skills grid.",
      "Calibri", "Business and management", {
        headerAlign: "start", contactStyle: "inline", titleStyle: "rule", titleCase: "title",
        datePosition: "inline", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "plain",
        skillsLayout: "grid", skillDetail: "colon", letterLayout: "modified",
      }),
    template("centered", "Centered",
      "Symmetrical header and centred, ruled section titles with compact skills.",
      "Arial", "General professional use", {
        headerAlign: "center", contactStyle: "inline", titleStyle: "rule", titleCase: "upper",
        datePosition: "inline", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "plain",
        skillsLayout: "compact", skillDetail: "bracket", letterLayout: "block",
      }),
    template("high-contrast", "High Contrast",
      "Accessibility first: Verdana, pure black, labelled contacts and underlined titles.",
      "Verdana", "Maximum readability, public sector", {
        headerAlign: "start", contactStyle: "labeled", titleStyle: "underline", titleCase: "title",
        datePosition: "inline", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "plain",
        skillsLayout: "rows", skillDetail: "dash", letterLayout: "block",
      }),
    template("modern-serif", "Modern Serif",
      "Cambria titles under short teal bars, accent-bordered entries, a quoted summary and a skills grid.",
      "Cambria + Calibri", "Consulting, policy, communications", {
        headerAlign: "start", contactStyle: "inline", titleStyle: "overbar", titleCase: "title",
        datePosition: "inline", bulletStyle: "disc", itemStyle: "bordered", summaryStyle: "quote",
        skillsLayout: "grid", skillDetail: "bracket", letterLayout: "block",
      }),
    template("graphite", "Graphite",
      "Dark grey, titles underlined beneath the words, chevron bullets and grey skill tags.",
      "Arial", "Engineering, architecture, analytics", {
        headerAlign: "start", contactStyle: "inline", titleStyle: "underline", titleCase: "upper",
        datePosition: "inline", bulletStyle: "chevron", itemStyle: "plain", summaryStyle: "plain",
        skillsLayout: "bubbles", skillDetail: "dash", letterLayout: "modified",
      }),
  ];
})();
