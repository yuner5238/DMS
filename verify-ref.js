const fs = require('fs');
const cm = fs.readFileSync('public/js/common.js', 'utf8');
const app = fs.readFileSync('public/js/app.js', 'utf8');
const dev = fs.readFileSync('public/device.html', 'utf8');
const idx = fs.readFileSync('public/index.html', 'utf8');

const fns = ['showToast','escapeHtml','escapeAttr','escapeOnClick','formatDate','formatDateInput','formatFileSize','getAttachmentIconClass','truncateFilename','encodeRichText','sanitizeRichTextHtml','decodeRichText','execCmd','showTablePicker','insertTableHtml','toggleColorPanel','applyColor','toggleFontSizePanel','applyFontSize','insertImageToRemark','closeImageInsertPopup','triggerImageUpload','convertImageUrl','handleImagePickerUpload','insertHTMLAtCursor','setupImagePaste','setupImageContextMenu','setImageSize','showImageFullscreen','uploadAndInsertImage'];

const def = (src, f) => new RegExp('function\\s+' + f + '\\b').test(src);
const used = (src, f) => new RegExp('\\b' + f + '\\s*\\(').test(src);

const cmDefs = new Set(fns.filter(f => def(cm, f)));
let bad = [];
for (const f of fns) {
    if (used(app, f) && !def(app, f) && !cmDefs.has(f)) bad.push('app.js -> ' + f);
    if (used(dev, f) && !def(dev, f) && !cmDefs.has(f)) bad.push('device.html -> ' + f);
    if (used(idx, f) && !cmDefs.has(f)) bad.push('index.html -> ' + f);
}
console.log('common.js 提供:', cmDefs.size + '/' + fns.length);
console.log(bad.length ? '缺失引用:\n  ' + bad.join('\n  ') : '所有引用均可解析');

// 旧私有变量残留检查
for (const v of ['_imageUploadDeviceId', '_imageTargetEditorId']) {
    if (new RegExp('(?<!RT\\.)' + v).test(app)) console.log('app.js 残留旧变量:', v);
    if (dev.includes(v)) console.log('device.html 残留旧变量:', v);
}
console.log('旧变量检查完成');

// 引入顺序检查
const idxOrder = idx.indexOf('common.js') < idx.indexOf('app.js');
const devOrder = dev.indexOf('common.js') < dev.indexOf('<script>\n        // ===== API 配置');
console.log('index.html 加载顺序正确:', idxOrder);
console.log('device.html 加载顺序正确:', devOrder);
