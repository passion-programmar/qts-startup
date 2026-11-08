// What an application question means, whatever its wording or language, so a saved answer is found by
// meaning (decision 2026-11-07) and answers are worked out from the candidate's profile. No answer
// values live here: they come from the profile and from the Manager's saved answers (Manager page).
// Used by the extension (Apply) and by the server (the Manager page groups saved answers by meaning).
(function init(global) {
  const clean = (text) => String(text ?? '').normalize('NFKC').toLowerCase().replace(/[‘’`]/g, "'")
    .replace(/\(\s*(required|optional)\s*\)/g, ' ').replace(/[*✱]/g, ' ').replace(/\s+/g, ' ').trim();

  // ---- Topics: one meaning each, any wording. Specific topics come before general ones. ----
  const TOPICS = [
    { id: 'languageLevels', title: 'Language levels', test: /^(languages?|language levels?|language skills|languages and levels|j[eę]zyki)$/ },
    // Consent to be kept for other or future jobs (talent pool); pure marketing is never this.
    { id: 'futureConsent', title: 'Keep my data for future jobs', test: /\b(future|other|new|upcoming) (recruitment|jobs?|roles?|opportunit\w*|vacanc\w*|positions?|openings?)\b(?!.*\b(newsletter|marketing|promotion))|\btalent (pool|community|network|database)\b/ },
    { id: 'skillYears', title: 'Years with a skill', object: true, test: /years.{0,40}\b(with|in|using|of experience (with|in))\s|how many years.{0,60}\b(with|in|using)\b|lat do[sś]wiadczenia (z|w)\b/ },
    { id: 'skillExperience', title: 'Experience with a skill', object: true, test: /\b(do you have|have you|are you|rate your|level of|describe your)\b.{0,60}\b(experience|familiar|worked with|knowledge|proficien|hands-on|expertise|certified|skills?)\b/ },
    { id: 'currentSalary', title: 'Current salary', test: /\bcurrent (salary|compensation|remuneration|pay)\b|aktualne wynagrodzenie|derzeitiges gehalt/ },
    { id: 'salary', title: 'Salary expectation', test: /salary|compensation|remuneration|pay expectation|expected (pay|rate|gross)|desired (pay|rate)|rate expectation|financial expectation|hourly rate|day rate|daily rate|\bstawk|wynagrodzeni|gehalt|salaire|salario|retribuci/ },
    { id: 'notice', title: 'Notice period', test: /\bnotice\b|okres wypowiedzenia|k[üu]ndigungsfrist|pr[ée]avis|preaviso/ },
    { id: 'startDate', title: 'Start date / availability', test: /start date|when (can|could) you (start|join)|available to (start|join)|availability (to start|date)|earliest (start|date|possible)|joining date|date available|how soon can you (start|join)|od kiedy|rozpocz[aę]|ab wann|eintrittstermin|date de d[ée]but|fecha de (inicio|incorporaci)/ },
    { id: 'sponsorship', title: 'Visa sponsorship', test: /sponsor|\bvisa\b|wiz[ay]|visum/ },
    { id: 'workAuthorization', title: 'Work authorization', test: /\b(legally |lawfully )?(authori[sz]ed|eligible|entitled|permitted|allowed) to (work|be employed)\b|\bright to (live and )?work\b|work (authori[sz]ation|permit)|permission to work|status that allows you to work|pozwolenie na prac|arbeitserlaubnis/ },
    { id: 'relocation', title: 'Relocation', test: /relocat|przeprowadz|umzug|umziehen|d[ée]m[ée]nag|reubica|traslad/ },
    { id: 'remote', title: 'Remote work', test: /\bremote(ly)?\b|work(ing)? from home|\bwfh\b|home ?office|zdaln|telepraca|t[ée]l[ée]travail/ },
    { id: 'office', title: 'Office / hybrid work', test: /\bhybrid\b|on-?site|in (the|our) office|office (days|based|attendance)|in[- ]person|commut|stacjonar|hybryd|vor ort/ },
    { id: 'travel', title: 'Travel', test: /\btravel|podr[oó][zż]|delegacj|reisebereitschaft|dienstreise|d[ée]placement|viajar/ },
    { id: 'source', title: 'How did you hear about us', test: /how did you (hear|find|learn|come across|get to know)|where did you (hear|find|see|learn)|^(application |referral )?source$|sk[aą]d (si[eę] )?dowiedzia|wie sind sie auf|comment avez-vous/ },
    { id: 'contractType', title: 'Contract type (B2B / employment)', test: /\bb2b\b|contract type|type of (contract|employment|cooperation)|employment type|cooperation model|form of (employment|cooperation)|model wsp[oó][lł]pracy|forma (zatrudnienia|wsp[oó][lł]pracy)|rodzaj umowy|freelanc|self-employed|vertragsart/ },
    { id: 'workload', title: 'Full-time / part-time', test: /full[- ]time|part[- ]time|hours per week|weekly hours|working hours|wymiar (czasu|etatu)|pe[lł]ny etat|vollzeit|teilzeit/ },
    { id: 'overtime', title: 'Overtime / shifts / on-call', test: /overtime|\bshifts?\b|weekends?|on-?call|night work|nadgodzin|dy[zż]ur/ },
    { id: 'nonCompete', title: 'Non-compete / restrictions', test: /non-?compete|non-?solicit|restrictive covenant|zakaz konkurencji|wettbewerbsverbot/ },
    { id: 'conflicts', title: 'Conflicts of interest', test: /conflicts? of interest|outside (activit|employment|business)|konflikt interes/ },
    { id: 'exportControl', title: 'Export control', test: /export control|technologies or materials controlled|deemed export|\bitar\b|\bear\b.*regulation/ },
    { id: 'clearance', title: 'Security clearance', test: /security clearance|\bclearance\b|po[sś]wiadczenie bezpiecze/ },
    { id: 'criminal', title: 'Criminal record / background check', test: /criminal|background (check|screening)|convict|karaln|f[üu]hrungszeugnis/ },
    { id: 'driving', title: 'Driving licence', test: /driv(ing|er'?s?) licen|prawo jazdy|f[üu]hrerschein|permis de conduire/ },
    { id: 'relatives', title: 'Relatives at the company', test: /\brelatives?\b|family members?|related to (any|an?|one of)|know (anyone|someone) (who works|working|at)|personal relationship|spokrewnion/ },
    { id: 'appliedBefore', title: 'Applied here before', test: /(previously|ever|already) applied|applied (to|for|with|at) .{0,40}(before|previously|in the past)|prior application|aplikowa[lł].{0,20}wcze[sś]niej/ },
    { id: 'interview', title: 'Interview availability', test: /\binterview/ },
    { id: 'age', title: 'Age 18 or older', test: /\b(18|eighteen)\b.{0,20}\b(years|older|age)\b|legal (working )?age|age of majority|over the age|at least \d+ years (old|of age)/ },
    { id: 'timezone', title: 'Time zone', test: /time ?zone|strefa czasowa|zeitzone|fuseau horaire/ },
    { id: 'techStack', title: 'Tech stack / core skills', test: /tech(nology)? stack|core technologies|main technologies|key (skills|technologies)|technologies you (use|know|work)|technologie|stos technologiczny/ },
  ];
  // Words that ask nothing by themselves, left out when two wordings are compared.
  const FILLER = new Set(('a an the and or to of in on at for with about any your you yours our us we this that these those is are was were be been being do does did '
    + 'have has had can could would will shall should may might please kindly currently presently also yet still just if what which who whom how when where '
    + 'why there their it its as by from into than then so such very more most other others some all each every me my mine i am able').split(' '));
  // Words that ask the same thing, compared as one ("willing" / "open" / "ready"; "remote" / "remotely").
  const SAME = new Map([
    ...['willing', 'open', 'ready', 'prepared', 'comfortable', 'happy', 'interested', 'agree', 'available'].map((word) => [word, 'willing']),
    ...['remote', 'remotely', 'wfh', 'home'].map((word) => [word, 'remote']),
    ...['relocate', 'relocating', 'relocation', 'move', 'moving'].map((word) => [word, 'relocate']),
    ...['job', 'jobs', 'position', 'positions', 'role', 'roles', 'opportunity', 'opportunities', 'opening', 'openings', 'vacancy', 'vacancies', 'posting'].map((word) => [word, 'job']),
    ...['company', 'organisation', 'organization', 'employer', 'firm'].map((word) => [word, 'company']),
    ...['hear', 'heard', 'learn', 'learned', 'find', 'found'].map((word) => [word, 'hear']),
    ...['work', 'working', 'works', 'worked'].map((word) => [word, 'work']),
    ...['travel', 'travelling', 'traveling', 'travels'].map((word) => [word, 'travel']),
    ...['require', 'requires', 'required', 'need', 'needs', 'needed'].map((word) => [word, 'need']),
    ...['salary', 'compensation', 'remuneration', 'pay'].map((word) => [word, 'salary']),
    ...['expectation', 'expectations', 'expected', 'expect', 'desired'].map((word) => [word, 'expect']),
  ]);
  const NEGATION = /\b(not|never|unable|cannot|without|no longer)\b|n't\b/;
  // About someone else (a referrer, a relative, an employee you spoke to), never the candidate's own fact.
  const OTHER_PERSON = /\b(spouse|partner'?s|referr\w*|referee|references?|emergency|next of kin|recruiter|their|someone|hiring manager|who referred)\b/;

  function topicOf(text) {
    const label = clean(text);
    return TOPICS.find((topic) => topic.test.test(label)) || null;
  }

  function words(text) {
    return [...new Set(clean(text).replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/)
      .map((word) => word.replace(/^'+|'+$/g, ''))
      .filter((word) => word.length > 1 && !FILLER.has(word))
      .map((word) => SAME.get(word) || word))];
  }

  /** What a question asks, as a comparable card: { topic, key, negated, otherPerson, words }. */
  function meaningOf(text) {
    const label = clean(text);
    const topic = topicOf(label);
    const content = words(label);
    // A topic about a named thing (a skill, a tool) is that thing: "years with Python" ≠ "years with Go".
    const object = topic?.object ? content.filter((word) => !/^(years?|experience|how|many|much|level|rate|knowledge|skills?|familiar|hands-on|proficien\w*|expertise|certified|describe)$/.test(word)).sort().join(' ') : '';
    return { topic: topic?.id || null, title: topic?.title || null, key: topic ? `${topic.id}${object ? `:${object}` : ''}` : null,
      negated: NEGATION.test(label), otherPerson: OTHER_PERSON.test(label), words: content };
  }

  const SCOPE_ORDER = { application: 0, candidate: 1, manager: 2 };
  // A bare yes or no ("Yes", "No.") and a question asked as yes or no (an auxiliary verb first, or Yes/No choices).
  const YES_NO_ANSWER = /^(yes|no|y|n|true|false|tak|nie|ja|nein|oui|non|s[ií]|sim|n[aã]o)[\s.!]*$/i;
  const AUXILIARY = /^(are|is|am|was|were|do|does|did|have|has|had|can|could|will|would|shall|should|may|might|must)\b/;
  function asksYesNo(question, options = []) {
    const choices = (options || []).map((option) => String(option).trim());
    if (choices.length >= 2 && choices.length <= 4 && choices.some((option) => /^(yes|tak|ja|oui|s[ií]|sim)\b/i.test(option))
      && choices.some((option) => /^(no|nie|nein|non|n[aã]o)\b/i.test(option))) return true;
    // The sentence that asks ("This role requires … Can you work with this overlap?").
    const sentences = clean(question).split(/(?<=[.?!])\s+/).filter(Boolean);
    const asking = [...sentences].reverse().find((sentence) => sentence.endsWith('?')) || sentences[0] || '';
    return AUXILIARY.test(asking.replace(/^[^\p{L}]+/u, ''));
  }

  /**
   * The saved answer for a question, by meaning: { row, confidence: 'high' | 'medium', why } or null.
   * High (filled): the same question, a wording the Manager linked before, or the same topic asked the
   * same way. Medium (offered in the panel, never filled): most of the same words. The most specific
   * level wins among equally good answers: this job, then this candidate, then all candidates. A saved
   * Yes/No answers only a question asked as yes or no ("What attributes … remote …?" never gets "Yes"),
   * and other answers never a yes-or-no question; field: { kind, options } of the box, when known.
   */
  function matchSaved(question, rows, field = {}) {
    const asked = meaningOf(question);
    if (asked.otherPerson && asked.topic !== 'relatives') return null;
    const key = clean(question);
    const yesNoAsked = asksYesNo(question, field.options) || (field.kind === 'checkbox' && !(field.options || []).length);
    const ranked = [];
    for (const row of rows || []) {
      if (!row || row.answer == null || String(row.answer).trim() === '') continue;
      const saved = meaningOf(row.questionText);
      let confidence = null;
      let why = '';
      const sameShape = YES_NO_ANSWER.test(String(row.answer).trim()) === yesNoAsked;
      if (clean(row.questionText) === key) { confidence = 'high'; why = 'same question'; }
      else if ((row.variants || []).some((variant) => variant?.questionText && clean(variant.questionText) === key)) { confidence = 'high'; why = 'a wording you linked'; }
      else if (!sameShape) continue;
      else if (asked.key && asked.key === saved.key && asked.negated === saved.negated && !saved.otherPerson) { confidence = 'high'; why = `same meaning: ${asked.title}`; }
      else if (!asked.topic || !saved.topic || asked.topic === saved.topic) {
        const a = new Set(asked.words), b = new Set(saved.words);
        const shared = [...a].filter((word) => b.has(word)).length;
        const score = a.size && b.size ? shared / Math.min(a.size, b.size) : 0;
        if (score >= 0.75 && shared >= 2 && asked.negated === saved.negated) { confidence = 'medium'; why = 'similar wording'; }
      }
      if (confidence) ranked.push({ row, confidence, why, order: (confidence === 'high' ? 0 : 10) + (SCOPE_ORDER[row.scope] ?? 5) });
    }
    ranked.sort((a, b) => a.order - b.order);
    return ranked[0] ? { row: ranked[0].row, confidence: ranked[0].confidence, why: ranked[0].why } : null;
  }

  // ---- Languages: one level per language (profile, else the Manager's "Language levels" answer). ----
  const LANGUAGES = [
    ['English', /\benglish\b|angielsk|englisch|\banglais|ingl[eé]s|inglese|\bengels\b/],
    ['Polish', /\bpolish\b|\bpolsk|polnisch|polonais|polaco|polacco|\bpools\b/],
    ['German', /\bgerman\b|niemieck|deutsch|allemand|alem[aá]n|tedesco|\bduits\b/],
    ['French', /\bfrench\b|francusk|franz[öo]sisch|fran[cç]ais|franc[eé]s|francese|\bfrans\b/],
    ['Spanish', /\bspanish\b|hiszpa[nń]sk|spanisch|espagnol|espa[nñ]ol|spagnolo|\bspaans\b/],
    ['Italian', /\bitalian\b|w[lł]osk|italienisch|italien|italiano/],
    ['Portuguese', /\bportuguese\b|portugalsk|portugiesisch|portugais|portugu[eê]s|portoghese/],
    ['Dutch', /\bdutch\b|niderlandzk|holendersk|niederl[äa]ndisch|n[ée]erlandais|neerland[eé]s|olandese|nederlands/],
    ['Russian', /\brussian\b|rosyjsk|russisch|\brusse\b|\bruso\b|\brusso\b/],
    ['Ukrainian', /\bukrainian\b|ukrai[nń]sk|ukrainisch|ukrainien|ucraniano|ucraino/],
    ['Czech', /\bczech\b|czesk|tschechisch|tch[eè]que|checo|ceco/],
    ['Slovak', /\bslovak\b|s[lł]owack|slowakisch|slovaque|eslovaco|slovacco/],
    ['Swedish', /\bswedish\b|szwedzk|schwedisch|su[ée]dois|sueco|svedese/],
    ['Norwegian', /\bnorwegian\b|norwesk|norwegisch|norv[ée]gien|noruego|norvegese/],
    ['Danish', /\bdanish\b|du[nń]sk|d[äa]nisch|danois|dan[eé]s|danese/],
    ['Finnish', /\bfinnish\b|fi[nń]sk|finnisch|finnois|finland[eé]s|finlandese/],
    ['Hungarian', /\bhungarian\b|w[eę]giersk|ungarisch|hongrois|h[uú]ngaro|ungherese/],
    ['Romanian', /\bromanian\b|rumu[nń]sk|rum[äa]nisch|roumain|rumano|rumeno/],
    ['Bulgarian', /\bbulgarian\b|bu[lł]garsk|bulgarisch|bulgare|b[uú]lgaro/],
    ['Croatian', /\bcroatian\b|chorwack|kroatisch|croate|croata/],
    ['Serbian', /\bserbian\b|serbsk|serbisch|\bserbe\b|serbio/],
    ['Greek', /\bgreek\b|greck|griechisch|\bgrec\b|griego|greco/],
    ['Turkish', /\bturkish\b|tureck|t[üu]rkisch|\bturc\b|turco/],
    ['Lithuanian', /\blithuanian\b|litewsk|litauisch|lituanien|lituano/],
    ['Latvian', /\blatvian\b|[lł]otewsk|lettisch|letton|let[oó]n/],
    ['Estonian', /\bestonian\b|esto[nń]sk|estnisch|estonien|estonio/],
    ['Slovenian', /\bslovenian\b|s[lł]owe[nń]sk|slowenisch|slov[eè]ne|esloveno/],
    ['Arabic', /\barabic\b|arabsk|arabisch|\barabe\b|[aá]rabe/],
    ['Hebrew', /\bhebrew\b|hebrajsk|hebr[äa]isch|h[ée]breu|hebreo/],
    ['Chinese', /\bchinese\b|\bmandarin\b|chi[nń]sk|chinesisch|chinois|chino|cinese/],
    ['Japanese', /\bjapanese\b|japo[nń]sk|japanisch|japonais|japon[eé]s|giapponese/],
    ['Korean', /\bkorean\b|korea[nń]sk|koreanisch|cor[ée]en|coreano/],
    ['Hindi', /\bhindi\b/],
  ];
  // Levels, lowest to highest; Native above C2. Words in the languages job sites use.
  const LEVELS = [
    { rank: 1, code: 'A1', test: /\ba1\b|beginner|starter|elementary|basic|podstaw|pocz[aą]tkuj|grundkenntnis|anf[äa]nger|d[ée]butant|b[aá]sico|principiante|elementare/ },
    { rank: 2, code: 'A2', test: /\ba2\b|pre-?intermediate|waystage/ },
    { rank: 3, code: 'B1', test: /\bb1\b|(?<!upper[- ])intermediate|[sś]rednio|mittel(?!stufe obere)|interm[ée]diaire|intermedio|conversational|komunikatywn/ },
    { rank: 4, code: 'B2', test: /\bb2\b|upper[- ]intermediate|good\b|\bgut\b|\bbon\b|\bbueno\b|working knowledge/ },
    { rank: 5, code: 'C1', test: /\bc1\b|advanced|zaawansowan|fortgeschritten|avanc[ée]|avanzado|very good|sehr gut|professional working|proficient/ },
    { rank: 6, code: 'C2', test: /\bc2\b|fluent|fluency|p[lł]ynn|flie[ßs]end|courant|fluido|full professional|expert|excellent|mastery|bieg[lł]/ },
    { rank: 7, code: 'Native', test: /\bnative\b|bilingual|mother tongue|first language|ojczyst|natywn|muttersprach|langue maternelle|\bnatif\b|nativo|madrelingua/ },
  ];
  const levelRank = (text) => {
    const value = clean(text);
    for (let index = LEVELS.length - 1; index >= 0; index -= 1) if (LEVELS[index].test.test(value)) return LEVELS[index].rank;
    return null;
  };
  const languageIn = (text) => {
    const value = clean(text);
    const found = LANGUAGES.filter(([, test]) => test.test(value)).map(([name]) => name);
    return found;
  };
  const OTHERS = /\b(others?|other languages?|any other|all other|rest|remaining|inne( j[eę]zyki)?|pozosta[lł]e|andere|autres)\b/;

  /** "English (C1), Polish (native)" or "English: Native; Other languages: A1" → { English: 6, …, '*': 1 }. */
  function parseLanguageLevels(text) {
    const levels = {};
    for (const part of String(text || '').split(/[;,\n/|]+/)) {
      const rank = levelRank(part.replace(/^[^:(–-]*[:(–-]/, ' ')) ?? levelRank(part);
      if (!rank) continue;
      const names = languageIn(part.split(/[:(–]/)[0] || part);
      if (names.length) for (const name of names) levels[name] = rank;
      else if (OTHERS.test(clean(part))) levels['*'] = rank;
    }
    return levels;
  }

  const PROGRAMMING = /programming|coding|scripting|computer language|query language|markup/;
  const LANGUAGE_CUE = /\blanguages?\b|j[eę]zyk|sprache|langue|idioma|lingua|\b(speak|spoken|fluent|fluently|fluency|proficien\w*|native|mother tongue|level|skills?|knowledge|written|verbal|communicat\w*|understand)\b|poziom|znajomo[sś][cć]|kenntnisse|niveau|nivel|livello|m[oó]wisz|sprechen|parlez/;

  /**
   * The answer to a language question from the levels known (profile first, then saved levels), or null.
   * Asks: level (a list of levels or a text box), fluent? / native? / do you speak? (yes or no), the
   * native language, or a list of languages and levels.
   */
  function languageAnswer(field, levelsOf) {
    const label = clean(field.label);
    if (PROGRAMMING.test(label)) return null;
    const options = (field.options || []).map(String);
    const optionRanks = options.map(levelRank);
    const levelList = optionRanks.filter(Boolean).length >= 3;
    const named = languageIn(label);
    const generic = /\blanguages?\b|j[eę]zyki|sprachen|langues|idiomas/.test(label) && !named.length;
    if (!named.length && !generic && !(levelList && LANGUAGE_CUE.test(label))) return null;
    if (!LANGUAGE_CUE.test(label) && !levelList) return null;
    const known = levelsOf();
    const rankFor = (name) => known[name] ?? known['*'] ?? null;
    const yesNo = options.length > 0 && options.length <= 4 && options.some((option) => /^(yes|tak|ja|oui|s[ií]|sim)\b/i.test(option.trim()))
      && options.some((option) => /^(no|nie|nein|non|n[aã]o)\b/i.test(option.trim()));
    const isCheckbox = field.kind === 'checkbox' && !options.length;
    // Which language: the one the question names; several named, or none, is not one clear language.
    if (generic || named.length !== 1) {
      // "What is your native language?" / "Languages and levels": answered from all known levels.
      const entries = Object.entries(known).filter(([name]) => name !== '*').sort((a, b) => b[1] - a[1]);
      if (!entries.length) return null;
      if (/\b(native|mother tongue|first language|ojczyst|muttersprach|maternelle)\b/.test(label) && !yesNo) {
        const native = entries.filter(([, rank]) => rank === 7).map(([name]) => name);
        if (!native.length) return null;
        if (options.length) {
          const option = options.find((choice) => languageIn(choice).includes(native[0]));
          return option ? { value: option, reason: `native language: ${native[0]}` } : null;
        }
        return { value: native.join(', '), reason: 'native language' };
      }
      if (['text', 'textarea'].includes(field.kind) && !options.length && !levelList) {
        const text = entries.map(([name, rank]) => `${name} – ${LEVELS.find((level) => level.rank === rank).code}`).join(', ');
        return { value: text, reason: 'languages and levels' };
      }
      return null;
    }
    const language = named[0];
    const rank = rankFor(language);
    if (!rank) return null;
    const code = LEVELS.find((level) => level.rank === rank).code;
    const why = `${language}: ${code}`;
    if (yesNo || isCheckbox) {
      let yes;
      const atLeast = label.match(/\b(a1|a2|b1|b2|c1|c2)\b.{0,25}\b(or (higher|above|better|more)|\+|minimum|at least)|\b(at least|minimum|min\.?)\s*(a1|a2|b1|b2|c1|c2)\b/);
      if (atLeast) yes = rank >= LEVELS.find((level) => level.code === (atLeast[1] || atLeast[4]).toUpperCase()).rank;
      else if (/\b(native|mother tongue|first language|ojczyst|muttersprach|maternelle)\b/.test(label) && !/\bor (fluent|bilingual)\b|fluent or native/.test(label)) yes = rank >= 7;
      else if (/\b(fluent|fluently|fluency|proficient|business|professional|p[lł]ynn|flie[ßs]end|courant|bilingual)\b/.test(label)) yes = rank >= 6;
      else if (/\b(native|mother tongue)\b/.test(label)) yes = rank >= 6;
      else yes = rank >= 3;
      if (isCheckbox) return { value: yes, reason: why };
      const option = options.find((choice) => (yes ? /^(yes|tak|ja|oui|s[ií]|sim)\b/i : /^(no|nie|nein|non|n[aã]o)\b/i).test(choice.trim()));
      return option ? { value: option, reason: why } : null;
    }
    if (levelList || options.length) {
      // The option at this level; Native falls back to the highest level offered (C2 / Fluent).
      let best = null;
      options.forEach((option, index) => {
        const optionRank = optionRanks[index];
        if (optionRank && optionRank <= rank && (!best || optionRank > best.rank)) best = { option, rank: optionRank };
      });
      if (!best) {
        const numbers = options.map((option) => Number(String(option).trim())).filter((value) => Number.isFinite(value));
        if (numbers.length === options.length && numbers.length >= 3) {
          const low = Math.min(...numbers), high = Math.max(...numbers);
          const target = rank >= 6 ? high : rank <= 1 ? low : Math.round(low + ((high - low) * (rank - 1)) / 5);
          const option = options.find((choice) => Number(String(choice).trim()) === target);
          return option ? { value: option, reason: why } : null;
        }
        return null;
      }
      return { value: best.option, reason: why };
    }
    if (['text', 'textarea'].includes(field.kind)) return { value: code, reason: why };
    return null;
  }

  // ---- Employer history: "Are you / have you been employed by <company>?" from the work history. ----
  const LEGAL_SUFFIX = /\b(inc|incorporated|ltd|limited|llc|llp|plc|gmbh|ag|se|sa|s a|spa|s p a|srl|sro|s r o|bv|nv|oy|ab|as|aps|kft|zrt|sp z o o|sp zoo|sp k|co|corp|corporation|company|group|holding|holdings|international|technologies|technology|software|solutions|services)\b/g;
  const companyKey = (name) => clean(name).replace(/[.,&()'’"]/g, ' ').replace(/\s+/g, ' ').replace(LEGAL_SUFFIX, ' ').replace(/\s+/g, ' ').trim();
  const EMPLOYER_QUESTION = /\b(currently|presently|previously|ever|before|formerly|in the past|are you|have you|were you|do you)\b.{0,70}\b(employed|employee|worked|work(ing)?|contracted|contractor|engaged|consultant|worker|staff)\b.{0,50}\b(by|for|at|with|to)\b|\b(current|former|ex)[- ]?(or former )?(employee|contractor|worker)s?\b/;

  /**
   * The answer to "employed / contracted by <company>?" from the candidate's work history: listed →
   * Yes ("currently" only for a current job), not listed → No. Null when unsure or with no history.
   */
  function employerAnswer(field, experiences, jobCompany) {
    const label = clean(field.label);
    if (!EMPLOYER_QUESTION.test(label) || /\brelatives?\b|family|related to|spouse|referr|know (anyone|someone)/.test(label)) return null;
    const history = (experiences || []).filter((entry) => entry && String(entry.companyName || '').trim());
    if (!history.length) return null;
    const options = (field.options || []).map(String);
    // The companies asked about: named in the question, in the choices ("Yes - Codete"), or this company.
    const named = [];
    const after = label.match(/\b(?:by|for|at|with|to)\s+([^?,;]+?)(?:\s+or\s+(?:any|one)\s+of|\s+or\s+its|\s+and\s+its|\s+\(|\s*,|\?|$)/);
    if (after && !/^(us|our|this|the company|the employer|any|an?)\b/.test(after[1].trim())) named.push(after[1].trim());
    for (const option of options) {
      const yes = option.match(/^\s*yes\s*[-–:,]\s*(.+)$/i);
      if (yes && !/^(other|another|none|n\/a)\b/i.test(yes[1].trim())) named.push(yes[1].trim());
      const at = option.match(/\b(?:at|by|for|with)\s+(.+?)\s*$/i);
      if (at && /employee|worker|contractor/i.test(option)) named.push(at[1].trim());
    }
    if (!named.length || /\b(us|our company|this company|this employer)\b/.test(label)) if (jobCompany) named.push(jobCompany);
    const targets = [...new Set(named.map(companyKey).filter((key) => key.length >= 2))];
    if (!targets.length) return null;
    const currentOnly = /\b(currently|presently|at present|right now)\b/.test(label) && !/\b(ever|previously|formerly|in the past|before|or (have you )?(ever|previously|been))\b/.test(label);
    const matches = history.filter((entry) => {
      const key = companyKey(entry.companyName);
      return key && targets.some((target) => key === target || key.startsWith(`${target} `) || target.startsWith(`${key} `));
    });
    const current = (entry) => entry.isCurrent === true || !entry.endDate;
    const hit = currentOnly ? matches.filter(current) : matches;
    const yes = hit.length > 0;
    const reason = yes ? `worked at ${hit[0].companyName}${current(hit[0]) ? ' (now)' : ''}` : `not in the work history: ${targets.join(', ')}`;
    if (field.kind === 'checkbox' && !options.length) return { value: yes, reason };
    if (!options.length) return ['text', 'textarea'].includes(field.kind) ? { value: yes ? 'Yes' : 'No', reason } : null;
    if (!yes) {
      const no = options.find((option) => /^\s*(no|nie|nein|non|never|i have never|i am not|none)\b/i.test(option) || /\bnever\b/i.test(option));
      return no ? { value: no, reason } : null;
    }
    const own = companyKey(hit[0].companyName);
    const key = targets.find((target) => own === target || own.startsWith(`${target} `) || target.startsWith(`${own} `)) || own;
    const naming = options.filter((option) => /^\s*yes\b|employee|worker|contractor/i.test(option)
      && companyKey(option.replace(/^\s*yes\s*[-–:,]\s*/i, '')).includes(key));
    const timed = naming.filter((option) => (current(hit[0]) ? /currently|current|am\b/i : /previously|former|have been|was\b|past/i).test(option));
    const option = timed[0] || (naming.length === 1 ? naming[0] : null) || (options.filter((choice) => /^\s*(yes|tak|ja|oui|s[ií])\s*$/i.test(choice))[0]);
    return option ? { value: option, reason } : null;
  }

  const api = Object.freeze({ version: 1, TOPICS: Object.freeze(TOPICS.map(({ id, title }) => Object.freeze({ id, title }))), clean, topicOf, meaningOf, matchSaved, asksYesNo,
    parseLanguageLevels, languageAnswer, levelRank, employerAnswer, companyKey });
  global.__qtsAnswerMeaning = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
