import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {render,renderComment,webLink} from '../src/markup.js';
import {zonedTime} from '../src/time.js';

test('Markdown escapes HTML and supports dedicated handwriting and emphasis',()=>{
  const html=render('## My title\n\n*italic* **bold**\n\n:::handwriting Note <script>\n\n<img src=x onerror=alert(1)>').html;
  assert.match(html,/<em>italic<\/em>/);
  assert.match(html,/<aside class="handwriting">Note &lt;script&gt;/);
  assert.match(html,/id="section-my-title"/);
  assert.doesNotMatch(html,/<script>|<img/);
});
test('post and comment renderers constrain links and image sources',()=>{
  const sample='[Okay](/blog/okay/) [No](javascript:alert(1)) ![Remote](https://example.com/a.jpg) [Bad](//example.com)';
  const html=render(sample,{base:'/demo'}).html;
  assert.match(html,/href="\/demo\/blog\/okay\//);
  assert.doesNotMatch(html,/href="javascript|<img|href="\/\/example/);
  assert.doesNotMatch(renderComment(sample),/<img|href="javascript/);
  assert.equal(webLink('https://secret:secret@example.com'),'');
});
test('zoned scheduling uses the selected site timezone and rejects DST gaps',()=>{
  assert.equal(zonedTime('2026-11-18T09:00','Europe/Prague'),'2026-11-18T08:00:00.000Z');
  assert.throws(()=>zonedTime('2026-03-29T02:15','Europe/Prague'),/skipped or repeated/);
  assert.throws(()=>zonedTime('2026-10-25T02:15','Europe/Prague'),/skipped or repeated/);
});
