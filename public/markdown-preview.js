'use strict';

(() => {
  function safeLink(value) {
    const href = String(value || '').trim();
    if (/^(?:https?:|mailto:|#|\/|\.{1,2}\/)/i.test(href)) return href;
    return '';
  }

  function appendInline(parent, source) {
    const text = String(source || '');
    const token = /(`[^`\n]+`|\[[^\]\n]+\]\([^\s)\n]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
    let offset = 0;
    for (const match of text.matchAll(token)) {
      parent.append(document.createTextNode(text.slice(offset, match.index)));
      const value = match[0];
      let element;
      if (value.startsWith('`')) {
        element = document.createElement('code');
        element.textContent = value.slice(1, -1);
      } else if (value.startsWith('[')) {
        const parts = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(value);
        const href = parts && safeLink(parts[2]);
        if (href) {
          element = document.createElement('a');
          element.textContent = parts[1];
          element.href = href;
          if (/^https?:/i.test(href)) {
            element.target = '_blank';
            element.rel = 'noopener noreferrer';
          }
        }
      } else {
        element = document.createElement(value.startsWith('**') || value.startsWith('__') ? 'strong' : 'em');
        element.textContent = value.slice(value.startsWith('**') || value.startsWith('__') ? 2 : 1, value.startsWith('**') || value.startsWith('__') ? -2 : -1);
      }
      if (element) parent.append(element);
      else parent.append(document.createTextNode(value));
      offset = match.index + value.length;
    }
    parent.append(document.createTextNode(text.slice(offset)));
  }

  function renderMarkdown(container, source) {
    container.replaceChildren();
    const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
    let codeBlock = null;
    let list = null;
    let paragraph = [];

    const flushParagraph = () => {
      if (!paragraph.length) return;
      const p = document.createElement('p');
      appendInline(p, paragraph.join(' '));
      container.append(p);
      paragraph = [];
    };
    const flushList = () => { list = null; };

    for (const line of lines) {
      if (/^```/.test(line)) {
        flushParagraph();
        flushList();
        if (codeBlock) {
          container.append(codeBlock);
          codeBlock = null;
        } else {
          codeBlock = document.createElement('pre');
          codeBlock.append(document.createElement('code'));
        }
        continue;
      }
      if (codeBlock) {
        const code = codeBlock.firstChild;
        code.textContent += `${code.textContent ? '\n' : ''}${line}`;
        continue;
      }
      if (!line.trim()) {
        flushParagraph();
        flushList();
        continue;
      }
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading) {
        flushParagraph();
        flushList();
        const h = document.createElement(`h${heading[1].length}`);
        appendInline(h, heading[2]);
        container.append(h);
        continue;
      }
      if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) {
        flushParagraph();
        flushList();
        container.append(document.createElement('hr'));
        continue;
      }
      const quote = /^>\s?(.*)$/.exec(line);
      if (quote) {
        flushParagraph();
        flushList();
        const blockquote = document.createElement('blockquote');
        appendInline(blockquote, quote[1]);
        container.append(blockquote);
        continue;
      }
      const listItem = /^\s*(?:(\d+)\.|[-+*])\s+(.+)$/.exec(line);
      if (listItem) {
        flushParagraph();
        const tag = listItem[1] ? 'ol' : 'ul';
        if (!list || list.tagName.toLowerCase() !== tag) {
          list = document.createElement(tag);
          container.append(list);
        }
        const li = document.createElement('li');
        appendInline(li, listItem[2]);
        list.append(li);
        continue;
      }
      flushList();
      paragraph.push(line.trim());
    }
    flushParagraph();
    if (codeBlock) container.append(codeBlock);
  }

  window.fileManagerMarkdown = Object.freeze({ render: renderMarkdown });
})();
