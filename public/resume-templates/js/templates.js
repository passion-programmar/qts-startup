/* =============================================================================
   Template registry and layout options, shared by render.js and the gallery.

   A template is two things:
     1. templates/<id>.css: fonts, sizes and accent colour (design tokens only)
     2. defaults (below): how each part of the resume and letter is laid out
   Every default can be overridden per resume from the JSON (theme.<option>)
   or, for previews, a URL parameter with the same name.

   The registry retains every template so saved documents keep rendering. Only
   ACTIVE_RESUME_TEMPLATE_IDS are offered for new selections and Generation rotation.
   ========================================================================== */
(() => {
  const FONTS = ["arial", "georgia", "times", "calibri", "cambria", "palatino", "verdana", "tahoma", "trebuchet", "mono"];

  window.RESUME_OPTIONS = {
    headerAlign: { label: "Header alignment", values: ["start", "center"] },
    headerStyle: {
      label: "Header",
      values: ["plain-rule", "accent-top", "band", "side-bar", "centered-rules", "centered-plain"],
    },
    contactStyle: { label: "Contact line", values: ["inline"] },
    titleStyle: {
      label: "Section titles",
      values: ["rule", "plain", "band", "bar", "pill", "flanked", "topline", "double", "overbar", "underbar", "marker", "underline"],
    },
    titleCase: { label: "Title case", values: ["upper", "title", "lower"] },
    // Every template uses C (role and dates, then company and location): each part stands apart,
    // which ATS parsers need to tell the job title, company and dates apart.
    entryLayout: { label: "Entry layout", values: ["A", "B", "C", "D", "E", "F", "G"] },
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

  const template = (id, name, description, fonts, defaults) => ({ id, name, description, fonts, defaults });

  window.RESUME_TEMPLATES = [
    template("startup", "QTS Template 1",
      "Experience, Projects, Skills, Education · role and dates, then company and location · rows skills",
      "Arimo", {
        entryLayout: "C", headerStyle: "centered-plain", headerAlign: "center", contactStyle: "inline", titleStyle: "underline", titleCase: "upper", bulletStyle: "disc", itemStyle: "bordered", summaryStyle: "boxed", skillsLayout: "rows", skillDetail: "bracket", letterLayout: "block",
      }),
    template("centered", "QTS Template 4",
      "Skills, Experience, Projects, Education · role and dates, then company and location · compact skills",
      "Gelasio + Arimo", {
        entryLayout: "C", headerStyle: "centered-rules", headerAlign: "center", contactStyle: "inline", titleStyle: "band", titleCase: "title", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "plain", skillsLayout: "rows", skillDetail: "dash", letterLayout: "modified",
      }),
    template("corporate", "QTS Template 5",
      "Education, Experience, Projects, Skills · role and dates, then company and location · rows skills",
      "Fira Sans", {
        entryLayout: "C", headerStyle: "side-bar", headerAlign: "start", contactStyle: "inline", titleStyle: "underbar", titleCase: "upper", bulletStyle: "disc", itemStyle: "bordered", summaryStyle: "boxed", skillsLayout: "rows", skillDetail: "colon", letterLayout: "block",
      }),
    template("ledger", "QTS Template 8",
      "Education, Skills, Experience, Projects · role and dates, then company and location · rows skills",
      "Tinos", {
        entryLayout: "C", headerStyle: "band", headerAlign: "start", contactStyle: "inline", titleStyle: "underbar", titleCase: "title", bulletStyle: "disc", itemStyle: "divided", summaryStyle: "plain", skillsLayout: "rows", skillDetail: "dash", letterLayout: "block",
      }),
    template("executive", "QTS Template 10",
      "Education, Skills, Experience, Projects · role and dates, then company and location · rows skills",
      "Gelasio + Arimo", {
        entryLayout: "C", headerStyle: "accent-top", headerAlign: "start", contactStyle: "inline", titleStyle: "plain", titleCase: "title", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "quote", skillsLayout: "rows", skillDetail: "bracket", letterLayout: "block",
      }),
    template("graphite", "QTS Template 12",
      "Skills, Experience, Projects, Education · role and dates, then company and location · rows skills",
      "Gelasio + Arimo", {
        entryLayout: "C", headerStyle: "plain-rule", headerAlign: "start", contactStyle: "inline", titleStyle: "band", titleCase: "title", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "quote", skillsLayout: "rows", skillDetail: "bracket", letterLayout: "modified",
      }),
    template("minimal", "QTS Template 2",
      "Experience, Projects, Skills, Education · role and dates, then company and location · compact skills",
      "Carlito", {
        entryLayout: "C", headerStyle: "accent-top", headerAlign: "start", contactStyle: "inline", titleStyle: "bar", titleCase: "upper", bulletStyle: "disc", itemStyle: "bordered", summaryStyle: "plain", skillsLayout: "rows", skillDetail: "dash", letterLayout: "block",
      }),
    template("nordic", "QTS Template 7",
      "Education, Experience, Projects, Skills · role and dates, then company and location · rows skills",
      "DejaVu Sans", {
        entryLayout: "C", headerStyle: "centered-rules", headerAlign: "center", contactStyle: "inline", titleStyle: "marker", titleCase: "upper", bulletStyle: "disc", itemStyle: "divided", summaryStyle: "quote", skillsLayout: "rows", skillDetail: "bracket", letterLayout: "block",
      }),
    template("academic", "QTS Template 11",
      "Education, Skills, Experience, Projects · role and dates, then company and location · rows skills",
      "Caladea", {
        entryLayout: "C", headerStyle: "centered-plain", headerAlign: "center", contactStyle: "inline", titleStyle: "topline", titleCase: "title", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "boxed", skillsLayout: "rows", skillDetail: "colon", letterLayout: "block",
      }),
    template("classic", "QTS Template 3",
      "Education, Skills, Experience, Projects · role and dates, then company and location · rows skills",
      "Carlito + Caladea", {
        entryLayout: "C", headerStyle: "side-bar", headerAlign: "start", contactStyle: "inline", titleStyle: "flanked", titleCase: "title", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "quote", skillsLayout: "rows", skillDetail: "dash", letterLayout: "block",
      }),
    template("qts-standard", "QTS Template 13",
      "Experience, Projects, Skills, Education · role and dates, then company and location · rows skills",
      "Arimo + Gelasio", {
        entryLayout: "C", headerStyle: "plain-rule", headerAlign: "start", contactStyle: "inline", titleStyle: "double", titleCase: "upper", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "plain", skillsLayout: "rows", skillDetail: "colon", letterLayout: "block",
      }),
    template("creative", "QTS Template 6",
      "Education, Experience, Projects, Skills · role and dates, then company and location · rows skills",
      "Arimo + Archivo Black", {
        entryLayout: "C", headerStyle: "plain-rule", headerAlign: "start", contactStyle: "inline", titleStyle: "rule", titleCase: "upper", bulletStyle: "disc", itemStyle: "bordered", summaryStyle: "boxed", skillsLayout: "rows", skillDetail: "colon", letterLayout: "block",
      }),
    template("banded", "QTS Template 9",
      "Education, Skills, Experience, Projects · role and dates, then company and location · rows skills",
      "Carlito + Caladea", {
        entryLayout: "C", headerStyle: "centered-rules", headerAlign: "center", contactStyle: "inline", titleStyle: "bar", titleCase: "title", bulletStyle: "disc", itemStyle: "divided", summaryStyle: "plain", skillsLayout: "rows", skillDetail: "bracket", letterLayout: "block",
      }),
  ];
  window.ACTIVE_RESUME_TEMPLATE_IDS = [
    "startup", "minimal", "classic", "centered", "corporate", "creative",
    "nordic", "ledger", "banded", "executive", "academic", "graphite", "qts-standard",
  ];
})();
