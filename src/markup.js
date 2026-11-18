import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import xml from 'highlight.js/lib/languages/xml';

for (const [name, language] of Object.entries({bash, css, javascript, json, python, sql, xml})) {
  hljs.registerLanguage(name, language);
}

export const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);
export const slugify = value => String(value ?? '').normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

export function webLink(value) {
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href;
    if (url.protocol === 'mailto:' && /^[^?\s]+@[^?\s]+$/.test(url.pathname) && !url.search) return url.href;
  } catch {}
  return '';
}

const note = (state, start, end, silent) => {
  const line = state.getLines(start, start + 1, 0, false).trim();
  if (!line.startsWith(':::handwriting ')) return false;
  if (silent) return true;
  const token = state.push('handwriting', 'aside', 0);
  token.content = line.slice(15).trim();
  state.line = start + 1;
  return true;
};

const markdown = new MarkdownIt({ html: false, breaks: false, linkify: false });
markdown.block.ruler.before('paragraph', 'handwriting', note, {alt: ['paragraph']});
markdown.renderer.rules.handwriting = (tokens, index) =>
  '<aside class="handwriting">' + esc(tokens[index].content) + '</aside>\n';

const plainComments = new MarkdownIt({html: false, breaks: true})
  .disable(['image', 'table', 'heading', 'lheading', 'fence', 'code', 'hr', 'blockquote']);

function tokenText(token) {
  if (token.type === 'image') return token.content;
  if (token.children) return token.children.map(tokenText).join('');
  return ['text', 'code_inline', 'fence', 'code_block', 'handwriting'].includes(token.type) ? token.content : '';
}

function safeLink(tokens, index, options, env, renderer) {
  const token = tokens[index];
  const href = token.attrGet('href');
  const absolute = webLink(href);
  const internal = href?.startsWith('#') || !href?.startsWith('//') && /^\/[a-z0-9/_-]+(?:#[a-z0-9_-]+)?$/i.test(href ?? '');
  token.attrSet('href', absolute || (internal ? href.startsWith('/') ? (env.base ?? '') + href : href : '#'));
  token.attrSet('data-content-link', '');
  token.attrSet('rel', env.comment ? 'ugc nofollow' : 'noopener');
  return renderer.renderToken(tokens, index, options);
}
markdown.renderer.rules.link_open = safeLink;
plainComments.renderer.rules.link_open = safeLink;

function imageMarkup(reference, alt, media, base, inline = false, title = '') {
  const [key, layout] = String(reference ?? '').split('#');
  const asset = media[key];
  if (!asset) return '';
  const safeSrc = source => {
    if (/^assets\/[a-z0-9/_-]+\.(?:png|webp|jpg)$/i.test(source)) return base + '/' + source;
    const url = webLink(source);
    if (!url) return '';
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && /^\/storage\/v1\/object\/(?:public|sign)\/diaries-(?:media|private)\/[a-z0-9.\/_-]+$/i.test(parsed.pathname) ? url : '';
  };
  const source = safeSrc(asset.src);
  if (!source) return '';
  const widths = Object.entries(asset.variants ?? {}).filter(([w, src]) => /^\d{2,4}$/.test(w) && safeSrc(src));
  const sizes = widths.length ? ' srcset="' + esc(widths.map(([w, src]) => safeSrc(src) + ' ' + w + 'w').join(', ')) + '" sizes="(max-width: 760px) 92vw, 740px"' : '';
  const dimensions = ['width', 'height'].map(key => Number.isInteger(+asset[key]) && +asset[key] > 0 ? ' ' + key + '="' + +asset[key] + '"' : '').join('');
  const caption = [title || asset.caption, asset.credit].filter(Boolean).map(esc).join(' · ');
  const captionLink = webLink(asset.caption_url);
  return '<span class="article-image image-' + (['wide','full'].includes(layout) ? layout : 'inline') + '"><img src="' + esc(source) + '"' + sizes + dimensions + ' alt="' + esc(alt ?? asset.alt) + '" loading="' + (inline ? 'eager' : 'lazy') + '" decoding="async" data-lightbox>' +
    (caption ? '<small>' + (captionLink ? '<a href="' + esc(captionLink) + '">' + caption + '</a>' : caption) + '</small>' : '') + '</span>';
}
markdown.renderer.rules.image = (tokens, index, options, env) => {
  const token = tokens[index];
  return imageMarkup(token.attrGet('src'), tokenText(token), env.media, env.base, false, token.attrGet('title'));
};
markdown.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index];
  const language = token.info.trim().split(/\s+/)[0].toLowerCase();
  const code = hljs.getLanguage(language) ? hljs.highlight(token.content, {language, ignoreIllegals: true}).value : esc(token.content);
  return '<div class="code-block"><pre><code>' + code + '</code></pre></div>\n';
};

export function render(body, {media = {}, base = ''} = {}) {
  const env = {media, base};
  const tokens = markdown.parse(String(body ?? ''), env);
  const headings = [];
  const ids = new Map();
  let paragraphs = 0;
  for (const [i, token] of tokens.entries()) {
    if (token.type === 'paragraph_close' && token.level === 0) {
      paragraphs++;
    }
    if (token.type !== 'heading_open') continue;
    const label = tokenText(tokens[i + 1]).trim();
    const stem = slugify(label) || 'heading';
    const count = (ids.get(stem) ?? 0) + 1;
    ids.set(stem, count);
    const id = count > 1 ? stem + '-' + count : stem;
    token.attrSet('id', 'section-' + id);
    headings.push({id: 'section-' + id, label, level: Number(token.tag.slice(1))});
  }
  return {html: markdown.renderer.render(tokens, markdown.options, env), headings, text: tokens.map(tokenText).filter(Boolean).join(' '), paragraphs};
}

export function renderComment(body, base = '') {
  return plainComments.render(String(body ?? ''), {comment: true, base});
}

export function coverImage(reference, alt, media, base) {
  return imageMarkup(reference, alt, media, base, true);
}

export function galleryMarkup(ids,media,base) {
  if (!Array.isArray(ids)) return '';
  const pictures=ids.map(id=>imageMarkup(id+'#full',undefined,media,base)).filter(Boolean);
  return pictures.length?'<div class="article-gallery" aria-label="Image gallery">'+pictures.join('')+'</div>':'';
}
