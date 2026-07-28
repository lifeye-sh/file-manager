'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');

test('main page uses only local preview scripts', () => {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  assert.match(html, /<script src="\/markdown-preview\.js"><\/script>/);
  assert.doesNotMatch(html, /cdnjs|mozilla\.github\.io|DOMPurify|marked\.min|pdf\.min/i);
});

test('preview code renders Markdown through safe DOM helper and PDFs from same origin', () => {
  const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  assert.match(app, /fileManagerMarkdown\.render/);
  assert.doesNotMatch(app, /DOMPurify|marked\.parse|mozilla\.github\.io/i);
  assert.match(app, /iframe\.src = url/);
});
