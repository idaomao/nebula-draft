const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const SAFE_TAGS = new Set([
  'p',
  'div',
  'span',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'ul',
  'ol',
  'li',
  'br',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
]);

const SAFE_STYLE_PROPS = new Set([
  'text-align',
  'font-weight',
  'font-style',
  'text-decoration',
  'text-decoration-line',
  'color',
  'font-size',
]);

const unwrapElement = (element: Element) => {
  const parent = element.parentNode;
  if (!parent) {
    return;
  }

  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }

  parent.removeChild(element);
};

const sanitizeStyle = (styleValue: string): string =>
  styleValue
    .split(';')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const [propertyRaw, ...valueParts] = segment.split(':');
      const property = propertyRaw.trim().toLowerCase();
      if (!SAFE_STYLE_PROPS.has(property)) {
        return '';
      }

      const value = valueParts.join(':').trim().replace(/[<>]/g, '');
      if (!value) {
        return '';
      }

      return `${property}: ${value}`;
    })
    .filter((segment) => segment.length > 0)
    .join('; ');

const sanitizeRichText = (value: string): string => {
  if (typeof window === 'undefined' || typeof window.DOMParser === 'undefined') {
    return value;
  }

  const parser = new window.DOMParser();
  const doc = parser.parseFromString(value, 'text/html');
  const elements = Array.from(doc.body.querySelectorAll('*'));

  elements.forEach((element) => {
    const tagName = element.tagName.toLowerCase();

    if (!SAFE_TAGS.has(tagName)) {
      unwrapElement(element);
      return;
    }

    const attributes = Array.from(element.attributes);
    attributes.forEach((attribute) => {
      const name = attribute.name.toLowerCase();

      if (name === 'style') {
        const sanitizedStyle = sanitizeStyle(attribute.value);
        if (sanitizedStyle) {
          element.setAttribute('style', sanitizedStyle);
        } else {
          element.removeAttribute(attribute.name);
        }
        return;
      }

      element.removeAttribute(attribute.name);
    });
  });

  return doc.body.innerHTML.trim();
};

export const normalizeRichText = (value: string): string => {
  const trimmed = sanitizeRichText(value.trim());
  if (trimmed.length === 0) {
    return '<p><br/></p>';
  }
  return trimmed;
};

export const plainTextToRichText = (value: string): string => {
  const escaped = escapeHtml(value);
  if (escaped.length === 0) {
    return '<p><br/></p>';
  }
  return escaped.replace(/\r?\n/g, '<br/>');
};

const stripTagsToTextFallback = (value: string): string =>
  value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|h1|h2|h3|h4|h5|h6)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const richTextToPlainText = (value: string): string => {
  if (typeof window !== 'undefined' && typeof window.DOMParser !== 'undefined') {
    const parser = new window.DOMParser();
    const doc = parser.parseFromString(value, 'text/html');
    return (doc.body.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  return stripTagsToTextFallback(value);
};

export const getNoteDisplayText = (text: string, richText: string): string => {
  const normalized = normalizeRichText(richText);
  const plain = richTextToPlainText(normalized);
  return plain.length > 0 ? plain : text;
};
