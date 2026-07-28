import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window as unknown as Window & typeof globalThis);

const ALLOWED_TAGS = [
  'p',
  'br',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'a',
  'ul',
  'ol',
  'li',
  'blockquote',
  'code',
  'pre',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
];

const ALLOWED_ATTR = ['href', 'title'];

/**
 * Strips unsafe HTML (script tags, event handlers, disallowed elements) from
 * post body content before it is persisted, while preserving basic rich-text
 * formatting. Applied on the create/update path so nothing unsanitized is
 * ever stored.
 */
export function sanitizePostBody(body: string): string {
  return DOMPurify.sanitize(body, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });
}
