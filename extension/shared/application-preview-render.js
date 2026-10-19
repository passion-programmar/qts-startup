// Preview input rendering — match job form control types in Review panel

function getPreviewControlType(field) {
  const fieldType = String(field?.fieldType || 'text').toLowerCase();
  if (fieldType === 'file' || field?.category === 'document_upload') return 'file';
  if (fieldType === 'switch') return 'switch';
  if (fieldType === 'checkbox') return 'checkbox';
  if (fieldType === 'radio') return 'radio';
  if (fieldType === 'select' || fieldType === 'combobox' || fieldType === 'listbox') return 'select';
  if (fieldType === 'textarea' || fieldType === 'contenteditable') return 'textarea';
  if (fieldType === 'email' || field?.profileKey === 'email') return 'email';
  if (fieldType === 'tel' || field?.profileKey === 'phone') return 'tel';
  if (field?.category === 'ai_generation') return 'textarea';
  return 'text';
}

function formatPreviewValue(field) {
  if (field?.category === 'document_upload' && field?.fillStatus === 'awaiting_answer') {
    return field?.documentSlot === 'cover_letter' ? 'Cover letter PDF (via GPT)' : 'Resume PDF (via GPT)';
  }
  if (field?.fillStatus === 'skipped') {
    if (field?.category === 'document_upload' || field?.fieldType === 'file') return 'Skip';
    if (field?.fieldType === 'checkbox' || field?.fieldType === 'switch') return 'false';
  }
  if (field?.category === 'document_upload' || field?.fieldType === 'file') {
    return field?.documentSlot === 'cover_letter' ? 'Cover letter PDF (via GPT)' : 'Resume PDF (via GPT)';
  }
  if (field?.category === 'ai_generation') {
    return field?.generatedAnswer || field?.fillValue || '';
  }
  if (field?.fieldType === 'checkbox' || field?.fieldType === 'switch') {
    if (field?.fillStatus === 'filled' && field?.fillValue != null) return field.fillValue;
    return field?.currentValue ?? field?.fillValue ?? 'false';
  }
  return field?.fillValue ?? field?.currentValue ?? '';
}

function isPreviewEditable(field) {
  if (field?.fillStatus === 'skipped') return false;
  if (field?.category === 'document_upload' || field?.fieldType === 'file') return false;
  return true;
}

function isCheckedValue(value) {
  return /^(true|yes|1|on)$/i.test(String(value || '').trim());
}

function renderPreviewInput(field, index, escHtml, escAttr) {
  const inputId = `preview-field-${index}`;
  const stableId = escAttr(field.stableFieldId || '');
  const controlType = getPreviewControlType(field);
  const value = formatPreviewValue(field);
  const editable = isPreviewEditable(field);

  if (!editable || controlType === 'file') {
    return `<span class="application-preview-readonly">${escHtml(value || '—')}</span>`;
  }

  if (controlType === 'checkbox') {
    const checked = isCheckedValue(value);
    return `<label class="application-preview-check">
      <input type="checkbox" id="${inputId}" data-stable-id="${stableId}" data-control-type="checkbox" ${checked ? 'checked' : ''}>
      <span>${checked ? 'Checked' : 'Unchecked'}</span>
    </label>`;
  }

  if (controlType === 'switch') {
    const on = isCheckedValue(value);
    return `<label class="application-preview-check application-preview-switch">
      <input type="checkbox" id="${inputId}" data-stable-id="${stableId}" data-control-type="switch" class="preview-switch-input" ${on ? 'checked' : ''}>
      <span>${on ? 'On' : 'Off'}</span>
    </label>`;
  }

  if (controlType === 'select' || controlType === 'radio') {
    const options = Array.isArray(field.options) ? field.options.filter(Boolean) : [];
    if (!options.length) {
      return `<input type="text" id="${inputId}" data-stable-id="${stableId}" data-control-type="text" value="${escAttr(value)}">`;
    }
    const optionHtml = ['<option value="">—</option>']
      .concat(options.map((opt) => {
        const selected = String(opt).toLowerCase() === String(value).toLowerCase() ? ' selected' : '';
        return `<option value="${escAttr(opt)}"${selected}>${escHtml(opt)}</option>`;
      }))
      .join('');
    return `<select id="${inputId}" data-stable-id="${stableId}" data-control-type="${controlType}">${optionHtml}</select>`;
  }

  if (controlType === 'textarea') {
    return `<textarea id="${inputId}" data-stable-id="${stableId}" data-control-type="textarea" rows="3" placeholder="${escAttr(field.placeholder || '')}">${escHtml(value)}</textarea>`;
  }

  return `<input type="${controlType}" id="${inputId}" data-stable-id="${stableId}" data-control-type="${controlType}" value="${escAttr(value)}" placeholder="${escAttr(field.placeholder || '')}">`;
}

function readPreviewInput(field, index) {
  const input = document.getElementById(`preview-field-${index}`);
  if (!input) return formatPreviewValue(field);

  const controlType = input.getAttribute('data-control-type') || getPreviewControlType(field);
  if (controlType === 'checkbox' || controlType === 'switch') {
    return input.checked ? 'true' : 'false';
  }
  if (controlType === 'select' || controlType === 'radio') {
    return input.value;
  }
  return String(input.value || '').trim();
}

function applyPreviewEdits(classifiedFields) {
  return classifiedFields.map((field, index) => {
    if (!isPreviewEditable(field)) return { ...field };
    const edited = readPreviewInput(field, index);
    if (edited === '' && field.category === 'ai_generation') {
      return { ...field };
    }
    const next = {
      ...field,
      fillValue: edited,
    };
    if (field.category === 'ai_generation') {
      next.generatedAnswer = edited;
      next.fillStatus = edited ? 'awaiting_answer' : field.fillStatus;
    } else if (edited) {
      next.fillStatus = 'filled';
    }
    return next;
  });
}

if (typeof window !== 'undefined') {
  window.__qtsApplicationPreview = {
    getPreviewControlType,
    formatPreviewValue,
    isPreviewEditable,
    renderPreviewInput,
    readPreviewInput,
    applyPreviewEdits,
  };
}
