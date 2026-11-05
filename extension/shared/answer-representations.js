// Pure typed operations. Never writes records, discovers facts, calls AI or touches a form.
(function init(global) {
  const present = (value) => value !== null && value !== undefined && value !== '';
  const fail = (reason) => ({ ok: false, reason });
  const formats = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD.MM.YYYY', 'MM.DD.YYYY', 'DD-MM-YYYY', 'MM-DD-YYYY'];
  const unit = (raw) => String(raw || '').trim().toLowerCase().replace(/s$/, '');
  function metadata(raw) {
    if (!raw || typeof raw !== 'object') return undefined;
    const out = {};
    if (formats.includes(raw.dateFormat)) out.dateFormat = raw.dateFormat;
    if (['decimal-dot', 'decimal-comma'].includes(raw.numberFormat)) out.numberFormat = raw.numberFormat;
    if (/^\+[1-9]\d{0,3}$/.test(raw.callingCode || '')) out.callingCode = raw.callingCode;
    if (raw.nationalSignificant === true && out.callingCode) out.nationalSignificant = true;
    if (['day', 'week', 'month', 'year', 'hour'].includes(unit(raw.unit))) out.unit = unit(raw.unit);
    if (raw.nameOrder === 'family-given') out.nameOrder = raw.nameOrder;
    return Object.keys(out).length ? out : undefined;
  }
  function describeField(field) {
    return metadata({ dateFormat: field.kind === 'date' ? 'YYYY-MM-DD' : String(field.placeholder || '').toUpperCase(),
      numberFormat: field.placeholder === '0,00' ? 'decimal-comma' : field.placeholder === '0.00' ? 'decimal-dot' : undefined,
      callingCode: field.phoneCallingCode, unit: field.unit,
      nameOrder: field.nameOrder || (/^(?:last|family|surname),\s*(?:first|given)(?: name)?$/i.test(field.placeholder || '') ? 'family-given' : undefined) });
  }
  function number(value, format) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    let text = String(value ?? '').trim();
    if (format === 'decimal-comma') text = text.replace(',', '.');
    if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
    const result = Number(text); return Number.isFinite(result) ? result : null;
  }
  function date(value, format = 'YYYY-MM-DD') {
    if (!formats.includes(format)) return null;
    const parts = String(value).match(/^([0-9]{2,4})([./-])([0-9]{2})\2([0-9]{2,4})$/);
    if (!parts || parts[2] !== format.match(/[./-]/)?.[0]) return null;
    const tokens = format.split(/[./-]/), values = [parts[1], parts[3], parts[4]];
    if (values.some((part, i) => part.length !== tokens[i].length)) return null;
    const get = (token) => Number(values[tokens.indexOf(token)]);
    const year = get('YYYY'), month = get('MM'), day = get('DD');
    if (year < 1000 || year > 9999) return null;
    const instant = new Date(Date.UTC(year, month - 1, day));
    return instant.getUTCFullYear() === year && instant.getUTCMonth() + 1 === month && instant.getUTCDate() === day ? { year, month, day } : null;
  }
  function dateText(parts, format) {
    return format.replace('YYYY', String(parts.year)).replace('MM', String(parts.month).padStart(2, '0')).replace('DD', String(parts.day).padStart(2, '0'));
  }
  function boolean(value) {
    if (typeof value === 'boolean') return value;
    const text = String(value).trim().toLowerCase();
    return ['yes', 'true', 'checked', 'ticked'].includes(text) ? true : ['no', 'false', 'unchecked', 'not ticked'].includes(text) ? false : null;
  }
  const operations = Object.freeze([
    { id: 'compose', source: 'components', target: 'string', requires: ['layout', 'required components'], failure: 'manual' },
    { id: 'extract', source: 'components', target: 'scalar', requires: ['explicit component key'], failure: 'manual' },
    { id: 'split', source: 'structured-text', target: 'components', requires: ['explicit separator', 'named components', 'exact component count'], failure: 'manual' },
    { id: 'phone', source: 'phone', target: 'phone representation', requires: ['known calling code for split/combine'], failure: 'manual' },
    { id: 'boolean', source: 'boolean', target: 'checkbox/choice/text', requires: ['same question polarity', 'unique choice'], failure: 'manual' },
    { id: 'number', source: 'number', target: 'number/text', requires: ['unambiguous decimal convention'], failure: 'manual' },
    { id: 'date', source: 'date', target: 'date/text', requires: ['explicit source and target formats', 'valid calendar date'], failure: 'manual' },
    { id: 'duration', source: 'duration', target: 'quantity/date', requires: ['known unit', 'base date for availability'], failure: 'manual' },
    { id: 'money', source: 'money', target: 'quantity/text', requires: ['currency', 'period', 'basis compatibility', 'explicit conversion factors/rates'], failure: 'manual' },
    { id: 'choice', source: 'scalar/set', target: 'offered choices', requires: ['unique exact or boolean-equivalent choices'], failure: 'manual' },
    { id: 'identity', source: 'scalar', target: 'scalar', requires: ['no meaning change'], failure: 'manual' },
  ].map(Object.freeze));
  function convert(source, target, context = {}) {
    if (!source || !['string', 'set', 'components', 'structured-text', 'phone', 'boolean', 'number', 'date', 'duration', 'money'].includes(source.type)) return fail('Unsupported source type.');
    if (!source || (!present(source.value) && source.type !== 'components')) return fail('The authoritative value is missing or explicitly empty.');
    if (source.type === 'set' && !Array.isArray(source.value)) return fail('The source is not a typed set.');
    const sourceType = source.type, stages = []; let splitContext;
    if (source.type === 'structured-text') {
      const keys = source.context?.keys, separator = source.context?.separator;
      if (!Array.isArray(keys) || !keys.length || typeof separator !== 'string' || !separator) return fail('Known structural boundaries are required.');
      const parts = String(source.value).split(separator).map((part) => part.trim());
      if (parts.length !== keys.length || parts.some((part) => !part) || new Set(keys).size !== keys.length) return fail('The source does not have the approved component structure.');
      source = { type: 'components', value: Object.fromEntries(keys.map((key, i) => [key, parts[i]])) }; stages.push('split'); splitContext = { keys, separator };
    }
    let value = source.value, operation = 'identity';
    const used = splitContext ? { structure: splitContext } : {};
    if (source.type === 'components') {
      operation = target.component ? 'extract' : 'compose';
      if (target.component) {
        value = source.value?.[target.component]; if (!present(value)) return fail(`Missing component: ${target.component}.`);
      } else {
        if (!context.layout || !context.required?.every((key) => present(source.value?.[key]))) return fail('Required composition components are missing.');
        value = context.layout.map((line) => line.map((key) => source.value[key]).filter(present).join(' ')).filter(present).join(context.separator ?? ', ');
        used.required = context.required;
      }
    } else if (source.type === 'phone') {
      operation = 'phone';
      used.representation = target.representation || 'original';
      const text = String(value).trim(), code = context.callingCode || source.context?.callingCode;
      if (source.context?.national === true && target.representation === 'national') {
        if (!/^\d+$/.test(text)) return fail('The saved national number is not an unambiguous digit sequence.');
        value = text;
      } else if (source.context?.national === true && target.representation === 'calling-code') {
        if (!/^\+[1-9]\d{0,3}$/.test(code || '')) return fail('No approved calling code is associated with this national number.');
        value = code; used.callingCode = code;
      } else if (target.representation === 'calling-code' || target.representation === 'national') {
        if (!/^\+[1-9]\d{0,3}$/.test(code || '') || !/^\+[1-9][\d\s().-]+$/.test(text)) return fail('A known calling code and international number are required.');
        const digits = text.replace(/\D/g, ''), prefix = code.slice(1);
        if (digits.length > 15 || !digits.startsWith(prefix) || digits.length <= prefix.length) return fail('The calling code does not match the saved number.');
        value = target.representation === 'calling-code' ? code : digits.slice(prefix.length); used.callingCode = code;
      } else if (source.context?.national === true) {
        if (source.context.nationalSignificant !== true || !/^\+[1-9]\d{0,3}$/.test(code || '') || !/^\d+$/.test(text) || code.length + text.length - 1 > 15) return fail('Known significant national digits and calling code are required; trunk prefixes are not guessed.');
        value = `${code}${text}`; used.callingCode = code;
      } else if (target.representation === 'digits') {
        if (!/^\+[1-9][\d\s().-]+$/.test(text)) return fail('Digits-only international formatting requires an international source.');
        value = text.replace(/\D/g, '');
      } else value = text;
    } else if (source.type === 'boolean') {
      operation = 'boolean'; value = boolean(value); if (value === null) return fail('The source is not an explicit boolean.');
      if (target.kind !== 'checkbox' && !target.options?.length) value = value ? 'Yes' : 'No';
    } else if (source.type === 'number') {
      operation = 'number'; value = number(value, source.context?.numberFormat);
      if (value === null) return fail('The number or its decimal convention is ambiguous.');
      if (source.context?.unit && target.unit && unit(source.context.unit) !== unit(target.unit)) return fail('This numeric unit conversion is not established.');
      if (context.numberFormat === 'decimal-comma' && target.kind !== 'number') value = String(value).replace('.', ',');
      used.sourceFormat = source.context?.numberFormat || 'strict-decimal'; used.targetFormat = context.numberFormat || 'strict-decimal';
    } else if (source.type === 'date') {
      operation = 'date'; const parts = date(value, source.context?.dateFormat || 'YYYY-MM-DD');
      const format = target.kind === 'date' ? 'YYYY-MM-DD' : context.dateFormat || 'YYYY-MM-DD';
      if (target.kind !== 'date' && /[dmy]{2}/i.test(target.placeholder || '') && !formats.includes(String(target.placeholder).toUpperCase())) return fail('The requested date format is unsupported.');
      if (!parts || !formats.includes(format)) return fail('The date or its requested format is unsupported.');
      value = dateText(parts, format); used.sourceFormat = source.context?.dateFormat || 'YYYY-MM-DD'; used.targetFormat = format;
    } else if (source.type === 'duration') {
      operation = 'duration'; const amount = number(value), from = unit(source.context?.unit), to = unit(target.unit) || from;
      const days = { day: 1, week: 7 };
      if (amount === null || amount < 0 || !['day', 'week', 'month', 'year'].includes(from)) return fail('The duration unit is unsupported.');
      if (target.kind === 'date' || target.representation === 'availability-date') {
        const base = date(context.baseDate); if (!base || !days[from] || !Number.isInteger(amount * days[from])) return fail('A calendar base date and whole-day duration are required; month lengths are not assumed.');
        if (context.dateFormat && !formats.includes(context.dateFormat)) return fail('Unsupported availability date format.');
        const instant = new Date(Date.UTC(base.year, base.month - 1, base.day + amount * days[from]));
        value = dateText({ year: instant.getUTCFullYear(), month: instant.getUTCMonth() + 1, day: instant.getUTCDate() }, context.dateFormat || 'YYYY-MM-DD'); used.baseDate = context.baseDate;
      } else if (target.options?.length) {
        const equivalent = target.options.filter((option) => {
          if (/^immediately$/i.test(String(option).trim())) return amount === 0;
          const match = String(option).trim().match(/^(\d+(?:\.\d+)?)\s*(?:calendar )?(days?|weeks?|months?|years?)$/i);
          if (!match) return false;
          const offered = unit(match[2]);
          return offered === from ? Number(match[1]) === amount : days[offered] && days[from] && Number(match[1]) * days[offered] === amount * days[from];
        });
        if (equivalent.length !== 1) return fail('No unique equivalent calendar-duration choice.');
        value = equivalent[0];
      } else {
        if (['number', 'range'].includes(target.kind) && !target.unit) return fail('A numeric duration field must specify its unit.');
        if (to !== from && !(days[from] && days[to])) return fail('Unsupported duration conversion; month lengths are not assumed.');
        value = to === from ? amount : amount * days[from] / days[to];
        if (!['number', 'range'].includes(target.kind)) value = `${value} ${to}${value === 1 ? '' : 's'}`;
      }
      used.sourceUnit = from; used.targetUnit = to;
    } else if (source.type === 'money') {
      operation = 'money'; value = number(value); const from = source.context || {}, to = target.context || {};
      if (value === null || value < 0 || !from.currency || !from.period) return fail('A nonnegative salary, currency and period must be known.');
      if ((to.basis || from.basis) && to.basis !== from.basis) return fail('Gross/net salary bases cannot be inferred or converted.');
      const currency = String(to.currency || from.currency).toUpperCase(), period = to.period || from.period;
      if (period !== from.period) {
        const factors = context.periodFactors || {};
        if (!(Number.isFinite(factors[from.period]) && Number.isFinite(factors[period]) && factors[from.period] > 0 && factors[period] > 0)) return fail('Explicit working-time/payment-period factors are required.');
        value = value * factors[period] / factors[from.period]; used.periodFactors = { [from.period]: factors[from.period], [period]: factors[period] };
      }
      if (currency !== String(from.currency).toUpperCase()) {
        const a = context.rates?.[from.currency.toUpperCase()], b = context.rates?.[currency.toUpperCase()];
        if (!(Number.isFinite(a) && a > 0 && Number.isFinite(b) && b > 0)) return fail('Known exchange rates are required.');
        value = value / a * b; used.exchangeRates = { [from.currency]: a, [currency]: b };
      }
      if (!['number', 'range'].includes(target.kind)) value = `${value} ${currency.toUpperCase()} per ${period}`;
      used.currency = currency; used.period = period;
    }
    if (target.options?.length) {
      const many = target.multiple || target.kind === 'checkbox-group', entries = Array.isArray(value) ? value : [value];
      if (!many && entries.length !== 1) return fail('Several values cannot fill a single-choice control.');
      const picked = [];
      for (const entry of entries) {
        let matching = target.options.filter((option) => String(option).trim().toLowerCase() === String(entry).trim().toLowerCase());
        if (!matching.length && context.choiceAliases?.[String(entry)]) matching = target.options.filter((option) => context.choiceAliases[String(entry)].some((alias) => String(alias).trim().toLowerCase() === String(option).trim().toLowerCase()));
        if (!matching.length && source.type === 'boolean') matching = target.options.filter((option) => {
          const text = String(option).trim().toLowerCase();
          return (boolean(source.value) ? ['yes', 'true', 'yes, i do', 'yes, i am'] : ['no', 'false', 'no, i do not', 'no, i am not']).includes(text);
        });
        if (matching.length !== 1) return fail('An answer does not uniquely match an offered choice.');
        picked.push(matching[0]);
      }
      value = many ? [...new Set(picked)] : picked[0]; used.selection = 'unique offered choices';
    } else if (Array.isArray(value)) {
      if (!target.multiple && target.kind !== 'checkbox-group') return fail('A set cannot be flattened into arbitrary prose.');
      if (!value.length) return fail('An empty set is not a choice.');
    }
    if (value === undefined || value === null || value === '' || (typeof value === 'number' && !Number.isFinite(value))) return fail('No valid representation.');
    if (Array.isArray(value) && !value.length) return fail('An empty set is not an offered choice.');
    if (['number', 'range'].includes(target.kind)) {
      const numeric = number(value);
      if (numeric === null || (Number.isFinite(target.min) && numeric < target.min) || (Number.isFinite(target.max) && numeric > target.max)) return fail('The result violates numeric constraints.');
      if (Number.isFinite(target.step) && target.step > 0) {
        const steps = (numeric - (Number.isFinite(target.min) ? target.min : 0)) / target.step;
        if (Math.abs(steps - Math.round(steps)) > 1e-8) return fail('The result does not satisfy the field step.');
      }
    }
    if (target.maxLength && String(value).length > target.maxLength) return fail('The result exceeds the field length limit.');
    if (target.pattern) {
      try { if (target.pattern.length > 200 || !new RegExp(`^(?:${target.pattern})$`, 'u').test(String(value))) return fail('The result does not satisfy the field pattern.'); }
      catch { return fail('The field pattern cannot be validated.'); }
    }
    if (target.kind === 'date') {
      const parts = date(value);
      if (!parts || (target.minDate && (!date(target.minDate) || value < target.minDate)) || (target.maxDate && (!date(target.maxDate) || value > target.maxDate))) return fail('The result violates calendar date constraints.');
      if (target.dateStep > 1) {
        if (!date(target.minDate)) return fail('A known minimum date is required to validate this date step.');
        const days = (Date.parse(`${value}T00:00:00Z`) - Date.parse(`${target.minDate}T00:00:00Z`)) / 86400000;
        if (days % target.dateStep !== 0) return fail('The date does not satisfy the field step.');
      }
    }
    return { ok: true, value, provenance: { operation, stages: [...stages, operation], sourceType, targetType: target.kind, context: used } };
  }
  const api = Object.freeze({ version: 1, operations, metadata, describeField, number, date, convert });
  global.__qtsAnswerRepresentations = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
