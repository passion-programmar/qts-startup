(function initScannerCapture(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.__qtsScannerCapture = api;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const STRONG_HINTS = ['id', 'name', 'testId', 'automationId'];

  function isStableHint(key, value) {
    const normalized = String(value || '').trim();
    if (!normalized) return false;
    if (key !== 'id') return true;
    return !/^(?:react-aria|headlessui|radix)-/i.test(normalized)
      && !/(?:^|[-_:])[a-f0-9]{8,}(?:$|[-_:])/i.test(normalized)
      && !/^\d+$/.test(normalized)
      && !/^:[a-z]\d+:(?:.+)?$/i.test(normalized)
      && !/\d{5,}/.test(normalized);
  }

  function stableClassNames(values) {
    return (Array.isArray(values) ? values : [])
      .map((value) => String(value || '').trim())
      .filter((value) => value
        && value.length <= 48
        && !/(?:^|[-_])[a-f0-9]{8,}(?:$|[-_])/i.test(value)
        && !/^(?:css|sc|jss|emotion|jsx)-[a-z0-9_-]{6,}$/i.test(value)
        && !/\d{5,}/.test(value))
      .sort();
  }

  function fieldLocatorKey(field) {
    const hints = field?.selectorHints || {};
    for (const key of STRONG_HINTS) {
      if (isStableHint(key, hints[key])) return `${key}:${String(hints[key]).toLowerCase()}`;
    }
    return '';
  }

  function fieldFallbackKey(field) {
    const label = clean(field?.label || field?.question);
    const type = clean(field?.fieldType);
    const section = clean(field?.sectionHeading);
    return label && type ? `label:${label}|${type}|${section}` : '';
  }

  function deriveStepKey(fields) {
    const list = Array.isArray(fields) ? fields : [];
    const statedStep = clean(list.find((field) => field?.pageStep)?.pageStep);
    const sections = [...new Set(list.map((field) => clean(field?.sectionHeading)).filter(Boolean))].sort();
    const material = statedStep || (sections.length ? sections.join('~') : '');
    if (!material) return '';
    let hash = 0;
    for (let index = 0; index < material.length; index += 1) {
      hash = ((hash << 5) - hash) + material.charCodeAt(index);
      hash |= 0;
    }
    return `step-${Math.abs(hash).toString(36)}`;
  }

  function getRuleFieldId(field, existingRule = null) {
    if (existingRule?.field_id) return String(existingRule.field_id);
    const fieldId = String(field?.stableFieldId || field?.fieldId || '');
    const stepKey = String(field?.scannerStepKey || '');
    if (!fieldId || !stepKey) return fieldId;
    const combined = `${stepKey}:${fieldId}`;
    return combined.slice(0, 255);
  }

  function observationKey(field) {
    return String(field?.stableFieldId || '')
      || fieldLocatorKey(field)
      || fieldFallbackKey(field);
  }

  function hasStrongLocator(field) {
    return Boolean(fieldLocatorKey(field));
  }

  function hasManagerConfirmedFieldIdentity(field, rule) {
    return Boolean(rule && (
      field?.scannerCapture?.fieldIdentityConfirmed === true
      || rule?.field_snapshot?.fieldIdentityConfirmed === true
    ));
  }

  function captureValidation(field) {
    const constraints = field?.constraints || {};
    const inputType = String(field?.validation?.inputType || field?.fieldType || '').slice(0, 100);
    const inputMode = String(field?.validation?.inputMode || field?.inputMode || '').slice(0, 40);
    const hint = String(
      field?.validation?.hint
      || field?.validationHint
      || [field?.validationMessage, field?.titleAttr, field?.placeholder].filter(Boolean).join(' ')
    ).replace(/\s+/g, ' ').trim().slice(0, 1000);
    const numericOnly = field?.validation?.numericOnly === true
      || /\b(?:numeric|numbers?|digits?)\s+only\b|\bonly\s+(?:numbers?|digits?)\b|\b(?:enter|provide|must be|requires?)\s+(?:a\s+)?(?:valid\s+)?(?:numeric|number|digits?)\b/i.test(hint);
    const validation = { inputType, inputMode, numericOnly };
    if (hint) validation.hint = hint;
    for (const key of ['min', 'max', 'step', 'pattern']) {
      const value = field?.validation?.[key] ?? constraints[key];
      if (value != null && String(value).trim()) validation[key] = String(value).slice(0, 500);
    }
    for (const key of ['minLength', 'maxLength']) {
      const value = Number(field?.validation?.[key] ?? constraints[key]);
      if (Number.isInteger(value) && value >= 0) validation[key] = value;
    }
    return validation;
  }

  function validateAnswerForField(field, answer) {
    const value = String(answer ?? '').trim();
    if (!value) {
      return field?.required
        ? { status: 'invalid', reason: 'a value is required' }
        : { status: 'valid' };
    }

    const validation = captureValidation(field);
    const type = String(validation.inputType || '').toLowerCase();
    const inputMode = String(validation.inputMode || '').toLowerCase();
    const minLength = validation.minLength;
    const maxLength = validation.maxLength;
    if (Number.isInteger(minLength) && value.length < minLength) {
      return { status: 'invalid', reason: `minimum length is ${minLength}` };
    }
    if (Number.isInteger(maxLength) && value.length > maxLength) {
      return { status: 'invalid', reason: `maximum length is ${maxLength}` };
    }
    if (validation.pattern) {
      try {
        if (!new RegExp(`^(?:${validation.pattern})$`).test(value)) {
          return { status: 'invalid', reason: 'value does not match the page pattern' };
        }
      } catch {
        return { status: 'unknown', reason: 'the page pattern could not be interpreted safely' };
      }
    }

    const numericType = ['number', 'range'].includes(type);
    const numericInput = validation.numericOnly || inputMode === 'numeric' || inputMode === 'decimal';
    if (numericType || numericInput) {
      const numberPattern = numericType || inputMode === 'decimal'
        ? /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i
        : /^\d+$/;
      if (!numberPattern.test(value)) {
        return {
          status: 'invalid',
          reason: numericInput && !numericType
            ? 'page accepts digits only'
            : 'page requires a numeric value without units or other text',
        };
      }
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) {
        return { status: 'invalid', reason: 'value is not a finite number' };
      }
      const minimum = validation.min === undefined ? null : Number(validation.min);
      const maximum = validation.max === undefined ? null : Number(validation.max);
      if ((validation.min !== undefined && !Number.isFinite(minimum))
        || (validation.max !== undefined && !Number.isFinite(maximum))) {
        return { status: 'unknown', reason: 'the page numeric range could not be interpreted safely' };
      }
      if (minimum !== null && Number.isFinite(minimum) && numericValue < minimum) {
        return { status: 'invalid', reason: `value is below the minimum ${minimum}` };
      }
      if (maximum !== null && Number.isFinite(maximum) && numericValue > maximum) {
        return { status: 'invalid', reason: `value is above the maximum ${maximum}` };
      }
      const step = validation.step === undefined || validation.step === 'any'
        ? null
        : Number(validation.step);
      if (validation.step !== undefined && validation.step !== 'any'
        && (!Number.isFinite(step) || step <= 0)) {
        return { status: 'unknown', reason: 'the page numeric step could not be interpreted safely' };
      }
      if (step !== null && Number.isFinite(step) && step > 0) {
        const base = minimum !== null && Number.isFinite(minimum) ? minimum : 0;
        const offset = (numericValue - base) / step;
        if (Math.abs(offset - Math.round(offset)) > 1e-8) {
          return { status: 'invalid', reason: `value must follow the page step ${step}` };
        }
      }
      return { status: 'valid' };
    }

    if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return { status: 'invalid', reason: 'value is not a valid email address' };
    }
    if (type === 'url') {
      try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) {
          return { status: 'invalid', reason: 'page requires an HTTP or HTTPS URL' };
        }
      } catch {
        return { status: 'invalid', reason: 'value is not a valid URL' };
      }
    }
    if (['date', 'datetime-local', 'month', 'time', 'week'].includes(type)) {
      return { status: 'unknown', reason: `page requires ${type} formatting that is not yet verified` };
    }
    return { status: 'valid' };
  }

  function getDomStructure(field) {
    const evidence = field?.domEvidence || {};
    const node = (item) => ({
      tag: clean(item?.tag),
      role: clean(item?.role),
      testId: clean(item?.testId),
      automationId: clean(item?.automationId),
    });
    return {
      control: node(evidence.control),
      ancestors: (Array.isArray(evidence.ancestors) ? evidence.ancestors : []).map(node),
    };
  }

  function getStableClassEvidence(field) {
    const evidence = field?.domEvidence || {};
    return {
      control: stableClassNames(evidence.control?.classNames),
      ancestors: (Array.isArray(evidence.ancestors) ? evidence.ancestors : [])
        .map((node) => stableClassNames(node?.classNames)),
    };
  }

  function meaningfulFieldChanges(first, second) {
    const changes = [];
    if (clean(first?.label || first?.question) !== clean(second?.label || second?.question)) changes.push('label');
    if (clean(first?.fieldType) !== clean(second?.fieldType)) changes.push('field type');
    if (Boolean(first?.required) !== Boolean(second?.required)) changes.push('required state');
    if (JSON.stringify(captureValidation(first)) !== JSON.stringify(captureValidation(second))) {
      changes.push('input validation');
    }
    if (JSON.stringify((first?.options || []).map(clean)) !== JSON.stringify((second?.options || []).map(clean))) {
      changes.push('options');
    }
    if (clean(first?.sectionHeading) !== clean(second?.sectionHeading)) changes.push('section');

    const firstHints = first?.selectorHints || {};
    const secondHints = second?.selectorHints || {};
    for (const key of STRONG_HINTS) {
      const firstStable = isStableHint(key, firstHints[key]);
      const secondStable = isStableHint(key, secondHints[key]);
      if (firstStable && secondStable && clean(firstHints[key]) !== clean(secondHints[key])) {
        changes.push(`locator ${key}`);
      } else if ((firstStable && !secondHints[key]) || (secondStable && !firstHints[key])) {
        changes.push(`locator ${key}`);
      }
    }

    const firstStructure = getDomStructure(first);
    const secondStructure = getDomStructure(second);
    if (JSON.stringify(firstStructure) !== JSON.stringify(secondStructure)) changes.push('DOM structure');

    const classesChanged = JSON.stringify(getStableClassEvidence(first)) !== JSON.stringify(getStableClassEvidence(second));
    if (classesChanged && !hasStrongLocator(first) && !hasStrongLocator(second)) {
      changes.push('class-based locator evidence');
    }
    return { changes: [...new Set(changes)], classesChanged };
  }

  function findMatchingRule(field, rules) {
    const fieldId = String(field?.stableFieldId || '');
    const stepFieldId = getRuleFieldId(field);
    if (fieldId) {
      const exact = rules.find((rule) => {
        const savedId = String(rule?.field_id || '');
        const savedPageStep = clean(rule?.context?.pageStep);
        const currentPageStep = clean(field?.pageStep);
        return (savedId === fieldId || savedId === stepFieldId)
          && (!rule?.context?.stepKey || !field?.scannerStepKey
            || String(rule.context.stepKey) === String(field.scannerStepKey))
          && (!savedPageStep || !currentPageStep || savedPageStep === currentPageStep);
      });
      if (exact) return exact;
    }
    return null;
  }

  function captureFieldSnapshot(field) {
    const evidence = captureEvidence(field);
    return {
      label: String(field?.label || field?.question || '').slice(0, 1000),
      fieldType: String(field?.fieldType || 'unknown').slice(0, 64),
      required: Boolean(field?.required),
      options: (Array.isArray(field?.options) ? field.options : []).slice(0, 100).map((value) => String(value).slice(0, 300)),
      validation: captureValidation(field),
      section: String(field?.sectionHeading || '').slice(0, 200),
      selectorHints: evidence.selectorHints,
      domEvidence: evidence.domEvidence,
    };
  }

  function ruleNeedsVerification(rule, field) {
    const snapshot = rule?.field_snapshot || field?.previousScannerCapture || {};
    const accepted = snapshot.captureCount === 2
      && (snapshot.captureVerified === true || snapshot.managerReviewed === true);
    if (!accepted) return true;
    const baseline = snapshot.fieldSnapshots?.[1] || {
      label: rule?.question,
      fieldType: snapshot.fieldType,
      required: snapshot.required,
      options: snapshot.options,
      validation: snapshot.validation,
      sectionHeading: snapshot.section,
      selectorHints: snapshot.selectorHints,
      domEvidence: snapshot.domEvidence,
    };
    const secondEvidence = snapshot.observations?.[1];
    const changes = meaningfulFieldChanges({
      ...baseline,
      sectionHeading: baseline.sectionHeading || baseline.section,
      selectorHints: baseline.selectorHints || secondEvidence?.selectorHints || snapshot.selectorHints,
      domEvidence: baseline.domEvidence || secondEvidence?.domEvidence || snapshot.domEvidence,
    }, field);
    return changes.changes.length > 0;
  }

  function requiresSecondCapture(fields, rules) {
    if (!Array.isArray(fields) || fields.length === 0) return true;
    const savedRules = Array.isArray(rules) ? rules : [];
    return fields.some((field) => ruleNeedsVerification(findMatchingRule(field, savedRules), field));
  }

  function matchSecondObservation(first, remaining) {
    const firstKey = observationKey(first);
    let index = remaining.findIndex((field) => observationKey(field) === firstKey);
    if (index < 0) {
      const fallback = fieldFallbackKey(first);
      if (fallback) index = remaining.findIndex((field) => fieldFallbackKey(field) === fallback);
    }
    if (index < 0) return null;
    return remaining.splice(index, 1)[0];
  }

  function captureEvidence(field) {
    const evidence = field?.domEvidence || {};
    return {
      selectorHints: {
        tag: String(field?.selectorHints?.tag || '').slice(0, 40),
        id: String(field?.selectorHints?.id || '').slice(0, 200),
        name: String(field?.selectorHints?.name || '').slice(0, 200),
        role: String(field?.selectorHints?.role || '').slice(0, 80),
        testId: String(field?.selectorHints?.testId || '').slice(0, 200),
        automationId: String(field?.selectorHints?.automationId || '').slice(0, 200),
      },
      domEvidence: {
        control: {
          tag: String(evidence.control?.tag || '').slice(0, 40),
          role: String(evidence.control?.role || '').slice(0, 80),
          classNames: (evidence.control?.classNames || []).slice(0, 4).map((value) => String(value).slice(0, 50)),
          testId: String(evidence.control?.testId || '').slice(0, 200),
          automationId: String(evidence.control?.automationId || '').slice(0, 200),
        },
        ancestors: (evidence.ancestors || []).slice(0, 3).map((node) => ({
          tag: String(node?.tag || '').slice(0, 40),
          role: String(node?.role || '').slice(0, 80),
          classNames: (node?.classNames || []).slice(0, 4).map((value) => String(value).slice(0, 50)),
          testId: String(node?.testId || '').slice(0, 200),
          automationId: String(node?.automationId || '').slice(0, 200),
        })),
      },
    };
  }

  function reconcileCaptures(firstFields, secondFields) {
    const first = Array.isArray(firstFields) ? firstFields : [];
    const remaining = Array.isArray(secondFields) ? [...secondFields] : [];
    const fields = [];
    const discrepancies = [];

    for (const firstField of first) {
      const secondField = matchSecondObservation(firstField, remaining);
      if (!secondField) {
        discrepancies.push({ kind: 'missing_on_second', first: firstField, second: null });
        continue;
      }
      const comparison = meaningfulFieldChanges(firstField, secondField);
      if (comparison.changes.length) {
        discrepancies.push({
          kind: 'changed_between_captures',
          changes: comparison.changes,
          first: firstField,
          second: secondField,
        });
        continue;
      }
      fields.push({
        ...secondField,
        scannerCapture: {
          captureCount: 2,
          captureVerified: true,
          managerReviewed: false,
          observations: [captureEvidence(firstField), captureEvidence(secondField)],
          fieldSnapshots: [captureFieldSnapshot(firstField), captureFieldSnapshot(secondField)],
          classEvidenceChanged: comparison.classesChanged,
        },
      });
    }

    for (const secondField of remaining) {
      discrepancies.push({ kind: 'new_on_second', first: null, second: secondField });
    }
    return { fields, discrepancies };
  }

  function acceptReviewedObservation(field, firstField = null) {
    return {
      ...field,
      scannerCapture: {
        captureCount: 2,
        captureVerified: false,
        managerReviewed: true,
        observations: [firstField ? captureEvidence(firstField) : null, captureEvidence(field)],
        fieldSnapshots: [firstField ? captureFieldSnapshot(firstField) : null, captureFieldSnapshot(field)],
      },
    };
  }

  return {
    captureEvidence,
    captureFieldSnapshot,
    captureValidation,
    deriveStepKey,
    findMatchingRule,
    getRuleFieldId,
    hasManagerConfirmedFieldIdentity,
    meaningfulFieldChanges,
    validateAnswerForField,
    requiresSecondCapture,
    reconcileCaptures,
    acceptReviewedObservation,
  };
});
