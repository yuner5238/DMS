/**
 * common.js — 公共工具与富文本备注模块（index.html / device.html 共用）
 * 消除此前两页面各抄一份导致的版本漂移（escapeOnClick 两版行为不同等问题）。
 *
 * 页面按需注入 RT 配置：
 *   RT.getDeviceId()   返回当前上传图片归属的设备ID（device_id 码）
 *   RT.getEditor()     返回富文本插入目标编辑器元素
 *   RT.onImageInserted() 图片插入成功后的回调（如更新"未保存修改"状态点）
 *   RT.apiBase()       上传接口前缀，默认 window.API_BASE || '/api'
 */

// ===== 页面注入配置（各页面加载后覆盖） =====
window.RT = Object.assign({
    getDeviceId: () => '',
    getEditor: () => null,
    onImageInserted: () => {},
    apiBase: () => (window.API_BASE || '/api'),
    _uploadDeviceId: null,   // insertImageToRemark 传入的设备ID
    _targetEditorId: null,   // insertImageToRemark 传入的编辑器ID
}, window.RT || {});

// localStorage 安全封装：Safari 无痕模式/存储被禁用/配额写满时访问会直接抛异常，
// 未加保护会导致调用处顶层脚本中断（整页白屏），故统一走此封装。
const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    remove(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

// ===== 转义工具 =====
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch])); }
function escapeAttr(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;'); }
function escapeOnClick(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, "\\'"); }

// ===== 格式化工具 =====
function formatDate(s) {
    if (!s) return '-';
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
}

function formatDateInput(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B','KB','MB','GB'];
    let i = 0, size = bytes;
    while (size >= 1024 && i < units.length-1) { size /= 1024; i++; }
    return size.toFixed(i===0?0:1) + ' ' + units[i];
}

function getAttachmentIconClass(ext) {
    if (ext==='pdf') return 'pdf';
    if (/^docx?$/.test(ext)) return 'doc';
    if (/^xlsx?$/.test(ext)||/^csv$/.test(ext)) return 'xls';
    if (/^(jpg|jpeg|png|gif|webp|bmp|svg)$/.test(ext)) return 'img';
    if (/^(zip|rar|7z|tar|gz)$/.test(ext)) return 'zip';
    return 'other';
}

function truncateFilename(name, maxLen) {
    if (!name || name.length <= maxLen) return name;
    const ext = name.lastIndexOf('.');
    if (ext > 0) {
        const extStr = name.slice(ext);
        const base = name.slice(0, ext);
        return base.slice(0, maxLen - extStr.length - 2) + '..' + extStr;
    }
    return name.slice(0, maxLen - 2) + '..';
}

// ===== Toast 通知（容器不存在时自动创建） =====
function showToast(msg, type) {
    type = type || 'info';
    let c = document.getElementById('toastContainer');
    if (!c) {
        c = document.createElement('div');
        c.id = 'toastContainer';
        c.className = 'toast-container';
        document.body.appendChild(c);
    }
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    const icons = { success: 'check-circle', error: 'x-circle', warning: 'exclamation-triangle', info: 'info-circle' };
    el.innerHTML = `<i class="bi bi-${icons[type]||'info-circle'}"></i> ${escapeHtml(msg)}`;
    c.appendChild(el);
    setTimeout(() => { el.style.opacity='0'; el.style.transform='translateX(20px)'; setTimeout(()=>el.remove(),300); }, 3000);
}

// ===== 富文本备注：编解码 =====
function encodeRichText(html) {
    if (!html) return '';
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    function processNode(node) {
        if (node.nodeType === 3) return node.textContent;
        if (node.nodeType === 1) {
            const tag = node.tagName.toLowerCase();
            let content = '';
            for (let child of node.childNodes) content += processNode(child);
            switch (tag) {
                case 'b': case 'strong': return `[B]${content}[/B]`;
                case 'i': case 'em': return `[I]${content}[/I]`;
                case 'u': return `[U]${content}[/U]`;
                case 's': case 'strike': case 'del': return `[S]${content}[/S]`;
                case 'font':
                    let color = node.getAttribute('color');
                    let size = node.getAttribute('size');
                    let fontBg = node.style.backgroundColor || (node.getAttribute('style')||'').match(/background-color:\s*([^;]+)/)?.[1]?.trim();
                    if (fontBg) return `[HIGHLIGHT=${fontBg}]${content}[/HIGHLIGHT]`;
                    if (color) return `[COLOR=${color}]${content}[/COLOR]`;
                    if (size) return `[SIZE=${size}]${content}[/SIZE]`;
                    return content;
                case 'span':
                    let spanBg = node.style.backgroundColor || (node.getAttribute('style')||'').match(/background-color:\s*([^;]+)/)?.[1]?.trim();
                    if (spanBg) return `[HIGHLIGHT=${spanBg}]${content}[/HIGHLIGHT]`;
                    return content;
                case 'br': return '\n';
                case 'div': case 'p': return content + '\n';
                case 'img': case 'table': case 'thead': case 'tbody': case 'tfoot': case 'tr': case 'th': case 'td':
                    return node.outerHTML;
                default: return content;
            }
        }
        return '';
    }
    let text = '';
    for (let child of tempDiv.childNodes) text += processNode(child);
    text = text.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
}

// 富文本 HTML 白名单消毒：只放行编辑器支持的标签与安全属性，杜绝事件属性/脚本注入
function sanitizeRichTextHtml(html) {
    if (!html) return '';
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const ALLOWED = new Set(['B','I','U','S','BR','DIV','P','FONT','SPAN','IMG','UL','OL','LI','TABLE','THEAD','TBODY','TFOOT','TR','TD','TH']);
    const REMOVE_ENTIRELY = new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','LINK','META','BASE','FORM','INPUT','BUTTON','TEXTAREA','SELECT','VIDEO','AUDIO','SVG','MATH','FRAME','FRAMESET']);
    const cleanColor = v => (/^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]{1,20}$/.test(v) ? v : null);
    const cleanNode = (el) => {
        Array.from(el.children).forEach(cleanNode);
        const tag = el.tagName;
        if (REMOVE_ENTIRELY.has(tag)) { el.remove(); return; }
        if (!ALLOWED.has(tag)) { el.replaceWith(...el.childNodes); return; }
        // 删除所有事件属性
        Array.from(el.attributes).forEach(attr => {
            if (attr.name.toLowerCase().startsWith('on') || attr.name.toLowerCase() === 'srcdoc' || attr.name.toLowerCase() === 'formaction') {
                el.removeAttribute(attr.name);
            }
        });
        if (tag === 'IMG') {
            const src = el.getAttribute('src') || '';
            if (!/^(\/api\/images\/|https?:\/\/)/.test(src)) { el.remove(); return; }
            const cls = (el.getAttribute('class') || '').trim();
            Array.from(el.attributes).forEach(a => { if (a.name !== 'src') el.removeAttribute(a.name); });
            if (/^img-size-(small|medium|large)$/.test(cls)) el.setAttribute('class', cls);
            else el.setAttribute('class', 'img-size-large');
        } else if (tag === 'FONT') {
            Array.from(el.attributes).forEach(a => { if (a.name !== 'color' && a.name !== 'size') el.removeAttribute(a.name); });
            const c = el.getAttribute('color'); if (c !== null && !cleanColor(c)) el.removeAttribute('color');
            const s = el.getAttribute('size'); if (s !== null && !/^[1-7]$/.test(s)) el.removeAttribute('size');
        } else if (tag === 'SPAN') {
            const style = el.getAttribute('style') || '';
            const m = style.match(/background-color\s*:\s*([^;]+)/i);
            el.removeAttribute('style');
            if (m) { const c = cleanColor(m[1].trim()); if (c) el.setAttribute('style', `background-color:${c};`); }
        } else if (tag === 'DIV' || tag === 'P') {
            const style = el.getAttribute('style') || '';
            const m = style.match(/text-align\s*:\s*(left|center|right|justify)/i);
            el.removeAttribute('style');
            el.removeAttribute('align');
            if (m) el.setAttribute('style', `text-align:${m[1]};`);
        } else if (tag === 'UL' || tag === 'OL') {
            Array.from(el.attributes).forEach(a => { if (a.name !== 'type' && a.name !== 'start') el.removeAttribute(a.name); });
        } else if (tag === 'TABLE') {
            Array.from(el.attributes).forEach(a => { if (a.name !== 'border' && a.name !== 'cellpadding' && a.name !== 'cellspacing') el.removeAttribute(a.name); });
        } else if (tag === 'TD' || tag === 'TH') {
            Array.from(el.attributes).forEach(a => { if (a.name !== 'colspan' && a.name !== 'rowspan') el.removeAttribute(a.name); });
        }
    };
    // 注意：tpl.content 是 DocumentFragment，没有 replaceWith，不能整体传给 cleanNode，只遍历其子元素
    Array.from(tpl.content.children).forEach(cleanNode);
    return tpl.innerHTML;
}

function decodeRichText(text) {
    if (!text) return '';
    // 先还原 literal \n（如果有的话），再按实际换行分割段落
    let raw = text.replace(/\\n/g, '\n');
    // 按连续换行（段落分隔）拆分
    const paragraphs = raw.split(/\n{2,}/);
    const processInline = function(part) {
        if (!part) return '';
        let html = part.replace(/\n/g, '<br>');
        html = html.replace(/\[B\]([\s\S]*?)\[\/B\]/gi, '<b>$1</b>');
        html = html.replace(/\[I\]([\s\S]*?)\[\/I\]/gi, '<i>$1</i>');
        html = html.replace(/\[U\]([\s\S]*?)\[\/U\]/gi, '<u>$1</u>');
        html = html.replace(/\[S\]([\s\S]*?)\[\/S\]/gi, '<s>$1</s>');
        html = html.replace(/\[COLOR=([^\]]+)\]([\s\S]*?)\[\/COLOR\]/gi, '<font color="$1">$2</font>');
        html = html.replace(/\[HIGHLIGHT=([^\]]+)\]([\s\S]*?)\[\/HIGHLIGHT\]/gi, '<span style="background-color:$1;">$2</span>');
        html = html.replace(/\[SIZE=([^\]]+)\]([\s\S]*?)\[\/SIZE\]/gi, '<font size="$1">$2</font>');
        return html;
    };
    let html = paragraphs.map(p => {
        const processed = processInline(p);
        return processed ? '<div>' + processed + '</div>' : '<div><br></div>';
    }).join('');
    html = html.replace(/https?:\/\/[^"'\s>]*\/images\/(\d+)\/([^"'\s>]+)/gi, '/api/images/$1/$2');
    // 白名单消毒：事件属性、非白名单标签（script 等）、非本站图片一律清除
    html = sanitizeRichTextHtml(html);
    // 为图片补充加载失败提示（此 onerror 为本代码注入的可信内容，在消毒之后追加）
    html = html.replace(/<img([^>]*)>/gi, function(match, attrs) {
        return `<img${attrs} onerror="this.style.display=\'none\'; this.insertAdjacentHTML(\'afterend\',\'<span style=color:var(--danger);font-size:12px;>[图片加载失败]</span>\');">`;
    });
    return html;
}

// ===== 编辑命令 =====
function execCmd(command, value) {
    document.execCommand(command, false, value || null);
}

// ===== 表格插入 =====
let _tablePickerRows = 6, _tablePickerCols = 6, _tablePickerOutsideHandler = null;

function showTablePicker(btn) {
    const existing = document.querySelector('.table-picker-popup');
    if (existing) { existing.remove(); return; }
    const rect = btn.getBoundingClientRect();
    const popup = document.createElement('div');
    popup.className = 'table-picker-popup';
    popup.style.left = rect.left + 'px';
    popup.style.top = (rect.bottom + 4) + 'px';
    let h = '<div class="table-picker-label" id="tablePickerLabel">1 × 1 表格</div><div class="table-picker-grid">';
    for (let r = 0; r < _tablePickerRows; r++)
        for (let c = 0; c < _tablePickerCols; c++)
            h += `<div class="table-picker-cell" data-row="${r}" data-col="${c}"></div>`;
    h += '</div>';
    popup.innerHTML = h;
    const cells = popup.querySelectorAll('.table-picker-cell');
    const label = popup.querySelector('#tablePickerLabel');
    cells.forEach(cell => {
        cell.addEventListener('mouseenter', function() {
            const r = parseInt(this.dataset.row), c = parseInt(this.dataset.col);
            label.textContent = `${r + 1} × ${c + 1} 表格`;
            cells.forEach(c2 => {
                const r2 = parseInt(c2.dataset.row), c2c = parseInt(c2.dataset.col);
                c2.classList.toggle('active', r2 <= r && c2c <= c);
            });
        });
        cell.addEventListener('click', function() {
            const r = parseInt(this.dataset.row) + 1, c = parseInt(this.dataset.col) + 1;
            popup.remove();
            insertTableHtml(r, c);
            document.removeEventListener('click', _tablePickerOutsideHandler);
        });
    });
    document.body.appendChild(popup);
    _tablePickerOutsideHandler = function(e) {
        if (!popup.contains(e.target) && e.target !== btn) {
            popup.remove();
            document.removeEventListener('click', _tablePickerOutsideHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', _tablePickerOutsideHandler), 0);
}

function insertTableHtml(rows, cols) {
    let h = '<div style="overflow-x:auto;margin:8px 0;"><table style="border-collapse:collapse;width:100%;min-width:300px;border:1px solid var(--border);"><thead><tr>';
    for (let c = 0; c < cols; c++) h += '<th style="border:1px solid var(--border);padding:6px 10px;background:var(--sidebar-bg);font-weight:600;text-align:left;min-width:60px;">&nbsp;</th>';
    h += '</tr></thead><tbody>';
    for (let r = 1; r < rows; r++) { h += '<tr>'; for (let c = 0; c < cols; c++) h += '<td style="border:1px solid var(--border);padding:6px 10px;min-width:60px;">&nbsp;</td>'; h += '</tr>'; }
    h += '</tbody></table></div>';
    execCmd('insertHTML', h);
}

// ===== 色板 =====
const SWATCH_COLORS = [
    '#FFFFFF','#E6E6E6','#CCCCCC','#B3B3B3','#999999','#808080','#666666','#4D4D4D','#000000',
    '#800000','#A52A2A','#B22222','#DC143C','#FF0000','#FF3333','#FF6666','#FF8C69','#FFA07A',
    '#D2691E','#FF4500','#FF6600','#FF8C00','#FFA500','#FFD700','#FFCC00','#DAA520','#B8860B',
    '#FFFF00','#CCCC00','#9ACD32','#7FFF00','#00FF00','#32CD32','#228B22','#008000','#006400',
    '#00B050','#2E8B57','#3CB371','#66CDAA','#8FBC8F','#90EE90','#98FB98','#ADFF2F','#556B2F',
    '#00FFFF','#00CED1','#20B2AA','#008B8B','#008080','#5F9EA0','#7FFFD4','#E0FFFF','#B0E0E6',
    '#0070C0','#0000FF','#0000CD','#00008B','#1E90FF','#4169E1','#6495ED','#87CEEB','#B0C4DE',
    '#8A2BE2','#9400D3','#800080','#4B0082','#6A5ACD','#BA55D3','#DA70D6','#DDA0DD','#E6E6FA',
    '#8B4513','#CD853F','#DEB887','#F5DEB3','#FFE4B5','#FFDAB9','#FFE4E1','#FFC0CB','#FFB6C1'
];

function toggleColorPanel(btn, command) {
    const panel = document.getElementById('colorSwatchPopover');
    const grid = document.getElementById('colorSwatchGrid');
    const title = document.getElementById('swatchTitle');
    if (!panel || !grid) return;
    if (panel.style.display === 'block' && panel.dataset.command === command) {
        panel.style.display = 'none'; return;
    }
    panel.dataset.command = command;
    title.textContent = command === 'hiliteColor' ? '突出显示' : '文字颜色';
    grid.innerHTML = SWATCH_COLORS.map(c =>
        `<div class="color-swatch-item" style="background-color:${c};${c==='#FFFFFF'?'border-color:rgba(0,0,0,0.25);':''}" onmousedown="event.preventDefault();applyColor('${c}');" title="${c}"></div>`
    ).join('');
    const rect = btn.getBoundingClientRect();
    panel.style.left = Math.min(rect.left, window.innerWidth - 256) + 'px';
    panel.style.top = (rect.bottom + 6) + 'px';
    panel.style.display = 'block';
    setTimeout(() => document.addEventListener('mousedown', closeColorPanelOnOutside, { once: true }), 0);
}
function closeColorPanelOnOutside(e) {
    const panel = document.getElementById('colorSwatchPopover');
    if (panel && !panel.contains(e.target)) panel.style.display = 'none';
    else setTimeout(() => document.addEventListener('mousedown', closeColorPanelOnOutside, { once: true }), 0);
}
function applyColor(color) {
    const panel = document.getElementById('colorSwatchPopover');
    const command = panel.dataset.command;
    if (command) execCmd(command, color);
    panel.style.display = 'none';
}

// ===== 字体大小 =====
function toggleFontSizePanel(btn) {
    const panel = document.getElementById('fontSizePopover');
    if (!panel) return;
    if (panel.style.display === 'block') { panel.style.display = 'none'; return; }
    const rect = btn.getBoundingClientRect();
    panel.style.left = Math.min(rect.left, window.innerWidth - 120) + 'px';
    panel.style.top = (rect.bottom + 6) + 'px';
    panel.style.display = 'block';
    setTimeout(() => document.addEventListener('mousedown', closeFontSizePanelOnOutside, { once: true }), 0);
}
function closeFontSizePanelOnOutside(e) {
    const panel = document.getElementById('fontSizePopover');
    if (panel && !panel.contains(e.target)) panel.style.display = 'none';
    else setTimeout(() => document.addEventListener('mousedown', closeFontSizePanelOnOutside, { once: true }), 0);
}
function applyFontSize(size) {
    execCmd('fontSize', size);
    document.getElementById('fontSizePopover').style.display = 'none';
}

// ===== 图片插入与上传 =====
function insertImageToRemark(deviceId, editorId) {
    // 参数均可选：首页工具栏传 (code, 'remarkContent')，详情页无参调用（由 RT 配置提供默认值）
    if (deviceId !== undefined && deviceId !== null) RT._uploadDeviceId = deviceId;
    if (editorId !== undefined && editorId !== null) RT._targetEditorId = editorId;
    const fileInput = document.getElementById('imagePickerFileInput');
    if (fileInput) fileInput.value = '';
    const popup = document.getElementById('imageInsertPopup');
    if (!popup) return;
    const evt = (typeof event !== 'undefined') ? event : null;
    const btn = (evt && evt.target && evt.target.closest('button')) || document.activeElement;
    if (btn) {
        const rect = btn.getBoundingClientRect();
        popup.style.display = ''; popup.style.visibility = 'hidden';
        const popupH = popup.offsetHeight;
        popup.style.visibility = '';
        popup.style.left = (rect.left + rect.width / 2) + 'px';
        popup.style.top = (rect.top - popupH - 8) + 'px';
        popup.style.transform = 'translateX(-50%)';
    }
    popup.style.display = '';
    setTimeout(() => document.addEventListener('click', _closeImagePopupOnOutside, { once: true }), 0);
}
function _closeImagePopupOnOutside(e) {
    const popup = document.getElementById('imageInsertPopup');
    if (popup && !popup.contains(e.target)) closeImageInsertPopup();
    else if (popup) document.addEventListener('click', _closeImagePopupOnOutside, { once: true });
}
function closeImageInsertPopup() {
    const popup = document.getElementById('imageInsertPopup');
    if (popup) popup.style.display = 'none';
}
function triggerImageUpload() {
    document.getElementById('imagePickerFileInput').click();
}
function convertImageUrl(url) {
    if (!url) return '';
    const match = url.match(/\/(\d+)\/([^/\s"'>]+?)(?:\?|$)/);
    if (match) return `/api/images/${match[1]}/${decodeURIComponent(match[2])}`;
    return url;
}

// 上传图片并插入编辑器（弹窗选择文件 / 粘贴截图共用）
function uploadAndInsertImage(file, editor, progressIdPrefix) {
    const progressId = (progressIdPrefix || 'imgUploadProg_') + Date.now();
    if (editor) {
        const progressHtml = `<div id="${progressId}" class="img-upload-progress"><span class="img-upload-progress-bar-outer"><span id="${progressId}_bar" class="img-upload-progress-bar-inner"></span></span><span id="${progressId}_text" class="img-upload-progress-text">0%</span></div>`;
        insertHTMLAtCursor(editor, progressHtml);
    }
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('image', file);
    formData.append('deviceId', RT.getDeviceId() || '0');
    xhr.open('POST', RT.apiBase() + '/upload/image');
    xhr.upload.onprogress = function(e) {
        if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            const bar = document.getElementById(progressId + '_bar');
            const text = document.getElementById(progressId + '_text');
            if (bar) bar.style.width = pct + '%';
            if (text) text.textContent = pct + '%';
        }
    };
    xhr.onload = function() {
        const progEl = document.getElementById(progressId);
        if (xhr.status >= 200 && xhr.status < 300) {
            try {
                const data = JSON.parse(xhr.responseText);
                const imgTag = `<img src="${escapeAttr(convertImageUrl(data.url))}" class="img-size-large" style="max-width:100%;height:auto;margin:8px 0;border-radius:4px;border:1px solid var(--border);" />`;
                if (progEl && progEl.parentNode) {
                    const frag = document.createRange().createContextualFragment(imgTag);
                    progEl.replaceWith(frag);
                } else if (editor) insertHTMLAtCursor(editor, imgTag);
                RT.onImageInserted();
            } catch(_) {
                if (progEl) { const t = progEl.querySelector('.img-upload-progress-text'); if (t) { t.textContent = '解析失败'; t.className = 'img-upload-progress-error'; } }
            }
        } else {
            if (progEl) { const t = progEl.querySelector('.img-upload-progress-text'); if (t) { t.textContent = '上传失败'; t.className = 'img-upload-progress-error'; } }
        }
    };
    xhr.onerror = function() {
        const progEl = document.getElementById(progressId);
        if (progEl) { const t = progEl.querySelector('.img-upload-progress-text'); if (t) { t.textContent = '网络错误'; t.className = 'img-upload-progress-error'; } }
    };
    xhr.send(formData);
}

function handleImagePickerUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast('图片大小不能超过5MB', 'error'); event.target.value = ''; return; }
    uploadAndInsertImage(file, RT.getEditor(), 'imgUploadProg_');
    event.target.value = '';
}

function insertHTMLAtCursor(editor, html) {
    editor.focus();
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (editor.contains(range.commonAncestorContainer)) {
            range.deleteContents();
            const fragment = range.createContextualFragment(html);
            range.insertNode(fragment);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
            return;
        }
    }
    editor.innerHTML += html;
}

// ===== 粘贴截图上传 =====
// 防重复绑定：编辑器是静态元素时监听器只注册一次（重复注册会导致一次粘贴上传多张图）
function setupImagePaste(editor, getDeviceId) {
    if (!editor || editor._imagePasteBound) return;
    editor._imagePasteBound = true;
    editor.addEventListener('paste', function(e) {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
                e.preventDefault();
                const blob = items[i].getAsFile();
                const deviceId = getDeviceId();
                if (!deviceId) { showToast('无法确定设备ID', 'error'); return; }
                if (blob.size > 5 * 1024 * 1024) { showToast('图片大小不能超过5MB', 'error'); return; }
                const ext = blob.type === 'image/png' ? '.png' : blob.type === 'image/jpeg' ? '.jpg' : '.png';
                const file = new File([blob], 'paste_' + Date.now() + ext, { type: blob.type });
                uploadAndInsertImage(file, editor, 'imgPasteProg_');
                return;
            }
        }
    });
    // 图片双击全屏（与列表页一致）
    editor.addEventListener('dblclick', function(e) {
        if (e.target.tagName === 'IMG') { e.preventDefault(); showImageFullscreen(e.target.src); }
    });
}

// ===== 图片右键尺寸菜单 =====
let _imgSizeMenuTargetImg = null, _imgSizeMenuDocClick = null, _imgSizeMenuDocCtxMenu = null;

function setupImageContextMenu(editor) {
    if (!editor) return;
    editor.addEventListener('contextmenu', function(e) {
        const img = e.target.closest('img');
        if (img) {
            e.preventDefault(); e.stopPropagation();
            _imgSizeMenuTargetImg = img;
            const menu = document.getElementById('imgSizeContextMenu');
            if (!menu) return;
            menu.style.left = e.clientX + 'px';
            menu.style.top = e.clientY + 'px';
            menu.style.display = 'block';
            menu.querySelectorAll('.img-size-menu-item').forEach(item => {
                item.classList.toggle('active', img.classList.contains('img-size-' + item.dataset.size));
            });
            _removeDocListeners();
            _imgSizeMenuDocClick = () => _closeImgSizeMenu();
            _imgSizeMenuDocCtxMenu = (ev) => { ev.preventDefault(); _closeImgSizeMenu(); };
            document.addEventListener('click', _imgSizeMenuDocClick);
            document.addEventListener('contextmenu', _imgSizeMenuDocCtxMenu);
        }
    });
}
function _removeDocListeners() {
    if (_imgSizeMenuDocClick) { document.removeEventListener('click', _imgSizeMenuDocClick); _imgSizeMenuDocClick = null; }
    if (_imgSizeMenuDocCtxMenu) { document.removeEventListener('contextmenu', _imgSizeMenuDocCtxMenu); _imgSizeMenuDocCtxMenu = null; }
}
function _closeImgSizeMenu(e) {
    const menu = document.getElementById('imgSizeContextMenu');
    if (menu && (!e || !menu.contains(e.target))) { menu.style.display = 'none'; _removeDocListeners(); }
}
function setImageSize(size) {
    const img = _imgSizeMenuTargetImg;
    if (!img) return;
    img.classList.remove('img-size-small', 'img-size-medium', 'img-size-large');
    img.classList.add('img-size-' + size);
    // 清除上传时写入的内联 max-width：内联样式优先级高于尺寸 class，不清除则小/中永远不生效
    img.style.maxWidth = '';
    _closeImgSizeMenu();
}

// ===== 图片全屏查看 =====
function showImageFullscreen(src) {
    const existing = document.querySelector('.image-fullscreen-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.className = 'image-fullscreen-overlay';
    overlay.innerHTML = `<div class="image-fullscreen-close"><i class="bi bi-x-lg"></i></div><img src="${escapeAttr(src)}" class="image-fullscreen-img" />`;
    overlay.addEventListener('click', () => overlay.remove());
    overlay.querySelector('.image-fullscreen-img').addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('keydown', function onEsc(e) {
        if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); }
    });
    document.body.appendChild(overlay);
}
