import { sanitizePostBody } from './sanitize-post-body';

describe('sanitizePostBody', () => {
  it('strips script tags', () => {
    const result = sanitizePostBody('<p>Hello</p><script>alert(1)</script>');
    expect(result).not.toContain('<script');
    expect(result).not.toContain('alert(1)');
    expect(result).toContain('Hello');
  });

  it('strips inline event handler attributes', () => {
    const result = sanitizePostBody('<a href="https://example.com" onclick="alert(1)">link</a>');
    expect(result).not.toContain('onclick');
    expect(result).toContain('href="https://example.com"');
  });

  it('strips img onerror payloads', () => {
    const result = sanitizePostBody('<img src=x onerror="alert(1)">');
    expect(result).not.toContain('onerror');
    expect(result).not.toContain('<img');
  });

  it('strips javascript: URLs', () => {
    const result = sanitizePostBody('<a href="javascript:alert(1)">click me</a>');
    expect(result.toLowerCase()).not.toContain('javascript:');
  });

  it('strips svg/onload based payloads', () => {
    const result = sanitizePostBody('<svg onload="alert(1)"></svg>');
    expect(result).not.toContain('onload');
    expect(result).not.toContain('<svg');
  });

  it('strips iframe elements', () => {
    const result = sanitizePostBody('<iframe src="javascript:alert(1)"></iframe>');
    expect(result).not.toContain('<iframe');
  });

  it('strips style tags and attributes', () => {
    const result = sanitizePostBody('<style>body{background:url(x)}</style><p style="color:red">hi</p>');
    expect(result).not.toContain('<style');
    expect(result).not.toContain('style=');
    expect(result).toContain('hi');
  });

  it('preserves bold, italic, links, and lists', () => {
    const input = '<p><b>bold</b> <i>italic</i> <a href="https://example.com">link</a></p><ul><li>one</li><li>two</li></ul>';
    const result = sanitizePostBody(input);
    expect(result).toContain('<b>bold</b>');
    expect(result).toContain('<i>italic</i>');
    expect(result).toContain('<a href="https://example.com">link</a>');
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>one</li>');
  });

  it('preserves plain text with no markup', () => {
    expect(sanitizePostBody('Just plain text.')).toBe('Just plain text.');
  });
});
