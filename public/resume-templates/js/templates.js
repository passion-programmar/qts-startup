/* =============================================================================
   Template registry and layout options, shared by render.js and the gallery.

   A template is two things:
     1. templates/<id>.css: fonts, sizes and accent colour (design tokens only)
     2. defaults (below): how each part of the resume and letter is laid out
   Every default can be overridden per resume from the JSON (theme.<option>)
   or, for previews, a URL parameter with the same name.

   The 24 templates are listed by number ("QTS Template 1" ... "24"), which is
   also the order Generation rotates through them. Each one's section order is
   in src/app/pdf/resume-sections.ts: the summary, then Experience, Selected Projects,
   Skills and Education in one of four orders, taken in turn so neighbours differ.
   ========================================================================== */
(() => {
  const FONTS = ["arial", "georgia", "times", "calibri", "cambria", "palatino", "verdana", "tahoma", "trebuchet", "mono"];

  window.RESUME_OPTIONS = {
    headerAlign: { label: "Header alignment", values: ["start", "center"] },
    headerStyle: {
      label: "Header",
      values: ["plain-rule", "accent-top", "band", "side-bar", "centered-rules", "centered-plain"],
    },
    contactStyle: { label: "Contact line", values: ["inline", "labeled"] },
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
    template("centered", "QTS Template 2",
      "Skills, Experience, Projects, Education · role and dates, then company and location · compact skills",
      "Gelasio + Arimo", {
        entryLayout: "C", headerStyle: "centered-rules", headerAlign: "center", contactStyle: "inline", titleStyle: "band", titleCase: "title", bulletStyle: "disc", itemStyle: "bordered", summaryStyle: "quote", skillsLayout: "compact", skillDetail: "dash", letterLayout: "modified",
      }),
    template("corporate", "QTS Template 3",
      "Education, Experience, Projects, Skills · role and dates, then company and location · rows skills",
      "Fira Sans", {
        entryLayout: "C", headerStyle: "side-bar", headerAlign: "start", contactStyle: "inline", titleStyle: "underbar", titleCase: "upper", bulletStyle: "disc", itemStyle: "bordered", summaryStyle: "boxed", skillsLayout: "rows", skillDetail: "colon", letterLayout: "block",
      }),
    template("ledger", "QTS Template 4",
      "Education, Skills, Experience, Projects · role and dates, then company and location · rows skills",
      "Tinos", {
        entryLayout: "C", headerStyle: "band", headerAlign: "start", contactStyle: "labeled", titleStyle: "underbar", titleCase: "title", bulletStyle: "disc", itemStyle: "divided", summaryStyle: "plain", skillsLayout: "rows", skillDetail: "dash", letterLayout: "block",
      }),
    template("bold", "QTS Template 5",
      "Experience, Projects, Skills, Education · role and dates, then company and location · tags skills",
      "Arimo + Archivo Black", {
        entryLayout: "C", headerStyle: "centered-plain", headerAlign: "center", contactStyle: "inline", titleStyle: "double", titleCase: "upper", bulletStyle: "disc", itemStyle: "divided", summaryStyle: "plain", skillsLayout: "bubbles", skillDetail: "colon", letterLayout: "block",
      }),
    template("technical", "QTS Template 6",
      "Skills, Experience, Projects, Education · role and dates, then company and location · compact skills",
      "Carlito + Caladea", {
        entryLayout: "C", headerStyle: "plain-rule", headerAlign: "start", contactStyle: "inline", titleStyle: "topline", titleCase: "title", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "boxed", skillsLayout: "compact", skillDetail: "bracket", letterLayout: "modified",
      }),
    template("professional", "QTS Template 7",
      "Education, Experience, Projects, Skills · role and dates, then company and location · compact skills",
      "Tinos", {
        entryLayout: "C", headerStyle: "band", headerAlign: "start", contactStyle: "labeled", titleStyle: "rule", titleCase: "upper", bulletStyle: "disc", itemStyle: "divided", summaryStyle: "plain", skillsLayout: "compact", skillDetail: "colon", letterLayout: "block",
      }),
    template("executive", "QTS Template 8",
      "Education, Skills, Experience, Projects · role and dates, then company and location · rows skills",
      "Gelasio + Arimo", {
        entryLayout: "C", headerStyle: "accent-top", headerAlign: "start", contactStyle: "inline", titleStyle: "plain", titleCase: "title", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "quote", skillsLayout: "rows", skillDetail: "bracket", letterLayout: "block",
      }),
    template("timeline", "QTS Template 9",
      "Experience, Projects, Skills, Education · role and dates, then company and location · tags skills",
      "Gelasio", {
        entryLayout: "C", headerStyle: "side-bar", headerAlign: "start", contactStyle: "inline", titleStyle: "pill", titleCase: "upper", bulletStyle: "disc", itemStyle: "timeline", summaryStyle: "plain", skillsLayout: "bubbles", skillDetail: "dash", letterLayout: "block",
      }),
    template("graphite", "QTS Template 10",
      "Skills, Experience, Projects, Education · role and dates, then company and location · rows skills",
      "Gelasio + Arimo", {
        entryLayout: "C", headerStyle: "plain-rule", headerAlign: "start", contactStyle: "labeled", titleStyle: "band", titleCase: "title", bulletStyle: "disc", itemStyle: "timeline", summaryStyle: "quote", skillsLayout: "rows", skillDetail: "bracket", letterLayout: "modified",
      }),
    template("modern-serif", "QTS Template 11",
      "Education, Experience, Projects, Skills · role and dates, then company and location · tags skills",
      "DejaVu Sans", {
        entryLayout: "C", headerStyle: "side-bar", headerAlign: "start", contactStyle: "inline", titleStyle: "flanked", titleCase: "upper", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "plain", skillsLayout: "bubbles", skillDetail: "dash", letterLayout: "block",
      }),
    template("compact", "QTS Template 12",
      "Education, Skills, Experience, Projects · role and dates, then company and location · compact skills",
      "Fira Sans + Archivo Black", {
        entryLayout: "C", headerStyle: "centered-rules", headerAlign: "center", contactStyle: "inline", titleStyle: "underline", titleCase: "title", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "boxed", skillsLayout: "compact", skillDetail: "colon", letterLayout: "block",
      }),
    template("minimal", "QTS Template 13",
      "Experience, Projects, Skills, Education · role and dates, then company and location · compact skills",
      "Carlito", {
        entryLayout: "C", headerStyle: "accent-top", headerAlign: "start", contactStyle: "labeled", titleStyle: "bar", titleCase: "upper", bulletStyle: "disc", itemStyle: "bordered", summaryStyle: "plain", skillsLayout: "compact", skillDetail: "dash", letterLayout: "block",
      }),
    template("harvard", "QTS Template 14",
      "Skills, Experience, Projects, Education · role and dates, then company and location · compact skills",
      "Tinos", {
        entryLayout: "C", headerStyle: "side-bar", headerAlign: "start", contactStyle: "inline", titleStyle: "overbar", titleCase: "title", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "boxed", skillsLayout: "compact", skillDetail: "colon", letterLayout: "modified",
      }),
    template("nordic", "QTS Template 15",
      "Education, Experience, Projects, Skills · role and dates, then company and location · rows skills",
      "DejaVu Sans", {
        entryLayout: "C", headerStyle: "centered-rules", headerAlign: "center", contactStyle: "inline", titleStyle: "marker", titleCase: "upper", bulletStyle: "disc", itemStyle: "divided", summaryStyle: "quote", skillsLayout: "rows", skillDetail: "bracket", letterLayout: "block",
      }),
    template("academic", "QTS Template 16",
      "Education, Skills, Experience, Projects · role and dates, then company and location · rows skills",
      "Caladea", {
        entryLayout: "C", headerStyle: "centered-plain", headerAlign: "center", contactStyle: "inline", titleStyle: "topline", titleCase: "title", bulletStyle: "disc", itemStyle: "timeline", summaryStyle: "boxed", skillsLayout: "rows", skillDetail: "colon", letterLayout: "block",
      }),
    template("swiss", "QTS Template 17",
      "Experience, Projects, Skills, Education · role and dates, then company and location · tags skills",
      "DejaVu Sans", {
        entryLayout: "C", headerStyle: "accent-top", headerAlign: "start", contactStyle: "inline", titleStyle: "marker", titleCase: "upper", bulletStyle: "disc", itemStyle: "bordered", summaryStyle: "plain", skillsLayout: "bubbles", skillDetail: "bracket", letterLayout: "block",
      }),
    template("slate", "QTS Template 18",
      "Skills, Experience, Projects, Education · role and dates, then company and location · tags skills",
      "Fira Sans + Archivo Black", {
        entryLayout: "C", headerStyle: "band", headerAlign: "start", contactStyle: "inline", titleStyle: "pill", titleCase: "title", bulletStyle: "disc", itemStyle: "timeline", summaryStyle: "quote", skillsLayout: "bubbles", skillDetail: "dash", letterLayout: "modified",
      }),
    template("high-contrast", "QTS Template 19",
      "Education, Experience, Projects, Skills · role and dates, then company and location · tags skills",
      "Caladea", {
        entryLayout: "C", headerStyle: "centered-rules", headerAlign: "center", contactStyle: "inline", titleStyle: "plain", titleCase: "upper", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "plain", skillsLayout: "bubbles", skillDetail: "bracket", letterLayout: "block",
      }),
    template("classic", "QTS Template 20",
      "Education, Skills, Experience, Projects · role and dates, then company and location · rows skills",
      "Carlito + Caladea", {
        entryLayout: "C", headerStyle: "side-bar", headerAlign: "start", contactStyle: "inline", titleStyle: "flanked", titleCase: "title", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "quote", skillsLayout: "rows", skillDetail: "dash", letterLayout: "block",
      }),
    template("qts-standard", "QTS Template 21",
      "Experience, Projects, Skills, Education · role and dates, then company and location · rows skills",
      "Arimo + Gelasio", {
        entryLayout: "C", headerStyle: "plain-rule", headerAlign: "start", contactStyle: "inline", titleStyle: "double", titleCase: "upper", bulletStyle: "disc", itemStyle: "plain", summaryStyle: "plain", skillsLayout: "rows", skillDetail: "colon", letterLayout: "block",
      }),
    template("elegant", "QTS Template 22",
      "Skills, Experience, Projects, Education · role and dates, then company and location · rows skills",
      "Caladea", {
        entryLayout: "C", headerStyle: "band", headerAlign: "start", contactStyle: "labeled", titleStyle: "overbar", titleCase: "title", bulletStyle: "disc", itemStyle: "divided", summaryStyle: "quote", skillsLayout: "rows", skillDetail: "dash", letterLayout: "modified",
      }),
    template("creative", "QTS Template 23",
      "Education, Experience, Projects, Skills · role and dates, then company and location · rows skills",
      "Arimo + Archivo Black", {
        entryLayout: "C", headerStyle: "plain-rule", headerAlign: "start", contactStyle: "inline", titleStyle: "rule", titleCase: "upper", bulletStyle: "disc", itemStyle: "bordered", summaryStyle: "boxed", skillsLayout: "rows", skillDetail: "colon", letterLayout: "block",
      }),
    template("banded", "QTS Template 24",
      "Education, Skills, Experience, Projects · role and dates, then company and location · rows skills",
      "Carlito + Caladea", {
        entryLayout: "C", headerStyle: "centered-rules", headerAlign: "center", contactStyle: "inline", titleStyle: "bar", titleCase: "title", bulletStyle: "disc", itemStyle: "divided", summaryStyle: "plain", skillsLayout: "rows", skillDetail: "bracket", letterLayout: "block",
      }),
  ];
})();
