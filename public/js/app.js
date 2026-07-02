/**
 * V4 Linear — 自包含应用逻辑
 * 无 Bootstrap 依赖，纯 API + DOM 操作
 */

// ===== 状态 =====
const API_BASE = '/api';
let allDevices = [];
let warehouses = [];
let currentWarehouse = null; // { id, name }  null=全部
let currentTagFilter = null;
let currentTab = 'all'; // 'all' | 'in' | 'out' | 'expiring'
let viewMode = 'table';
let autoSwitchedToCard = false;  // 记录是否由 resize 自动切换到卡片视图
let deviceModalId = null; // 编辑时不为 null
let modalTags = []; // 当前编辑弹窗中的标签数组
let announcementsData = []; // 公告数据（用于下拉栏）
let warehouseShowAll = false; // 仓库列表"显示更多"

// ===== 列设置控制 =====
const COLUMN_DEFS = [
    { key: 'deviceId',    label: '设备ID',   dataCol: 'device-id' },
    { key: 'name',        label: '设备名称', dataCol: 'name' },
    { key: 'warehouse',   label: '所属仓库', dataCol: 'warehouse' },
    { key: 'serialNumber',label: '序列号',   dataCol: 'serial-number', defaultVisible: false },
    { key: 'specModel',   label: '规格型号', dataCol: 'spec-model' },
    { key: 'source',      label: '来源',     dataCol: 'source' },
    { key: 'quantity',    label: '数量',     dataCol: 'quantity' },
    { key: 'tags',        label: '标签',     dataCol: 'tags' },
    { key: 'department',  label: '所属路径', dataCol: 'department', defaultVisible: false },
    { key: 'responsible', label: '负责人',   dataCol: 'responsible', defaultVisible: false },
    { key: 'location',    label: '位置/去向', dataCol: 'location' },
    { key: 'status',      label: '状态',     dataCol: 'status',      defaultVisible: false },
    { key: 'expiry',      label: '到期日期', dataCol: 'expiry' },
    { key: 'checkin',     label: '入库时间', dataCol: 'checkin',      defaultVisible: false },
    { key: 'remark',      label: '备注',     dataCol: 'remark' },
    { key: 'actions',     label: '操作',     dataCol: 'actions' },
];

const COLUMN_VERSION = 5;
let columnVisibility = (() => {
    try {
        const savedVersion = localStorage.getItem('dms_column_version');
        const saved = localStorage.getItem('dms_column_visibility');
        if (saved && Number(savedVersion) === COLUMN_VERSION) {
            const parsed = JSON.parse(saved);
            COLUMN_DEFS.forEach(c => { if (!(c.key in parsed)) parsed[c.key] = c.defaultVisible !== false; });
            return parsed;
        }
    } catch (e) {}
    const defaults = {};
    COLUMN_DEFS.forEach(c => defaults[c.key] = c.defaultVisible !== false);
    localStorage.setItem('dms_column_version', COLUMN_VERSION);
    return defaults;
})();

// 列排序（不含 batch-check 和 actions）
const ORDERABLE_KEYS = COLUMN_DEFS.filter(c => c.key !== 'actions' && c.key !== 'batch-check').map(c => c.key);
let columnOrder = (() => {
    try {
        const saved = localStorage.getItem('dms_column_order');
        if (saved) {
            const parsed = JSON.parse(saved);
            // 仅保留当前 COLUMN_DEFS 中存在的 key
            const valid = parsed.filter(k => ORDERABLE_KEYS.includes(k));
            // 补上新增的 key，按 COLUMN_DEFS 顺序插入正确位置
            ORDERABLE_KEYS.forEach(k => {
                if (!valid.includes(k)) {
                    const defIdx = ORDERABLE_KEYS.indexOf(k);
                    let insertAt = valid.length;
                    for (let i = 0; i < valid.length; i++) {
                        if (ORDERABLE_KEYS.indexOf(valid[i]) > defIdx) { insertAt = i; break; }
                    }
                    valid.splice(insertAt, 0, k);
                }
            });
            if (valid.length > 0) return valid;
        }
    } catch (e) {}
    return [...ORDERABLE_KEYS];
})();

function saveColumnOrder() {
    localStorage.setItem('dms_column_order', JSON.stringify(columnOrder));
}

// 获取渲染用列顺序（batch-check → 可排序列 → actions）
function getRenderColumnKeys() {
    return [...columnOrder, 'actions'];
}

function applyColumnVisibility() {
    const visibleCols = new Set();
    for (const [key, val] of Object.entries(columnVisibility)) {
        if (val) {
            const def = COLUMN_DEFS.find(d => d.key === key);
            if (def) visibleCols.add(def.dataCol);
        }
    }
    document.querySelectorAll('#deviceTable [data-col]').forEach(el => {
        const col = el.getAttribute('data-col');
        if (col === 'batch-check') return;
        el.classList.toggle('d-none', !visibleCols.has(col));
    });
    // 同步 th 显隐
    document.querySelectorAll('#deviceTableHead th[data-col]').forEach(th => {
        const col = th.getAttribute('data-col');
        if (col === 'batch-check') return;
        th.classList.toggle('d-none', !visibleCols.has(col));
    });
    localStorage.setItem('dms_column_visibility', JSON.stringify(columnVisibility));
}

// 动态渲染表头
function renderTableHead() {
    const thead = document.getElementById('deviceTableHead');
    if (!thead) return;
    const renderKeys = getRenderColumnKeys();
    const ths = renderKeys.map(key => {
        const def = COLUMN_DEFS.find(c => c.key === key);
        if (!def) return '';
        if (key === 'actions') {
            return `<th data-col="actions" class="actions-th"><span>操作</span>
                <button class="col-settings-btn" onclick="event.stopPropagation();toggleColumnSettings(event)" title="列设置">⚙</button>
                <div class="column-settings-menu" id="columnSettingsMenu" style="display:none;"></div>
            </th>`;
        }
        return `<th data-col="${def.dataCol}">${def.label}</th>`;
    }).join('');
    thead.innerHTML = `<tr><th data-col="batch-check" class="batch-check-col" style="display:none;"></th>${ths}</tr>`;
}

function toggleColumnSettings(e) {
    e.stopPropagation();
    const menu = document.getElementById('columnSettingsMenu');
    if (!menu) return;
    const isOpen = menu.style.display === 'block';
    if (isOpen) { menu.style.display = 'none'; return; }
    // 按 columnOrder 渲染（不含 actions）
    menu.innerHTML = columnOrder.map(key => {
        const def = COLUMN_DEFS.find(c => c.key === key);
        if (!def) return '';
        return `<div class="column-settings-item" draggable="true" data-col-key="${def.key}">
            <span class="drag-handle" title="拖动排序">⋮⋮</span>
            <input type="checkbox" ${columnVisibility[def.key] ? 'checked' : ''} onchange="toggleColumn('${def.key}', this.checked)" onclick="event.stopPropagation()">
            <span>${def.label}</span>
        </div>`;
    }).join('');
    initColumnDrag(menu);
    menu.style.display = 'block';
}

function toggleColumn(key, visible) {
    columnVisibility[key] = visible;
    applyColumnVisibility();
}

// ===== 列排序拖拽 =====
function initColumnDrag(menu) {
    const items = menu.querySelectorAll('.column-settings-item');
    let dragSrc = null;

    items.forEach(item => {
        item.addEventListener('dragstart', function(e) {
            dragSrc = this;
            this.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', this.dataset.colKey);
            // 让拖拽幽灵图更小
            const ghost = this.cloneNode(true);
            ghost.style.width = this.offsetWidth + 'px';
            ghost.style.opacity = '0.5';
            ghost.style.position = 'absolute';
            ghost.style.top = '-9999px';
            document.body.appendChild(ghost);
            e.dataTransfer.setDragImage(ghost, 0, 0);
            setTimeout(() => document.body.removeChild(ghost), 0);
        });

        item.addEventListener('dragend', function(e) {
            this.classList.remove('dragging');
            menu.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            dragSrc = null;
        });

        item.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (this === dragSrc) return;
            menu.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            this.classList.add('drag-over');
        });

        item.addEventListener('dragleave', function(e) {
            this.classList.remove('drag-over');
        });

        item.addEventListener('drop', function(e) {
            e.preventDefault();
            e.stopPropagation();
            this.classList.remove('drag-over');
            if (!dragSrc || dragSrc === this) return;

            const srcKey = dragSrc.dataset.colKey;
            const dstKey = this.dataset.colKey;
            const srcIdx = columnOrder.indexOf(srcKey);
            const dstIdx = columnOrder.indexOf(dstKey);
            if (srcIdx === -1 || dstIdx === -1) return;

            // 移动数组元素
            columnOrder.splice(srcIdx, 1);
            columnOrder.splice(dstIdx, 0, srcKey);
            saveColumnOrder();

            // 关闭菜单并刷新表格
            menu.style.display = 'none';
            renderDevices();
        });
    });
}

// 点击外部关闭列设置菜单
document.addEventListener('click', (e) => {
    const menu = document.getElementById('columnSettingsMenu');
    if (menu && menu.style.display === 'block') {
        const btn = document.querySelector('.col-settings-btn');
        if (!menu.contains(e.target) && (!btn || !btn.contains(e.target))) {
            menu.style.display = 'none';
        }
    }
});

// ===== 批量操作 =====
let batchSelectMode = false;
const selectedDeviceIds = new Set();

// 拖拽多选状态
let dragSelectActive = false;
let dragSelectStartX = 0, dragSelectStartY = 0;
let dragSelectMoved = false;
let dragSelectLastId = null;
const DRAG_SELECT_THRESHOLD = 5;

function initDragSelect() {
    const tbody = document.getElementById('deviceTableBody');
    if (!tbody) return;

    tbody.addEventListener('pointerdown', (e) => {
        if (!batchSelectMode) return;
        if (e.target.closest('button, input[type="checkbox"], .remark-icon, .remark-tooltip-wrapper, .device-id-badge, .action-btns')) return;
        const row = e.target.closest('[data-device-id]');
        if (!row) return;
        dragSelectActive = true;
        dragSelectMoved = false;
        dragSelectStartX = e.clientX;
        dragSelectStartY = e.clientY;
        const deviceId = parseInt(row.dataset.deviceId);
        dragSelectLastId = deviceId;
        toggleDeviceSelectDirect(deviceId);
        e.preventDefault();
    });

    document.addEventListener('pointermove', (e) => {
        if (!dragSelectActive || !batchSelectMode) return;
        if (Math.abs(e.clientX - dragSelectStartX) < DRAG_SELECT_THRESHOLD && Math.abs(e.clientY - dragSelectStartY) < DRAG_SELECT_THRESHOLD) return;
        dragSelectMoved = true;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el) return;
        const row = el.closest('[data-device-id]');
        if (!row) return;
        const deviceId = parseInt(row.dataset.deviceId);
        if (deviceId === dragSelectLastId) return;
        dragSelectLastId = deviceId;
        if (!selectedDeviceIds.has(deviceId)) {
            selectedDeviceIds.add(deviceId);
            row.classList.add('batch-selected');
            const cb = row.querySelector('.batch-checkbox');
            if (cb) cb.checked = true;
        }
    });

    document.addEventListener('pointerup', () => {
        if (!dragSelectActive) return;
        dragSelectActive = false;
        dragSelectLastId = null;
        if (dragSelectMoved) {
            document.addEventListener('click', function suppressClick(e) {
                e.stopPropagation(); e.preventDefault();
            }, { once: true, capture: true });
        }
        updateBatchSelectUI();
    });
}

function toggleDeviceSelectDirect(deviceId) {
    if (selectedDeviceIds.has(deviceId)) { selectedDeviceIds.delete(deviceId); }
    else { selectedDeviceIds.add(deviceId); }
    document.querySelectorAll(`[data-device-id="${deviceId}"]`).forEach(row => {
        const selected = selectedDeviceIds.has(deviceId);
        row.classList.toggle('batch-selected', selected);
        const cb = row.querySelector('.batch-checkbox');
        if (cb) cb.checked = selected;
    });
}

function toggleBatchSelectMode(e) {
    if (e) e.stopPropagation();
    batchSelectMode = !batchSelectMode;
    if (!batchSelectMode) selectedDeviceIds.clear();
    renderDevices();
    updateBatchBtnUI();
    renderBatchToolbarHTML();
}

function updateBatchBtnUI() {
    const btn = document.getElementById('batchToggleBtn');
    if (!btn) return;
    const icon = btn.querySelector('i');
    const span = btn.querySelector('span');
    if (batchSelectMode) {
        btn.classList.add('active');
        if (icon) icon.className = 'bi bi-x-lg';
        if (span) span.textContent = '退出批量';
    } else {
        btn.classList.remove('active');
        if (icon) icon.className = 'bi bi-check2-square';
        if (span) span.textContent = '批量操作';
    }
}

function toggleDeviceSelect(deviceId) {
    if (selectedDeviceIds.has(deviceId)) { selectedDeviceIds.delete(deviceId); }
    else { selectedDeviceIds.add(deviceId); }
    updateBatchSelectUI();
}

function toggleSelectAll() {
    const devices = getFilteredDevices();
    const allIds = devices.map(d => d.id);
    const allSelected = allIds.length > 0 && allIds.every(id => selectedDeviceIds.has(id));
    if (allSelected) { allIds.forEach(id => selectedDeviceIds.delete(id)); }
    else { allIds.forEach(id => selectedDeviceIds.add(id)); }
    renderDevices();
    updateBatchSelectUI();
    renderBatchToolbarHTML();
}

function updateBatchSelectUI() {
    const selectAllBox = document.getElementById('batchSelectAll');
    if (!selectAllBox) return;
    const devices = getFilteredDevices();
    const allIds = devices.map(d => d.id);
    const allSelected = allIds.length > 0 && allIds.every(id => selectedDeviceIds.has(id));
    const someSelected = allIds.some(id => selectedDeviceIds.has(id));
    selectAllBox.checked = allSelected;
    selectAllBox.indeterminate = someSelected && !allSelected;
    const countEl = document.getElementById('batchCount');
    if (countEl) countEl.textContent = `已选 ${selectedDeviceIds.size} 项`;
    const deleteBtn = document.getElementById('batchDeleteBtn');
    if (deleteBtn) deleteBtn.disabled = selectedDeviceIds.size === 0;
}

function renderBatchToolbarHTML() {
    const toolbar = document.getElementById('batchToolbar');
    if (!toolbar) return;
    if (!batchSelectMode) {
        toolbar.style.display = 'none';
        toolbar.innerHTML = '';
        return;
    }
    const devices = getFilteredDevices();
    const allIds = devices.map(d => d.id);
    const allSelected = allIds.length > 0 && allIds.every(id => selectedDeviceIds.has(id));
    toolbar.style.display = 'flex';
    toolbar.innerHTML = `
        <label class="batch-select-all">
            <input type="checkbox" id="batchSelectAll" ${allSelected ? 'checked' : ''} onchange="toggleSelectAll()">
            <span>全选</span>
            <span class="batch-count" id="batchCount">已选 ${selectedDeviceIds.size} 项</span>
        </label>
        <button id="batchDeleteBtn" class="batch-delete-btn" onclick="executeBatchDelete()" ${selectedDeviceIds.size === 0 ? 'disabled' : ''}>
            <i class="bi bi-trash"></i> 批量删除
        </button>
    `;
}

async function executeBatchDelete() {
    if (selectedDeviceIds.size === 0) return;
    if (!confirm(`确定要删除选中的 ${selectedDeviceIds.size} 个设备吗？此操作不可撤销。`)) return;
    const ids = Array.from(selectedDeviceIds);
    try {
        const res = await fetch(`${API_BASE}/devices/batch-delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });
        const result = await res.json();
        if (result.success) {
            selectedDeviceIds.clear();
            batchSelectMode = false;
            updateBatchBtnUI();
            renderBatchToolbarHTML();
            await Promise.allSettled([loadDevices(), loadWarehouses(), loadTagStats(), loadExpiringDevices()]);
        } else {
            alert('批量删除失败: ' + (result.error || '未知错误'));
        }
    } catch (e) {
        alert('批量删除失败: ' + e.message);
    }
}

// ===== 工具函数 =====
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function escapeAttr(s) { return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;'); }
function escapeOnClick(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, "\\'"); }

function formatDate(s) {
    if (!s) return '-';
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
}

// 计算到期剩余天数，无法解析返回 null
function getExpiryRemainingDays(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const now = new Date(); now.setHours(0,0,0,0);
    d.setHours(0,0,0,0);
    return Math.ceil((d - now) / 86400000);
}

// 根据剩余天数返回 {bg, color} 样式
function getExpiryColorStyle(days) {
    if (days <= 0)  return { bg: 'var(--danger-bg)', color: 'var(--danger)' };     // 已过期 / 红色
    if (days <= 7)  return { bg: 'var(--danger-bg)', color: 'var(--danger)' };     // 7天内 / 红色
    if (days <= 30)  return { bg: 'var(--orange-bg)', color: 'var(--orange)' };    // 30天内 / 橙色
    if (days <= 365) return { bg: 'var(--warning-bg)', color: 'var(--warning)' };  // 一年内 / 黄色
    return { bg: 'var(--success-bg)', color: 'var(--success)' };                    // 一年以上 / 绿色
}

// 渲染带颜色的到期日期标签（用于表格/列表）
function formatExpiryBadge(dateStr) {
    if (!dateStr) return '-';
    const days = getExpiryRemainingDays(dateStr);
    const cs = days !== null ? getExpiryColorStyle(days) : { bg: 'transparent', color: 'inherit' };
    return `<span class="expiry-badge" style="background:${cs.bg};color:${cs.color};">${formatDate(dateStr)}</span>`;
}

function renderTagBadges(device, maxVisible = 2) {
    const tagField = (device.tag_names || device.tag_name || '').trim();
    if (!tagField) return '<span class="text-muted">-</span>';
    const tags = parseTags(tagField);
    if (tags.length === 0) return '<span class="text-muted">-</span>';
    const visible = tags.slice(0, maxVisible);
    const hidden = tags.length > maxVisible
        ? `<span class="tag-more">+${tags.length - maxVisible}<span class="tag-more-tip">${tags.slice(maxVisible).map(t => `<span class="tag-item-inline">${escapeHtml(t)}</span>`).join('')}</span></span>`
        : '';
    return visible.map(t => `<span class="tag-item-inline">${escapeHtml(t)}</span>`).join('') + hidden;
}

function formatDateInput(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function parseDateInput(v) {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

// ===== 富文本备注模块 =====

let _remarkOriginalContent = '';
let _remarkSourceMode = null; // 'modal' = 从编辑弹窗打开, 保存时回写到 textarea; null = 从表格打开, 正常保存到服务器

function showRemarkPreview(deviceId, deviceName) {
    // 从 allDevices 查找备注
    const device = allDevices.find(d => d.id == deviceId);
    if (!device || (!device.remark && device.remark !== '')) return;
    const remark = device.remark || '';
    const deviceIdCode = device.device_id || '';

    _remarkSourceMode = null; // 从表格打开，正常保存模式
    document.getElementById('remarkPreviewDeviceId').value = deviceId;
    document.getElementById('remarkPreviewDeviceIdCode').value = deviceIdCode;
    document.getElementById('remarkDeviceName').textContent = deviceName;
    document.getElementById('remarkContent').innerHTML = decodeRichText(remark);
    _remarkOriginalContent = document.getElementById('remarkContent').innerHTML;

    document.getElementById('remarkPreviewTitle').innerHTML =
        '<i class="bi bi-file-text"></i> 备注详情' +
        '<span id="remarkPreviewStatus" class="remark-status-dot" title="已是最新版本"></span>';

    updateRemarkPreviewStatus();
    document.getElementById('remarkPreviewModal').style.display = 'flex';
}

function openRichTextEditorFromModal() {
    const remarkEditor = document.getElementById('frmRemarkEditor');
    const deviceIdCode = document.getElementById('frmDeviceCode')?.value || '';
    const deviceName = document.getElementById('frmDeviceName')?.value || '';

    // 从 contenteditable 编辑器读取内容（与生产版一致）
    const remark = remarkEditor ? encodeRichText(remarkEditor.innerHTML) : '';
    document.getElementById('remarkPreviewDeviceId').value = deviceIdCode;
    document.getElementById('remarkPreviewDeviceIdCode').value = deviceIdCode;
    document.getElementById('remarkDeviceName').textContent = deviceName;
    document.getElementById('remarkContent').innerHTML = remarkEditor ? remarkEditor.innerHTML : '';
    _remarkOriginalContent = document.getElementById('remarkContent').innerHTML;
    _remarkSourceMode = 'modal';

    document.getElementById('remarkPreviewTitle').innerHTML =
        '<i class="bi bi-file-text"></i> 编辑备注' +
        '<span id="remarkPreviewStatus" class="remark-status-dot" title="已是最新版本"></span>';

    updateRemarkPreviewStatus();
    document.getElementById('remarkPreviewModal').style.display = 'flex';
}

function closeRemarkModal() {
    document.getElementById('remarkPreviewModal').style.display = 'none';
}

function updateRemarkPreviewStatus() {
    const content = document.getElementById('remarkContent');
    const dot = document.getElementById('remarkPreviewStatus');
    if (!content || !dot) return;
    if (content.innerHTML !== _remarkOriginalContent) {
        dot.classList.add('modified');
        dot.title = '有未保存的修改';
    } else {
        dot.classList.remove('modified');
        dot.title = '已是最新版本';
    }
}

async function saveRemarkFromPreview() {
    const content = document.getElementById('remarkContent').innerHTML;
    const remark = encodeRichText(content);

    // 从编辑设备弹窗打开的富文本编辑器：回写到备注编辑区，不直接保存到服务器
    if (_remarkSourceMode === 'modal') {
        const frmRemark = document.getElementById('frmRemark');
        if (frmRemark) {
            frmRemark.value = remark;
        }
        const frmRemarkEditor = document.getElementById('frmRemarkEditor');
        if (frmRemarkEditor) {
            frmRemarkEditor.innerHTML = content;
        }
        _remarkOriginalContent = content;
        updateRemarkPreviewStatus();
        closeRemarkModal();
        showToast('已回写到备注，请在设备弹窗中保存', 'success');
        return;
    }

    const deviceId = document.getElementById('remarkPreviewDeviceId').value;
    try {
        const res = await fetch(`${API_BASE}/devices/${deviceId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ remark })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        _remarkOriginalContent = content;
        updateRemarkPreviewStatus();
        closeRemarkModal();
        await loadDevices();
        showToast('备注已保存', 'success');
    } catch (e) {
        console.error('保存备注失败:', e);
        showToast('保存失败: ' + e.message, 'error');
    }
}

// ----- 富文本编解码 -----
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

function decodeRichText(text) {
    if (!text) return '';
    // 先还原 literal \\n（如果有的话），再按实际换行分割段落
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
    html = html.replace(/\s*onerror\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/gi, '');
    html = html.replace(/<img([^>]*)>/gi, function(match, attrs) {
        let newAttrs = attrs + ' onerror="this.style.display=\'none\'; this.insertAdjacentHTML(\'afterend\',\'<span style=color:var(--danger);font-size:12px;>[图片加载失败]</span>\');"';
        if (!attrs.includes('img-size-')) {
            if (newAttrs.includes('class="')) newAttrs = newAttrs.replace('class="', 'class="img-size-large ');
            else if (newAttrs.includes("class='")) newAttrs = newAttrs.replace("class='", "class='img-size-large ");
            else newAttrs += ' class="img-size-large"';
        }
        return '<img' + newAttrs + '>';
    });
    return html;
}

function decodeRichTextToSingleLine(text) {
    if (!text) return '';
    let html = text.replace(/\n/g, ' ');
    html = html.replace(/\[B\]([\s\S]*?)\[\/B\]/gi, '<b>$1</b>');
    html = html.replace(/\[I\]([\s\S]*?)\[\/I\]/gi, '<i>$1</i>');
    html = html.replace(/\[U\]([\s\S]*?)\[\/U\]/gi, '<u>$1</u>');
    html = html.replace(/\[S\]([\s\S]*?)\[\/S\]/gi, '<s>$1</s>');
    html = html.replace(/\[COLOR=([^\]]+)\]([\s\S]*?)\[\/COLOR\]/gi, '<font color="$1">$2</font>');
    html = html.replace(/\[HIGHLIGHT=([^\]]+)\]([\s\S]*?)\[\/HIGHLIGHT\]/gi, '<span style="background-color:$1;">$2</span>');
    html = html.replace(/\[SIZE=([^\]]+)\]([\s\S]*?)\[\/SIZE\]/gi, '<font size="$1">$2</font>');
    html = html.replace(/\[图片:[^\]]+\]/g, '').replace(/<img[^>]*>/gi, '');
    html = html.replace(/\s+/g, ' ').trim();
    return html;
}

// ----- 编辑命令 -----
function execCmd(command, value) {
    document.execCommand(command, false, value || null);
}

// ----- 表格插入 -----
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
    let sr = 0, sc = 0;
    cells.forEach(cell => {
        cell.addEventListener('mouseenter', function() {
            const r = parseInt(this.dataset.row), c = parseInt(this.dataset.col);
            sr = r + 1; sc = c + 1;
            label.textContent = `${sr} × ${sc} 表格`;
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

// ----- 色板 -----
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

// ----- 字体大小 -----
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

// ----- 图片插入 -----
let _imageUploadDeviceId = null;
let _imageTargetEditorId = 'remarkContent';
let _selectedImages = new Set();
let _existingImages = [];

function insertImageToRemark(deviceId, editorId) {
    _imageUploadDeviceId = deviceId;
    _imageTargetEditorId = editorId || 'remarkContent';
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

function handleImagePickerUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast('图片大小不能超过5MB', 'error'); event.target.value = ''; return; }
    const editor = document.getElementById('remarkContent');
    const progressId = 'imgUploadProg_' + Date.now();
    if (editor) {
        const progressHtml = `<div id="${progressId}" class="img-upload-progress"><span class="img-upload-progress-bar-outer"><span id="${progressId}_bar" class="img-upload-progress-bar-inner"></span></span><span id="${progressId}_text" class="img-upload-progress-text">0%</span></div>`;
        insertHTMLAtCursor(editor, progressHtml);
    }
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('image', file);
    formData.append('deviceId', _imageUploadDeviceId || '0');
    xhr.open('POST', API_BASE + '/upload/image');
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
                const imgTag = `<img src="${convertImageUrl(data.url)}" class="img-size-large" style="max-width:100%;height:auto;margin:8px 0;border-radius:4px;border:1px solid var(--border);" />`;
                if (progEl && progEl.parentNode) {
                    const frag = document.createRange().createContextualFragment(imgTag);
                    progEl.replaceWith(frag);
                } else insertHTMLAtCursor(editor, imgTag);
                updateRemarkPreviewStatus();
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

// ----- 粘贴截图上传 -----
function setupImagePaste(editor, getDeviceId) {
    editor.addEventListener('paste', function(e) {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
                e.preventDefault();
                const blob = items[i].getAsFile();
                const deviceId = getDeviceId();
                if (!deviceId) { showToast('无法确定设备ID', 'error'); return; }
                pasteAndUploadImage(blob, deviceId, editor);
                return;
            }
        }
    });
}
function pasteAndUploadImage(blob, deviceId, editor) {
    if (blob.size > 5 * 1024 * 1024) { showToast('图片大小不能超过5MB', 'error'); return; }
    const progressId = 'imgPasteProg_' + Date.now();
    const progressHtml = `<div id="${progressId}" class="img-upload-progress"><span class="img-upload-progress-bar-outer"><span id="${progressId}_bar" class="img-upload-progress-bar-inner"></span></span><span id="${progressId}_text" class="img-upload-progress-text">0%</span></div>`;
    insertHTMLAtCursor(editor, progressHtml);
    const ext = blob.type === 'image/png' ? '.png' : blob.type === 'image/jpeg' ? '.jpg' : '.png';
    const filename = 'paste_' + Date.now() + ext;
    const file = new File([blob], filename, { type: blob.type });
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('image', file);
    formData.append('deviceId', deviceId || '0');
    xhr.open('POST', API_BASE + '/upload/image');
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
                const imgTag = `<img src="${convertImageUrl(data.url)}" class="img-size-large" style="max-width:100%;height:auto;margin:8px 0;border-radius:4px;border:1px solid var(--border);" />`;
                if (progEl && progEl.parentNode) { const frag = document.createRange().createContextualFragment(imgTag); progEl.replaceWith(frag); }
                else insertHTMLAtCursor(editor, imgTag);
                updateRemarkPreviewStatus();
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

// ----- 图片右键尺寸菜单 -----
let _imgSizeMenuTargetImg = null, _imgSizeMenuDocClick = null, _imgSizeMenuDocCtxMenu = null;

function setupImageContextMenu(editor) {
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
    _closeImgSizeMenu();
}

// ===== 附件管理（编辑设备弹窗中使用） =====

function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B','KB','MB','GB'];
    let i = 0, size = bytes;
    while (size >= 1024 && i < units.length-1) { size /= 1024; i++; }
    return size.toFixed(i===0?0:1) + ' ' + units[i];
}

function getAttachmentIconClass(ext) {
    if (ext==='pdf') return 'pdf';
    if (/^docx?$/.test(ext)||ext==='doc') return 'doc';
    if (/^xlsx?$/.test(ext)||/^csv$/.test(ext)) return 'xls';
    if (/^(jpg|jpeg|png|gif|webp|bmp|svg)$/.test(ext)) return 'img';
    if (/^(zip|rar|7z|tar|gz)$/.test(ext)) return 'zip';
    return 'other';
}

async function loadDeviceAttachments(deviceIdCode) {
    const container = document.getElementById('modalAttachmentList_' + deviceIdCode);
    if (!container || !deviceIdCode) { if (container) container.innerHTML = ''; return; }
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(`${API_BASE}/attachments/${deviceIdCode}`, { signal: controller.signal });
        clearTimeout(timeout);
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        if (!data.attachments || data.attachments.length === 0) {
            container.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:4px 0;">暂无附件</div>';
            return;
        }
        container.innerHTML = data.attachments.map(a => {
            const ext = (a.displayName || a.filename).split('.').pop().toLowerCase();
            const iconClass = getAttachmentIconClass(ext);
            const abbr = ext.toUpperCase().slice(0,3);
            return `<div class="modal-attachment-item">
                <div class="modal-attachment-icon ${iconClass}">${abbr}</div>
                <div class="modal-attachment-info"><div class="modal-attachment-name"><a href="${a.url}" target="_blank" title="${a.displayName||a.filename}">${escapeHtml(a.displayName||a.filename)}</a></div><div class="modal-attachment-meta">${formatFileSize(a.size)}</div></div>
                <div class="modal-attachment-actions"><button onclick="deleteAttachmentFile(this,'${deviceIdCode}','${encodeURIComponent(a.filename)}')" class="btn-attachment-delete"><i class="bi bi-trash3"></i> 删除</button></div>
            </div>`;
        }).join('');
    } catch (err) {
        console.error('加载附件失败:', err);
        const msg = err.name === 'AbortError' ? '加载超时' : '加载失败';
        container.innerHTML = `<div style="font-size:12px;color:var(--danger);padding:4px 0;">${msg}</div>`;
    }
}

function triggerUploadAttachment() {
    const input = document.getElementById('attachmentFileInput');
    if (input) input.click();
}

async function handleAttachmentUpload(input) {
    const file = input.files[0];
    if (!file) return;
    const deviceIdCode = document.getElementById('frmDeviceCode')?.value || '';
    if (!deviceIdCode) { showToast('无法获取设备ID', 'error'); input.value = ''; return; }
    const maxSize = 50*1024*1024;
    if (file.size > maxSize) { showToast(`文件过大：${formatFileSize(file.size)}，附件不能超过 ${formatFileSize(maxSize)}`, 'error'); input.value = ''; return; }
    const container = document.getElementById('modalAttachmentList_' + deviceIdCode);
    if (container) container.innerHTML = '<div style="font-size:12px;color:var(--primary);padding:4px 0;"><span class="spinner-border-sm" style="display:inline-block;width:14px;height:14px;border:2px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:spin 0.6s linear infinite;vertical-align:middle;margin-right:4px;"></span> 上传中...</div>';
    const formData = new FormData();
    formData.append('attachment', file);
    formData.append('deviceId', deviceIdCode);
    try {
        const res = await fetch(`${API_BASE}/upload/attachment`, { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || '上传失败');
        await loadDeviceAttachments(deviceIdCode);
        showToast('附件上传成功', 'success');
    } catch (err) {
        console.error('上传失败:', err);
        showToast('上传失败: ' + err.message, 'error');
        if (container) container.innerHTML = '<div style="font-size:12px;color:var(--danger);padding:4px 0;">上传失败</div>';
    }
    input.value = '';
}

async function deleteAttachmentFile(btn, deviceIdCode, encodedFilename) {
    if (!confirm('确定要删除此附件吗？')) return;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border-sm" style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;"></span>';
    btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE}/attachments/${deviceIdCode}/${encodedFilename}`, { method: 'DELETE' });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        await loadDeviceAttachments(deviceIdCode);
        showToast('附件已删除', 'success');
    } catch (err) {
        console.error('删除失败:', err);
        showToast('删除失败: ' + err.message, 'error');
        btn.innerHTML = originalHtml;
        btn.disabled = false;
    }
}

// ----- 仓库已有图片浏览器 -----
function openImageBrowser() {
    _selectedImages = new Set();
    loadExistingImages(_imageUploadDeviceId);
    document.getElementById('imageBrowserModal').style.display = 'flex';
}

function closeImageBrowser() {
    document.getElementById('imageBrowserModal').style.display = 'none';
}

async function loadExistingImages(deviceId) {
    const container = document.getElementById('imageGridContainer');
    if (!container) return;
    if (!deviceId || deviceId === '0') {
        container.innerHTML = '<div class="image-empty-state"><i class="bi bi-inbox d-block"></i><p>保存设备后可查看已有图片</p></div>';
        updateImageSelectionUI();
        return;
    }
    container.innerHTML = '<div class="image-empty-state"><i class="bi bi-hourglass-split d-block"></i><p>加载中...</p></div>';
    try {
        const res = await fetch(`${API_BASE}/images/list/${deviceId}`);
        const data = await res.json();
        if (data.success) {
            _existingImages = (data.images || []).map(img => ({
                ...img,
                url: convertImageUrl(img.url)
            }));
            renderImageGrid(_existingImages);
        } else {
            throw new Error(data.error || '加载失败');
        }
    } catch (err) {
        container.innerHTML = `<div class="image-empty-state"><i class="bi bi-exclamation-triangle d-block"></i><p>加载失败: ${escapeHtml(err.message)}</p></div>`;
    }
}

function getUsedImageFilenames() {
    const editor = document.getElementById(_imageTargetEditorId);
    if (!editor) return new Set();
    const html = editor.innerHTML || '';
    const used = new Set();
    const regex = /<img[^>]+src=["']\/api\/images\/[^/]+\/([^"']+)["']/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        used.add(decodeURIComponent(match[1]));
    }
    return used;
}

function renderImageGrid(images) {
    _selectedImages = new Set();
    const usedFilenames = getUsedImageFilenames();
    const container = document.getElementById('imageGridContainer');
    if (!container) return;
    if (!images || images.length === 0) {
        container.innerHTML = '<div class="image-empty-state"><i class="bi bi-camera d-block"></i><p>暂无图片，请先上传</p></div>';
        updateImageSelectionUI();
        return;
    }
    container.innerHTML = `<div class="image-grid">
        ${images.map(img => {
            const isUsed = usedFilenames.has(img.filename);
            return `<div class="image-grid-item ${isUsed ? 'img-used' : ''}" data-filename="${escapeHtml(img.filename)}"
                 title="${isUsed ? '已在备注中使用' : '未使用'}" onclick="toggleImageSelection('${escapeHtml(img.filename)}')">
                <img src="${img.url}" alt="${escapeHtml(img.filename)}" loading="lazy"
                     onerror="this.parentElement.style.display='none'">
                <button class="delete-btn" title="删除此图片"
                        onclick="event.stopPropagation();deleteSingleImage('${escapeHtml(img.filename)}')">
                    <i class="bi bi-x"></i>
                </button>
                <div class="select-check"><i class="bi bi-check-lg"></i></div>
                <span class="usage-badge">${isUsed ? '已用' : '未用'}</span>
                <div class="file-info">
                    <span class="file-name">${truncateFilename(img.filename, 18)}</span>
                    <span class="file-size">${formatFileSize(img.size)}</span>
                </div>
            </div>`;
        }).join('')}
    </div>`;
    updateImageSelectionUI();
}

function toggleImageSelection(filename) {
    if (_selectedImages.has(filename)) {
        _selectedImages.delete(filename);
    } else {
        _selectedImages.add(filename);
    }
    document.querySelectorAll('#imageGridContainer .image-grid-item').forEach(el => {
        if (el.dataset.filename === filename) {
            el.classList.toggle('selected', _selectedImages.has(filename));
        }
    });
    updateImageSelectionUI();
}

function selectAllUnused() {
    const used = getUsedImageFilenames();
    _existingImages.forEach(img => {
        if (!used.has(img.filename)) {
            _selectedImages.add(img.filename);
        }
    });
    document.querySelectorAll('#imageGridContainer .image-grid-item').forEach(el => {
        el.classList.toggle('selected', _selectedImages.has(el.dataset.filename));
    });
    updateImageSelectionUI();
}

function insertSelectedImages() {
    if (_selectedImages.size === 0) return;
    const editor = document.getElementById(_imageTargetEditorId);
    if (!editor) return;
    _selectedImages.forEach(filename => {
        const img = _existingImages.find(i => i.filename === filename);
        if (img) {
            const imgTag = `<img src="${img.url}" class="img-size-large" style="max-width:100%;height:auto;margin:8px 0;border-radius:4px;border:1px solid var(--border);" />`;
            insertHTMLAtCursor(editor, imgTag);
        }
    });
    updateRemarkPreviewStatus();
    closeImageBrowser();
}

async function deleteSingleImage(filename) {
    if (!confirm(`确定要删除图片 "${filename}" 吗？此操作不可撤销。`)) return;
    try {
        const res = await fetch(`${API_BASE}/images/${_imageUploadDeviceId}/${encodeURIComponent(filename)}`, { method: 'DELETE' });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || '删除失败');
        _existingImages = _existingImages.filter(i => i.filename !== filename);
        _selectedImages.delete(filename);
        renderImageGrid(_existingImages);
    } catch (err) {
        showToast('删除失败: ' + err.message, 'error');
    }
}

async function deleteSelectedImages() {
    if (_selectedImages.size === 0) return;
    const count = _selectedImages.size;
    if (!confirm(`确定要删除选中的 ${count} 张图片吗？此操作不可撤销。`)) return;
    let failed = 0;
    const toDelete = [..._selectedImages];
    for (const filename of toDelete) {
        try {
            const res = await fetch(`${API_BASE}/images/${_imageUploadDeviceId}/${encodeURIComponent(filename)}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                _existingImages = _existingImages.filter(i => i.filename !== filename);
                _selectedImages.delete(filename);
            } else { failed++; }
        } catch (_) { failed++; }
    }
    renderImageGrid(_existingImages);
    if (failed > 0) showToast(`删除完成，但有 ${failed} 张图片删除失败。`, 'warning');
}

function updateImageSelectionUI() {
    const btnInsert = document.getElementById('btnInsertSelectedImages');
    const btnDelete = document.getElementById('btnDeleteSelectedImages');
    const btnSelectUnused = document.getElementById('btnSelectUnusedImages');
    const countEl = document.getElementById('imageSelectionCount');
    if (btnInsert) btnInsert.disabled = _selectedImages.size === 0;
    if (btnDelete) btnDelete.disabled = _selectedImages.size === 0;
    if (btnSelectUnused) {
        const used = getUsedImageFilenames();
        const hasUnused = _existingImages.some(img => !used.has(img.filename));
        btnSelectUnused.disabled = !hasUnused;
    }
    if (countEl) {
        countEl.textContent = _selectedImages.size > 0 ? `已选 ${_selectedImages.size} 张` : '';
    }
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

function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0, size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return size.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

// ----- 初始化备注编辑器事件 -----
(function bindRemarkEditorEvents() {
    const rc = document.getElementById('remarkContent');
    if (!rc) return;
    rc.addEventListener('input', updateRemarkPreviewStatus);
    rc.addEventListener('dblclick', function(e) {
        if (e.target.tagName === 'IMG') { e.preventDefault(); showImageFullscreen(e.target.src); }
    });
    setupImageContextMenu(rc);
    setupImagePaste(rc, () => document.getElementById('remarkPreviewDeviceIdCode').value);
})();

function showToast(msg, type) {
    type = type || 'info';
    const c = document.getElementById('toastContainer');
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    const icons = { success: 'check-circle', error: 'x-circle', warning: 'exclamation-triangle', info: 'info-circle' };
    el.innerHTML = `<i class="bi bi-${icons[type]||'info-circle'}"></i> ${escapeHtml(msg)}`;
    c.appendChild(el);
    setTimeout(() => { el.style.opacity='0'; el.style.transform='translateX(20px)'; setTimeout(()=>el.remove(),300); }, 3000);
}

// ===== 数据加载 =====
async function loadWarehouses() {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const r = await fetch(API_BASE + '/warehouses');
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            warehouses = Array.isArray(data) ? data : [];
            // 如果设备数据已加载，重新计算各仓库在库数量
            if (allDevices.length > 0) { updateWarehouseCounts(); }
            else { renderWarehouseList(); }
            return;
        } catch(e) {
            if (attempt < 2) {
                console.warn(`[加载仓库] 重试 ${attempt + 1}/2:`, e.message);
                await new Promise(r => setTimeout(r, 500));
            } else {
                console.error('加载仓库失败:', e);
            }
        }
    }
}

async function loadDevices() {
    try {
        let url = API_BASE + '/devices';
        // "未指定"仓库：加载全部设备，后续客户端过滤
        if (currentWarehouse && currentWarehouse.id !== '__unassigned__') {
            url += '?warehouseName=' + encodeURIComponent(currentWarehouse.name);
        }
        const r = await fetch(url);
        const data = await r.json();
        allDevices = Array.isArray(data) ? data : [];
        // 加载全部设备或"未指定"时，从前端数据重新计算各仓库在库数量
        if (!currentWarehouse || currentWarehouse.id === '__unassigned__') updateWarehouseCounts();
        // 客户端过滤"未指定"仓库的设备
        if (currentWarehouse && currentWarehouse.id === '__unassigned__') {
            allDevices = allDevices.filter(d => !d.warehouse_name);
        }
        applySort();
        renderDevices();
        updateStats();
        loadExpiringDevices();
        loadTagStats();
    } catch(e) { console.error('加载设备失败:', e); allDevices = []; renderDevices(); }
}

function updateWarehouseCounts() {
    const counts = {};
    allDevices.forEach(d => {
        if (d.location_status !== 'checked_out') {
            counts[d.warehouse_name] = (counts[d.warehouse_name] || 0) + 1;
        }
    });
    warehouses.forEach(w => { w.device_count = counts[w.name] || 0; });
    renderWarehouseList();
}

let expiringDevicesAll = [];
let expiringShowAll = false;
async function loadExpiringDevices() {
    try {
        const r = await fetch(API_BASE + '/devices/expiring');
        const data = await r.json();
        let list = Array.isArray(data) ? data : [];
        // 未指定仓库时，仅显示未分配仓库的临期设备
        if (currentWarehouse && currentWarehouse.id === '__unassigned__') {
            list = list.filter(d => !d.warehouse_name);
        }
        expiringDevicesAll = list;
        if (!expiringShowAll) {
            renderExpiringList(expiringDevicesAll.slice(0, 5));
        } else {
            renderExpiringList(expiringDevicesAll);
        }
    } catch(e) { console.error('加载临期失败:', e); }
}

async function loadTagStats() {
    try {
        let url = API_BASE + '/devices';
        if (currentWarehouse && currentWarehouse.id !== '__unassigned__') {
            url += '?warehouseName=' + encodeURIComponent(currentWarehouse.name);
        }
        const r = await fetch(url);
        const devices = await r.json();
        let all = Array.isArray(devices) ? devices : [];
        if (currentWarehouse && currentWarehouse.id === '__unassigned__') {
            all = all.filter(d => !d.warehouse_name);
        }
        const map = {};
        all.forEach(d => {
            let tags = [];
            const field = d.tag_names || d.tag_name || '';
            if (field) {
                try { tags = JSON.parse(field); } catch(e) { tags = field.split(',').map(t=>t.trim()).filter(Boolean); }
            }
            tags.forEach(t => {
                const n = t.trim();
                if (n) { if (!map[n]) map[n] = 0; map[n] += d.quantity || 1; }
            });
        });
        const stats = Object.entries(map).map(([name, total]) => ({ name, total })).sort((a,b)=>a.name.localeCompare(b.name));
        renderTagList(stats);
    } catch(e) { console.error('加载标签失败:', e); }
}

async function loadAnnouncements() {
    try {
        const r = await fetch(API_BASE + '/announcements');
        const data = await r.json();
        if (data.success && data.data) {
            announcementsData = data.data || [];
            updateAnnBar();
        }
    } catch(e) {
        const barText = document.getElementById('annBarText');
        if (barText) barText.textContent = '公告加载失败';
    }
}

function updateAnnBar() {
    const barText = document.getElementById('annBarText');
    const barBadge = document.getElementById('annBarBadge');
    const barBadgeCount = document.getElementById('annBarBadgeCount');
    if (announcementsData.length > 0) {
        barText.textContent = announcementsData[0].content;
        barBadgeCount.textContent = announcementsData.length;
    } else {
        barText.textContent = '暂无公告';
        barBadgeCount.textContent = '0';
    }
}

function renderDropdown() {
    const inner = document.getElementById('annDropdownInner');
    if (announcementsData.length === 0) {
        inner.innerHTML = '<div class="ann-dropdown-empty">暂无公告</div>';
        return;
    }
    announcementsData.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    inner.innerHTML = announcementsData.map(a => `
        <div class="ann-dropdown-item" data-id="${a.id}">
            <span class="bullet"></span>
            <div class="body">
                <div class="content">${escapeHtml(a.content)}</div>
                <div class="time">${formatDate(a.created_at)}</div>
            </div>
            <button class="ann-item-delete" onclick="event.stopPropagation();deleteAnnouncement(${a.id})" title="删除">
                <i class="bi bi-trash"></i>
            </button>
        </div>
    `).join('');
}

function toggleAnnDropdown() {
    const dropdown = document.getElementById('annDropdown');
    const annBar = document.getElementById('annBar');
    if (dropdown.style.display === 'block') { closeAnnDropdown(); return; }
    renderDropdown();
    dropdown.style.display = 'block';
    annBar.classList.add('open');
}

function closeAnnDropdown() {
    const dropdown = document.getElementById('annDropdown');
    const annBar = document.getElementById('annBar');
    dropdown.style.display = 'none';
    annBar.classList.remove('open');
}

// badge 变形为新增按钮后的点击处理
function handleBadgeClick(e) {
    const annBar = document.getElementById('annBar');
    if (annBar.classList.contains('open')) {
        e.stopPropagation();
        showAddAnnouncement();
    }
    // 未展开：事件冒泡到 annBar，触发 toggleAnnDropdown()
}

// 点击外部关闭
document.addEventListener('click', e => {
    const dropdown = document.getElementById('annDropdown');
    if (!dropdown || dropdown.style.display !== 'block') return;
    const wrap = document.getElementById('annBarWrap');
    if (wrap && !wrap.contains(e.target)) closeAnnDropdown();
});

// ===== 渲染 =====
function updateStats() {
    const total = allDevices.length;
    const inStock = allDevices.filter(d => d.location_status !== 'checked_out').length;
    const checkedOut = allDevices.filter(d => d.location_status === 'checked_out').length;
    const now = new Date();
    const sevenDays = new Date(now.getTime() + 7*86400000);
    const expiring = allDevices.filter(d => d.expiry_date && new Date(d.expiry_date) >= now && new Date(d.expiry_date) <= sevenDays).length;
    document.getElementById('totalCount').textContent = total;
    document.getElementById('inStockCount').textContent = inStock;
    document.getElementById('checkedOutCount').textContent = checkedOut;
    document.getElementById('expiringCount').textContent = expiring;
}

function getFilteredDevices() {
    let devices = [...allDevices];
    if (currentTagFilter) {
        devices = devices.filter(d => {
            let tags = [];
            const f = d.tag_names || d.tag_name || '';
            if (f) { try { tags = JSON.parse(f); } catch(e) { tags = f.split(',').map(t=>t.trim()).filter(Boolean); } }
            return tags.includes(currentTagFilter);
        });
    }
    if (currentTab === 'in') devices = devices.filter(d => d.location_status !== 'checked_out');
    if (currentTab === 'out') devices = devices.filter(d => d.location_status === 'checked_out');
    if (currentTab === 'expiring') {
        const now = new Date();
        const thirty = new Date(now.getTime()+30*86400000);
        devices = devices.filter(d => d.expiry_date && new Date(d.expiry_date) <= thirty);
    }
    const q = document.getElementById('searchInput')?.value.trim().toLowerCase();
    if (q) {
        devices = devices.filter(d =>
            (d.name||'').toLowerCase().includes(q) ||
            (d.spec_model||'').toLowerCase().includes(q) ||
            (d.device_id||'').toLowerCase().includes(q) ||
            (d.remark||'').toLowerCase().includes(q)
        );
    }
    return devices;
}

function renderDevices() {
    const devices = getFilteredDevices();
    document.getElementById('deviceCount').textContent = devices.length;
    const tabLabels = { all: '全部设备', in: '在库设备', out: '已出库', expiring: '临期设备' };
    document.getElementById('deviceTabLabel').textContent = tabLabels[currentTab] || '设备列表';

    if (devices.length === 0) {
        document.getElementById('tableViewContainer').style.display = 'none';
        document.getElementById('listViewContainer').style.display = 'none';
        document.getElementById('emptyState').style.display = '';
        return;
    }
    document.getElementById('emptyState').style.display = 'none';

    if (viewMode === 'table') {
        document.getElementById('tableViewContainer').style.display = '';
        document.getElementById('listViewContainer').style.display = 'none';
        renderTable(devices);
        applyColumnVisibility();
        // 批量模式下列头/列数据都已在 renderTable 中渲染，只需控制 th 显隐
        const batchTh = document.querySelector('th[data-col="batch-check"]');
        if (batchTh) batchTh.style.display = batchSelectMode ? '' : 'none';
    } else {
        document.getElementById('tableViewContainer').style.display = 'none';
        document.getElementById('listViewContainer').style.display = '';
        renderList(devices);
    }
    // 更新补全ID按钮可见性
    updateBackfillBtnVisibility();
}

function renderTable(devices) {
    const statusClass = { '正常': 'status-normal', '异常': 'status-abnormal', '维修中': 'status-maintenance' };
    const rows = devices.map(d => {
        const isOut = d.location_status === 'checked_out';
        const noWarehouse = !d.warehouse_name;
        const isChecked = selectedDeviceIds.has(d.id);

        // 按 key 构建单元格映射
        const cellMap = {
            deviceId:     `<td data-col="device-id" data-label="设备ID">${d.device_id ? `<span class="device-id-badge${noWarehouse ? ' device-id-badge-no-warehouse' : ''}" title="${noWarehouse ? '未指定仓库' : ''}" onclick="event.stopPropagation()">${escapeHtml(d.device_id)}</span>` : '<span class="text-muted">-</span>'}</td>`,
            name:         `<td data-col="name" data-label="名称" class="device-name-cell"${d.name ? ` title="${escapeAttr(d.name)}"` : ''}><strong>${d.name}</strong></td>`,
            warehouse:    `<td data-col="warehouse" data-label="所属仓库">${d.warehouse_name || '<span style="color:var(--danger);font-weight:600;">未指定</span>'}</td>`,
            serialNumber: `<td data-col="serial-number" data-label="序列号"${d.serial_number ? ` title="${escapeAttr(d.serial_number)}"` : ''}>${d.serial_number || '<span class="text-muted">-</span>'}</td>`,
            specModel:    `<td data-col="spec-model" data-label="规格型号"${d.spec_model ? ` title="${escapeAttr(d.spec_model)}"` : ''}>${d.spec_model || '<span class="text-muted">-</span>'}</td>`,
            source:       `<td data-col="source" data-label="来源"${d.source ? ` title="${escapeAttr(d.source)}"` : ''}>${d.source || '<span class="text-muted">-</span>'}</td>`,
            quantity:     `<td data-col="quantity" data-label="数量">${d.quantity || 1}</td>`,
            tags:         `<td data-col="tags" data-label="标签">${renderTagBadges(d, window.innerWidth < 1500 ? 1 : 2)}</td>`,
            department:   `<td data-col="department" data-label="部门">${d.department_path || '<span class="text-muted">-</span>'}</td>`,
            responsible:  `<td data-col="responsible" data-label="负责人">${d.responsible_person || '<span class="text-muted">-</span>'}</td>`,
            location:     `<td data-col="location" data-label="位置/去向"${(isOut ? d.destination : d.storage_location) ? ` title="${escapeAttr(isOut ? d.destination : d.storage_location)}"` : ''}>${escapeHtml(isOut ? (d.destination || '已出库') : (d.storage_location || '在库'))}</td>`,
            status:       `<td data-col="status" data-label="状态"><span class="status-badge ${statusClass[d.status] || ''}">${d.status || '-'}</span></td>`,
            expiry:       `<td data-col="expiry" data-label="到期日">${formatExpiryBadge(d.expiry_date)}</td>`,
            checkin:      `<td data-col="checkin" data-label="入库时间">${d.checkin_time ? formatDate(d.checkin_time) : '<span class="text-muted">-</span>'}</td>`,
            remark:       `<td data-col="remark" data-label="备注">${d.remark
                ? `<span class="remark-tooltip-wrapper" onclick="event.stopPropagation();if(!window._remarkTouchFlag){showRemarkPreview(${d.id},'${escapeOnClick(d.name)}')}window._remarkTouchFlag=false"><i class="bi bi-file-text remark-icon" ontouchstart="window._remarkTouchFlag=true;event.stopPropagation()"></i></span>`
                : '<span class="text-muted">-</span>'
            }</td>`,
            actions: `<td data-col="actions" data-label="操作">
                <div class="action-btns" onclick="event.stopPropagation();">
                    ${isOut
                        ? `<button class="btn-icon-table primary" onclick="openCheckinModal(${d.id},'${escapeOnClick(d.name)}')" title="入库"><i class="bi bi-box-arrow-in-left"></i></button>`
                        : `<button class="btn-icon-table primary" onclick="openCheckoutModal(${d.id},'${escapeOnClick(d.name)}')" title="出库"><i class="bi bi-box-arrow-right"></i></button>`
                    }
                    <button class="btn-icon-table" onclick="openDeviceModal(${d.id})" title="编辑"><i class="bi bi-pencil"></i></button>
                    <button class="btn-icon-table danger" onclick="deleteDevice(${d.id},'${escapeOnClick(d.name)}')" title="删除"><i class="bi bi-trash"></i></button>
                </div>
            </td>`,
        };

        // 按 columnOrder + 'actions' 顺序组装
        const renderKeys = getRenderColumnKeys();
        const cells = renderKeys.map(k => cellMap[k] || '').join('');

        const checkboxTd = batchSelectMode
            ? `<td data-col="batch-check" data-label="" class="batch-check-col">
                <input type="checkbox" class="batch-checkbox" data-device-id="${d.id}" ${isChecked ? 'checked' : ''} onclick="event.stopPropagation();toggleDeviceSelect(${d.id})">
               </td>`
            : '';
        const rowClass = `${batchSelectMode && isChecked ? 'batch-selected' : ''}`;
        const rowClick = batchSelectMode ? '' : `onclick="goDeviceDetail('${escapeOnClick(d.device_id || String(d.id))}')"`;
        return `<tr data-device-id="${d.id}" class="${rowClass}" ${rowClick} style="${batchSelectMode ? '' : 'cursor:pointer;'}">
            ${checkboxTd}
            ${cells}
        </tr>`;
    }).join('');
    document.getElementById('deviceTableBody').innerHTML = rows;
    if (batchSelectMode) initDragSelect();

    // 动态渲染表头
    renderTableHead();
}

function renderList(devices) {
    const html = devices.map(d => {
        const tags = parseTags(d.tag_names || d.tag_name || '');
        const isOut = d.location_status === 'checked_out';
        // 标签：最多显示2个，多余收起
        const visibleTags = tags.slice(0, 2);
        const tagsHtml = visibleTags.map(t => `<span class="device-card-tag">${escapeHtml(t)}</span>`).join('')
            + (tags.length > 2
                ? `<span class="tag-more device-card-tag-more">+${tags.length - 2}<span class="tag-more-tip">${tags.slice(2).map(t => `<span class="tag-item-inline">${escapeHtml(t)}</span>`).join('')}</span></span>`
                : '');
        // 规格型号
        const specHtml = d.spec_model ? `<div class="device-card-spec">${escapeHtml(d.spec_model)}</div>` : '';
        // 到期日期
        const expiryHtml = d.expiry_date ? `<span class="device-card-expiry-inline">${formatExpiryBadge(d.expiry_date)}</span>` : '';
        // 备注
        const remarkHtml = d.remark ? `<div class="device-card-remark"><i class="bi bi-chat-left-text"></i> ${escapeHtml(d.remark)}</div>` : '';
        return `<div class="device-card" onclick="goDeviceDetail('${d.device_id || d.id}')">
            <div class="device-card-name-row">
                <div class="device-card-name">${escapeHtml(d.name)}${d.quantity > 1 ? `<span class="device-card-qty">×${d.quantity}</span>` : ''}</div>
                <span class="status-badge ${isOut?'checked-out':'in-stock'}">${isOut?'已出库':'在库'}</span>
            </div>
            ${tagsHtml || expiryHtml ? `<div class="device-card-tags-row">${tagsHtml ? `<div class="device-card-tags">${tagsHtml}</div>` : ''}${expiryHtml}</div>` : ''}
            ${specHtml}
            ${remarkHtml}
        </div>`;
    }).join('');
    document.getElementById('listViewContainer').innerHTML = html;
}

function renderWarehouseList() {
    const ul = document.getElementById('warehouseList');
    const btn = document.getElementById('warehouseShowMore');
    const totalCount = warehouses.reduce((sum, w) => sum + (w.device_count || 0), 0);
    const countStyle = 'color:var(--success);font-weight:700;font-size:var(--text-sm);opacity:0.85;margin-left:auto;';
    let html = `<li class="${!currentWarehouse ? 'active' : ''}" onclick="selectWarehouse(null)">
        <i class="bi bi-grid-fill warehouse-dot" style="color:#2C2C2C;"></i><span>全部仓库</span>
        <span style="${countStyle}">${totalCount}</span></li>`;
    // 未指定仓库的设备计数
    const unassignedCount = allDevices.filter(d => !d.warehouse_name).length;
    if (unassignedCount > 0) {
        const isActive = currentWarehouse && currentWarehouse.id === '__unassigned__';
        html += `<li class="${isActive ? 'active' : ''}" onclick="selectWarehouse('__unassigned__')">
            <i class="bi bi-question-circle-fill warehouse-dot" style="color:var(--warning);"></i><span>未指定</span>
            <span style="${countStyle}">${unassignedCount}</span></li>`;
    }
    const displayWarehouses = warehouseShowAll ? warehouses : warehouses.slice(0, 5);
    html += displayWarehouses.map(w => `<li class="${currentWarehouse && currentWarehouse.id===w.id?'active':''}" onclick="selectWarehouse(${w.id},'${escapeAttr(w.name)}')">
        <i class="bi bi-bucket-fill warehouse-dot" style="color:#909090;"></i><span>${escapeHtml(w.name)}</span>
        <span style="${countStyle}">${w.device_count || 0}</span></li>`).join('');
    ul.innerHTML = html;
    // "显示更多"按钮
    if (warehouses.length > 5) {
        btn.style.display = '';
        btn.innerHTML = warehouseShowAll
            ? '<i class="bi bi-chevron-up"></i> 收起'
            : '<i class="bi bi-chevron-down"></i> 显示更多 (' + (warehouses.length - 5) + ')';
    } else {
        btn.style.display = 'none';
    }
}

function renderTagList(stats) {
    const container = document.getElementById('tagList');
    if (!stats.length) { container.innerHTML = '<span style="font-size:var(--text-2xs);color:var(--text-muted);padding:4px 8px;">暂无标签</span>'; return; }
    container.innerHTML = stats.map(t => {
        const active = currentTagFilter === t.name;
        return `<span class="tag-item${active?' active':''}" onclick="selectTag('${escapeAttr(t.name)}')">${escapeHtml(t.name)}<span class="tag-count">${t.total}</span></span>`;
    }).join('');
}

function renderExpiringList(list) {
    const ul = document.getElementById('expiringList');
    if (!list.length) {
        ul.innerHTML = '<li style="font-size:var(--text-2xs);color:var(--text-muted);padding:6px 8px;">暂无临期设备</li>';
        document.getElementById('expiringMoreBtn').style.display = 'none';
        return;
    }
    ul.innerHTML = list.map(d => {
        const days = d.remaining_days;
        const cs = getExpiryColorStyle(days);
        return `<li onclick="goDeviceDetail('${d.device_id || d.id}')">
            <span>${escapeHtml(d.name)}</span>
            <span class="expiring-badge-sidebar" style="background:${cs.bg};color:${cs.color};">${days}天</span>
        </li>`;
    }).join('');
    // 更多按钮
    const btn = document.getElementById('expiringMoreBtn');
    if (expiringDevicesAll.length > 5) {
        btn.style.display = 'block';
        btn.textContent = expiringShowAll ? '收起' : `更多（共${expiringDevicesAll.length}条）`;
    } else {
        btn.style.display = 'none';
    }
}

function toggleExpiringMore() {
    expiringShowAll = !expiringShowAll;
    if (expiringShowAll) {
        renderExpiringList(expiringDevicesAll);
    } else {
        renderExpiringList(expiringDevicesAll.slice(0, 5));
    }
}

function parseTags(field) {
    if (!field) return [];
    try { const arr = JSON.parse(field); return Array.isArray(arr) ? arr : []; } catch(e) {}
    return field.split(',').map(t=>t.trim()).filter(Boolean);
}

// ===== 交互 =====
function selectWarehouse(id, name) {
    if (id === null) { currentWarehouse = null; currentTagFilter = null; }
    else if (id === '__unassigned__') { currentWarehouse = { id: '__unassigned__', name: '__unassigned__' }; currentTagFilter = null; }
    else { currentWarehouse = { id, name }; currentTagFilter = null; }
    currentTab = 'all';
    updateStatHighlight();

    renderWarehouseList();
    loadDevices();
}

function selectTag(tag) {
    currentTagFilter = currentTagFilter === tag ? null : tag;
    loadTagStats();
    renderDevices();
}

function switchDeviceTab(tab) {
    currentTab = tab;
    updateStatHighlight();
    renderDevices();
}

// 更新侧边栏统计概览的选中状态
function updateStatHighlight() {
    const ids = { all: 'statTotal', in: 'statInStock', out: 'statCheckedOut', expiring: 'statExpiring' };
    document.querySelectorAll('.sidebar-stat-item').forEach(el => el.classList.remove('active'));
    const activeEl = document.getElementById(ids[currentTab]);
    if (activeEl) activeEl.classList.add('active');
}

function switchView(mode, isAuto = false) {
    viewMode = mode;
    if (!isAuto) autoSwitchedToCard = false;  // 用户手动切换，清除自动标记
    document.getElementById('tableViewBtn').classList.toggle('active', mode==='table');
    document.getElementById('listViewBtn').classList.toggle('active', mode==='list');
    renderDevices();
}

function goDeviceDetail(ref) {
    window.open('device.html?device_id=' + encodeURIComponent(ref), '_blank');
}

// ===== 设备模态框 =====
function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
}


// ============ 弹窗标签管理 ============

// 收集系统中所有已有的标签名列表（用于 datalist 建议）
function collectAllTagNames() {
    const tagSet = new Set();
    allDevices.forEach(d => {
        const tagField = d.tag_names || d.tag_name || '';
        if (tagField) {
            try {
                const tags = JSON.parse(tagField);
                tags.forEach(t => tagSet.add(t));
            } catch (e) {
                tagField.split(',').forEach(t => { const name = t.trim(); if (name) tagSet.add(name); });
            }
        }
    });
    return [...tagSet].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

// 渲染标签建议 datalist
function updateTagDatalist() {
    const datalist = document.getElementById('tagSuggestionsList');
    if (!datalist) return;
    const allTags = collectAllTagNames();
    datalist.innerHTML = allTags.map(t => `<option value="${t}">`).join('');
}

// 渲染弹窗中的标签 badges
function renderModalTagBadges() {
    const container = document.getElementById('deviceTagBadges');
    if (!container) return;
    if (modalTags.length === 0) {
        container.innerHTML = '<span style="font-size:12px;color:var(--text-muted);">暂无标签</span>';
    } else {
        container.innerHTML = modalTags.map(tag => `
            <span class="tag-badge-editable">
                ${escapeHtml(tag)}
                <span class="tag-remove" onclick="removeTagFromDevice('${escapeOnClick(tag)}')">&times;</span>
            </span>
        `).join('');
    }
}

// 添加标签
function addTagToDevice() {
    const input = document.getElementById('deviceTagInput');
    if (!input) return;
    const tagName = input.value.trim();
    if (!tagName) return;
    if (modalTags.includes(tagName)) {
        showToast('该标签已存在', 'warning');
        return;
    }
    modalTags.push(tagName);
    input.value = '';
    renderModalTagBadges();
    updateTagDatalist();
}

// 删除标签
function removeTagFromDevice(tagName) {
    modalTags = modalTags.filter(t => t !== tagName);
    renderModalTagBadges();
}

// 获取设备标签 JSON 字符串
function getDeviceTagsJSON() {
    return modalTags.length > 0 ? JSON.stringify(modalTags) : '';
}

// 初始化弹窗标签
function initModalTags(device) {
    if (device && (device.tag_names || device.tag_name)) {
        const tagField = (device.tag_names || device.tag_name || '').trim();
        if (tagField.startsWith('[')) {
            try { modalTags = JSON.parse(tagField); } catch (e) { modalTags = []; }
        } else if (tagField) {
            modalTags = tagField.split(',').map(t => t.trim()).filter(t => t);
        } else {
            modalTags = [];
        }
    } else {
        modalTags = [];
    }
    renderModalTagBadges();
}

function openDeviceModal(id) {
    deviceModalId = id || null;
    const title = document.getElementById('deviceModalTitle');
    const body = document.getElementById('deviceModalBody');
    const footer = document.getElementById('deviceModalFooter');
    title.textContent = id ? '编辑设备' : '添加设备';

    let device = id ? allDevices.find(d => d.id === id) : null;
    if (!device) device = {};

    let whOptions = '<option value="">无仓库</option>' + warehouses.map(w => `<option value="${escapeAttr(w.name)}" ${device.warehouse_name===w.name?'selected':''}>${escapeHtml(w.name)}</option>`).join('');

    body.innerHTML = `
        <input type="hidden" id="frmDeviceId" value="${device.id || ''}">
        <div class="form-group">
            <label class="form-label">设备ID <span style="color:var(--text-muted);font-size:var(--text-xs);">（6位码，自动生成）</span></label>
            <div style="display:flex;gap:6px;">
                <input type="text" class="form-input" id="frmDeviceCode" value="${escapeAttr(device.device_id || '')}" readonly style="background:var(--primary-bg);">
                ${!id ? '<button type="button" class="btn btn-secondary btn-sm" onclick="generateCode()" style="white-space:nowrap;"><i class="bi bi-arrow-repeat"></i> 生成</button>' : ''}
            </div>
        </div>
        <div class="form-group"><label class="form-label">设备名称 <span class="required">*</span></label><input type="text" class="form-input" id="frmDeviceName" value="${escapeAttr(device.name || '')}" placeholder="例如：Dell电脑主机"></div>
        <div class="form-row">
            <div class="form-group"><label class="form-label">所属仓库</label><select class="form-select" id="frmWarehouse">${whOptions}</select></div>
            <div class="form-group"><label class="form-label">数量</label><input type="number" class="form-input" id="frmQuantity" value="${device.quantity || 1}" min="1"></div>
        </div>
        <div class="form-row">
            <div class="form-group"><label class="form-label">规格型号</label><input type="text" class="form-input" id="frmSpecModel" value="${escapeAttr(device.spec_model || '')}" placeholder="例如：联想 E14"></div>
            <div class="form-group"><label class="form-label">来源</label><input type="text" class="form-input" id="frmSource" value="${escapeAttr(device.source || '')}" placeholder="例如：淘宝采购"></div>
        </div>
        <div class="form-group">
            <label class="form-label">标签（点击 × 删除）</label>
            <div id="deviceTagBadges" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;min-height:28px;"></div>
            <div class="modal-tag-input-row">
                <input type="text" id="deviceTagInput" placeholder="输入标签名，回车添加..." list="tagSuggestionsList"
                       onkeydown="if(event.key==='Enter'){event.preventDefault();addTagToDevice();}">
                <button type="button" class="btn btn-secondary btn-sm" onclick="addTagToDevice()">
                    <i class="bi bi-plus"></i> 添加
                </button>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group"><label class="form-label">序列号</label><input type="text" class="form-input" id="frmSerialNumber" value="${escapeAttr(device.serial_number || '')}"></div>
            <div class="form-group"><label class="form-label">负责人</label><input type="text" class="form-input" id="frmResponsible" value="${escapeAttr(device.responsible_person || '')}"></div>
        </div>
        <div class="form-group"><label class="form-label">所属路径</label><input type="text" class="form-input" id="frmDepartment" value="${escapeAttr(device.department_path || '')}" placeholder="例如：XX公司 / 研发部"></div>
        <div class="form-row">
            <div class="form-group"><label class="form-label">存放位置</label><input type="text" class="form-input" id="frmLocation" value="${escapeAttr(device.storage_location || '')}" placeholder="例如：A区货架2层"></div>
            <div class="form-group"><label class="form-label">设备状态</label><select class="form-select" id="frmStatus">
                <option value="正常" ${device.status==='正常'?'selected':''}>正常</option>
                <option value="异常" ${device.status==='异常'?'selected':''}>异常</option>
                <option value="维修中" ${device.status==='维修中'?'selected':''}>维修中</option>
            </select></div>
        </div>
        <div class="form-row">
            <div class="form-group"><label class="form-label">入库时间</label><input type="date" class="form-input" id="frmCheckinTime" value="${formatDateInput(device.checkin_time)}"></div>
            <div class="form-group"><label class="form-label">到期日期</label><input type="date" class="form-input" id="frmExpiryDate" value="${formatDateInput(device.expiry_date)}"></div>
        </div>
        <div class="form-group">
            <label class="form-label">在库状态</label>
            <select class="form-select" id="frmLocationStatus" onchange="document.getElementById('frmDestRow').style.display=this.value==='checked_out'?'':'none'">
                <option value="in_stock" ${device.location_status!=='checked_out'?'selected':''}>在库</option>
                <option value="checked_out" ${device.location_status==='checked_out'?'selected':''}>已出库</option>
            </select>
        </div>
        <div class="form-group" id="frmDestRow" style="${device.location_status==='checked_out'?'':'display:none;'}"><label class="form-label">去向</label><input type="text" class="form-input" id="frmDestination" value="${escapeAttr(device.destination || '')}" placeholder="例如：同事张三借用"></div>
        <div class="form-group">
            <label class="form-label">附件</label>
            <div class="modal-attachment-list" id="modalAttachmentList_${escapeAttr(device.device_id || 'new')}">
                <div style="font-size:12px;color:var(--text-muted);padding:4px 0;">${id ? '加载中...' : '保存设备后可上传附件'}</div>
            </div>
            ${id ? '<button type="button" class="btn btn-secondary btn-sm" onclick="triggerUploadAttachment()" style="margin-top:8px;"><i class="bi bi-plus-lg"></i> 上传附件</button>' : ''}
        </div>
        <div class="form-group">
            <div class="modal-section-heading">
                <label class="form-label" style="margin-bottom:0;">备注</label>
                <button type="button" class="btn btn-secondary btn-sm" onclick="openRichTextEditorFromModal()"><i class="bi bi-pencil-square"></i> 富文本编辑</button>
            </div>
            <div class="modal-remark-editor rich-text-content" id="frmRemarkEditor" contenteditable="true" data-placeholder="其他说明（可选）">${device.remark ? decodeRichText(device.remark) : ''}</div>
            <textarea id="frmRemark" style="display:none;">${escapeHtml(device.remark || '')}</textarea>
            <div id="frmRemarkPreview" style="display:none;"></div>
        </div>
    `;

    footer.innerHTML = `
        <button class="btn btn-secondary" onclick="closeAllModals()">取消</button>
        ${id ? '<button class="btn btn-danger" onclick="deleteDeviceFromModal()">删除</button>' : ''}
        <button class="btn btn-primary" onclick="saveDevice()">保存</button>
    `;

    document.getElementById('deviceModal').style.display = 'flex';

    // 初始化弹窗标签
    initModalTags(device);
    updateTagDatalist();

    // 编辑已有设备时异步加载附件
    if (id && device.device_id) {
        loadDeviceAttachments(device.device_id);
    }

    // 备注区图片单击全屏（正式版逻辑）
    const remarkEditor = document.getElementById('frmRemarkEditor');
    if (remarkEditor) {
        remarkEditor.addEventListener('click', function(e) {
            if (e.target.tagName === 'IMG') { e.preventDefault(); showImageFullscreen(e.target.src); }
        });
    }
}

function closeDeviceModal() { closeAllModals(); }

async function generateCode() {
    try {
        const r = await fetch(API_BASE + '/devices/next-code');
        const data = await r.json();
        if (data.code) document.getElementById('frmDeviceCode').value = data.code;
    } catch(e) { showToast('生成设备ID失败', 'error'); }
}

async function saveDevice() {
    const id = document.getElementById('frmDeviceId')?.value;
    const locStatus = document.getElementById('frmLocationStatus')?.value || 'in_stock';
    const dest = locStatus === 'checked_out' ? (document.getElementById('frmDestination')?.value || '') : '';
    const checkinDate = document.getElementById('frmCheckinTime')?.value || '';
    const expiryDate = document.getElementById('frmExpiryDate')?.value || '';
    const tagsJson = getDeviceTagsJSON();
    const data = {
        device_id: document.getElementById('frmDeviceCode')?.value || '',
        warehouseName: document.getElementById('frmWarehouse')?.value || '',
        name: document.getElementById('frmDeviceName')?.value || '',
        tag_names: tagsJson,
        quantity: parseInt(document.getElementById('frmQuantity')?.value) || 1,
        status: document.getElementById('frmStatus')?.value || '正常',
        storage_location: document.getElementById('frmLocation')?.value || '',
        location_status: locStatus,
        destination: dest,
        remark: document.getElementById('frmRemarkEditor')?.innerHTML ? encodeRichText(document.getElementById('frmRemarkEditor').innerHTML) : (document.getElementById('frmRemark')?.value || ''),
        checkin_time: checkinDate ? checkinDate + ' 00:00:00' : null,
        expiry_date: expiryDate || null,
        responsible_person: document.getElementById('frmResponsible')?.value || '',
        department_path: document.getElementById('frmDepartment')?.value || '',
        serial_number: document.getElementById('frmSerialNumber')?.value || '',
        spec_model: document.getElementById('frmSpecModel')?.value || '',
        source: document.getElementById('frmSource')?.value || ''
    };
    if (!data.name) { showToast('请输入设备名称', 'warning'); return; }
    try {
        const url = id ? `${API_BASE}/devices/${id}` : `${API_BASE}/devices`;
        const method = id ? 'PUT' : 'POST';
        const r = await fetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
        if (!r.ok) { const t = await r.text(); throw new Error(t); }
        closeAllModals();
        showToast(id ? '设备已更新' : '设备已添加', 'success');
        loadDevices();
        loadWarehouses();
    } catch(e) { showToast('保存失败: ' + e.message, 'error'); }
}

function deleteDeviceFromModal() {
    const id = document.getElementById('frmDeviceId')?.value;
    const name = document.getElementById('frmDeviceName')?.value;
    if (!id) return;
    deleteDevice(parseInt(id), name);
}

async function deleteDevice(id, name) {
    if (!confirm(`确定要删除设备"${name}"吗？此操作不可撤销。`)) return;
    try {
        const r = await fetch(`${API_BASE}/devices/${id}`, { method: 'DELETE' });
        if (!r.ok) throw new Error(await r.text());
        closeAllModals();
        showToast('设备已删除', 'success');
        loadDevices();
        loadWarehouses();
    } catch(e) { showToast('删除失败: ' + e.message, 'error'); }
}

// ===== 出库/入库 =====
let checkoutDeviceId = null;
let checkinDeviceId = null;

function openCheckoutModal(id, name) {
    checkoutDeviceId = id;
    const body = document.getElementById('checkoutModalBody');
    const footer = document.getElementById('checkoutModalFooter');
    document.getElementById('checkoutModalTitle').textContent = '设备出库';
    body.innerHTML = `
        <div class="form-group"><label class="form-label">设备</label><div style="font-weight:500;color:var(--text-primary);">${escapeHtml(name)}</div></div>
        <div class="form-group"><label class="form-label">去向</label><input type="text" class="form-input" id="checkoutDest" placeholder="例如：同事张三借用"></div>
    `;
    footer.innerHTML = `<button class="btn btn-secondary" onclick="closeAllModals()">取消</button><button class="btn btn-primary" onclick="confirmCheckout()">确认出库</button>`;
    document.getElementById('checkoutModal').style.display = 'flex';
}

async function confirmCheckout() {
    const dest = document.getElementById('checkoutDest')?.value || '';
    try {
        const r = await fetch(`${API_BASE}/devices/${checkoutDeviceId}`, {
            method: 'PUT', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ location_status: 'checked_out', destination: dest, checkout_time: new Date().toISOString() })
        });
        if (!r.ok) throw new Error(await r.text());
        closeAllModals();
        showToast('设备已出库', 'success');
        loadDevices();
    } catch(e) { showToast('出库失败: ' + e.message, 'error'); }
}

function openCheckinModal(id, name) {
    checkinDeviceId = id;
    const body = document.getElementById('checkoutModalBody');
    const footer = document.getElementById('checkoutModalFooter');
    document.getElementById('checkoutModalTitle').textContent = '设备入库';
    body.innerHTML = `<div class="form-group"><label class="form-label">设备</label><div style="font-weight:500;color:var(--text-primary);">${escapeHtml(name)}</div><p style="color:var(--text-muted);margin-top:8px;">确认将该设备重新入库？</p></div>`;
    footer.innerHTML = `<button class="btn btn-secondary" onclick="closeAllModals()">取消</button><button class="btn btn-primary" onclick="confirmCheckin()">确认入库</button>`;
    document.getElementById('checkoutModal').style.display = 'flex';
}

async function confirmCheckin() {
    try {
        const r = await fetch(`${API_BASE}/devices/${checkinDeviceId}`, {
            method: 'PUT', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ location_status: 'in_stock', destination: '', checkin_time: new Date().toISOString() })
        });
        if (!r.ok) throw new Error(await r.text());
        closeAllModals();
        showToast('设备已入库', 'success');
        loadDevices();
    } catch(e) { showToast('入库失败: ' + e.message, 'error'); }
}

function closeCheckoutModal() { closeAllModals(); }

// ===== 仓库管理 =====
function openWarehouseModal() {
    const title = document.getElementById('warehouseModalTitle');
    const body = document.getElementById('warehouseModalBody');
    title.textContent = '仓库管理';
    const listHtml = warehouses.map(w => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border-light);">
            <div>
                <div style="font-weight:500;color:var(--text-primary);">${escapeHtml(w.name)}</div>
                ${w.description ? `<div style="font-size:var(--text-xs);color:var(--text-muted);">${escapeHtml(w.description)}</div>` : ''}
            </div>
            <div style="display:flex;gap:4px;">
                <button class="btn btn-secondary btn-sm" onclick="editWarehouseInline(${w.id},'${escapeAttr(w.name)}','${escapeAttr(w.description||'')}')"><i class="bi bi-pencil"></i></button>
                <button class="btn btn-danger btn-sm" onclick="deleteWarehouse(${w.id},'${escapeAttr(w.name)}')"><i class="bi bi-trash"></i></button>
            </div>
        </div>
    `).join('');

    body.innerHTML = `
        ${listHtml || '<div style="color:var(--text-muted);padding:12px 0;">暂无仓库</div>'}
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border);">
            <div class="form-group"><label class="form-label">新建仓库</label>
                <div style="display:flex;gap:8px;">
                    <input type="text" class="form-input" id="newWhName" placeholder="仓库名称" style="flex:1;">
                    <button class="btn btn-primary btn-sm" onclick="addWarehouse()"><i class="bi bi-plus-lg"></i> 添加</button>
                </div>
            </div>
        </div>
        <div id="whEditSection" style="display:none;margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
            <input type="hidden" id="whEditId">
            <div class="form-group"><label class="form-label">仓库名称</label><input type="text" class="form-input" id="whEditName"></div>
            <div class="form-group"><label class="form-label">描述</label><input type="text" class="form-input" id="whEditDesc"></div>
            <div style="display:flex;gap:8px;">
                <button class="btn btn-primary btn-sm" onclick="saveWarehouseEdit()">保存</button>
                <button class="btn btn-secondary btn-sm" onclick="document.getElementById('whEditSection').style.display='none'">取消</button>
            </div>
        </div>
    `;
    document.getElementById('warehouseModal').style.display = 'flex';
}

function closeWarehouseModal() { closeAllModals(); }

async function addWarehouse() {
    const name = document.getElementById('newWhName')?.value.trim();
    if (!name) { showToast('请输入仓库名称', 'warning'); return; }
    try {
        const r = await fetch(API_BASE + '/warehouses', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name}) });
        if (!r.ok) throw new Error(await r.text());
        showToast('仓库已添加', 'success');
        loadWarehouses();
        openWarehouseModal(); // 刷新列表
    } catch(e) { showToast('添加失败: ' + e.message, 'error'); }
}

function editWarehouseInline(id, name, desc) {
    document.getElementById('whEditId').value = id;
    document.getElementById('whEditName').value = name;
    document.getElementById('whEditDesc').value = desc || '';
    document.getElementById('whEditSection').style.display = '';
}

async function saveWarehouseEdit() {
    const id = document.getElementById('whEditId')?.value;
    const name = document.getElementById('whEditName')?.value.trim();
    const desc = document.getElementById('whEditDesc')?.value.trim();
    if (!name) { showToast('请输入仓库名称', 'warning'); return; }
    try {
        const r = await fetch(`${API_BASE}/warehouses/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name, description: desc}) });
        if (!r.ok) throw new Error(await r.text());
        showToast('仓库已更新', 'success');
        document.getElementById('whEditSection').style.display = 'none';
        loadWarehouses();
        openWarehouseModal();
    } catch(e) { showToast('更新失败: ' + e.message, 'error'); }
}

async function deleteWarehouse(id, name) {
    if (!confirm(`确定要删除仓库"${name}"吗？该仓库下的所有设备也将被删除。`)) return;
    try {
        const r = await fetch(`${API_BASE}/warehouses/${id}`, { method:'DELETE' });
        if (!r.ok) throw new Error(await r.text());
        showToast('仓库已删除', 'success');
        if (currentWarehouse && currentWarehouse.id === id) selectWarehouse(null);
        loadWarehouses();
        openWarehouseModal();
    } catch(e) { showToast('删除失败: ' + e.message, 'error'); }
}

// ===== 导出/导入 =====
async function exportDevices() {
    try {
        let url = API_BASE + '/devices/export';
        if (currentWarehouse && currentWarehouse.id !== '__unassigned__') url += '?warehouseName=' + encodeURIComponent(currentWarehouse.name);
        const r = await fetch(url);
        if (!r.ok) throw new Error(await r.text());
        const blob = await r.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `设备表_${new Date().toISOString().split('T')[0]}.xlsx`;
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('导出成功', 'success');
    } catch(e) { showToast('导出失败: ' + e.message, 'error'); }
}

function openImportModal() {
    const body = document.getElementById('importModalBody');
    body.innerHTML = `
        <div class="import-tabs">
            <button class="import-tab-btn active" id="importTabPaste" onclick="switchImportTab('paste')">批量粘贴</button>
            <button class="import-tab-btn" id="importTabFile" onclick="switchImportTab('file')">文件导入</button>
        </div>
        <div id="importPastePanel">
            <div class="form-hint" style="margin-bottom:8px;">粘贴 JSON 数组格式的设备数据，每行一个设备对象</div>
            <button class="import-helper-btn btn-example" onclick="insertJsonExample()"><i class="bi bi-lightbulb"></i> 插入示例</button>
            <button class="import-helper-btn btn-ai" onclick="copyAIPrompt()"><i class="bi bi-clipboard"></i> 复制AI提示语</button>
            <textarea class="import-batch-textarea" id="batchPasteText" placeholder='[{"name":"设备名称","spec_model":"型号","quantity":1}]'></textarea>
            <div id="importBatchResult" style="margin-top:12px;display:none;"></div>
        </div>
        <div id="importFilePanel" style="display:none;">
            <div class="form-group"><label class="form-label">选择导入文件（.xlsx / .csv）</label>
                <input type="file" class="form-input" id="importFile" accept=".xlsx,.xls,.csv" style="padding:6px;">
            </div>
            <div class="form-hint">第一行为表头，支持：仓库名称、设备名称、规格型号、序列号、来源、数量、标签、所属路径、负责人、位置、状态、到期日期、入库时间、去向、备注</div>
            <div class="form-group" style="margin-top:12px;">
                <label class="form-label">下载模板</label>
                <button class="btn btn-secondary btn-sm" onclick="downloadTemplate()"><i class="bi bi-download"></i> 下载导入模板</button>
            </div>
            <div id="importResult" style="margin-top:12px;"></div>
        </div>
        <div style="margin-top:16px;display:flex;gap:8px;">
            <button class="btn btn-secondary" onclick="closeImportModal()">关闭</button>
            <button class="btn btn-primary" id="importActionBtn" onclick="doImport()">开始导入</button>
        </div>
    `;
    document.getElementById('importModal').style.display = 'flex';
    switchImportTab('paste');
}

function switchImportTab(tab) {
    document.getElementById('importTabFile').classList.toggle('active', tab === 'file');
    document.getElementById('importTabPaste').classList.toggle('active', tab === 'paste');
    document.getElementById('importFilePanel').style.display = tab === 'file' ? '' : 'none';
    document.getElementById('importPastePanel').style.display = tab === 'paste' ? '' : 'none';
    const actionBtn = document.getElementById('importActionBtn');
    actionBtn.onclick = tab === 'file' ? doImport : startBatchImport;
    actionBtn.textContent = tab === 'file' ? '开始导入' : '导入';
}

function closeImportModal() { closeAllModals(); }

function downloadTemplate() {
    const a = document.createElement('a');
    a.href = API_BASE + '/devices/template';
    a.download = '设备导入模板.xlsx';
    a.click();
}

async function doImport() {
    const fileInput = document.getElementById('importFile');
    const file = fileInput?.files[0];
    if (!file) { showToast('请选择文件', 'warning'); return; }
    const formData = new FormData();
    formData.append('file', file);
    if (currentWarehouse && currentWarehouse.id !== '__unassigned__') formData.append('warehouseName', currentWarehouse.name);
    try {
        const r = await fetch(API_BASE + '/devices/import', { method: 'POST', body: formData });
        const data = await r.json();
        const resultDiv = document.getElementById('importResult');
        if (data.errors && data.errors.length) {
            resultDiv.innerHTML = `<div style="color:var(--danger);font-size:var(--text-sm);">成功导入 ${data.success} 条，${data.errors.length} 条失败：<br>${data.errors.map(e=>escapeHtml(e)).join('<br>')}</div>`;
        } else {
            resultDiv.innerHTML = `<div style="color:var(--success);font-size:var(--text-sm);">成功导入 ${data.success} 条设备！</div>`;
        }
        loadDevices();
        loadWarehouses();
    } catch(e) { showToast('导入失败: ' + e.message, 'error'); }
}

// 复制AI提示语
async function copyAIPrompt() {
    const prompt = `请将我下面描述的设备整理成JSON数组格式，每个设备一个对象。只需要name字段是必填的，其他字段有就填，没有就省略。

支持的字段及说明：
- name: 设备名称（必填。只填物品本身，如"U盘""显示器""键盘"，不要把品牌/型号写进来）
- spec_model: 规格型号（品牌、型号、容量等信息放这里，如"金士顿 64G""Dell U2723QE""罗技 MX Master 3"）
- serial_number: 序列号
- quantity: 数量（数字，不填默认为1）
- tags: 标签（只选与物品直接相关的核心分类，1个就够了，不要硬凑。手表→数码电子，冰袖→运动户外，沙发→家具。多个标签仅在该物品确实跨品类时用逗号分隔，如扫地机器人→家电,家居用品）
- source: 来源/购买渠道
- department_path: 部门路径
- responsible_person: 负责人
- storage_location: 存放位置
- status: 状态（正常/异常/维修中，不填默认为正常）
- destination: 去向
- remark: 备注
- warehouse_name: 归属仓库。从我的描述中推断我提到的仓库名（如"工作仓库""家居仓库""办公仓库"等）。如果我说"工作仓库的笔记本""家居仓库里的沙发"，就把对应的仓库名填上。没提到仓库就不填。

可选的标签列表（括号内为分类示例，只需填逗号前的标签名，一个物品可以用1~3个标签）：
数码电子（电脑、笔记本、平板、显示器、键盘、鼠标、耳机、音箱、充电宝、U盘、硬盘、数据线、充电器、电源、手机、相机）
办公文具（打印机、扫描仪、投影仪、纸张、笔、本子、文件夹、订书机、计算器、白板、文具）
家电（冰箱、洗衣机、空调、电视、微波炉、烤箱、洗碗机、吸尘器、风扇、取暖器、净化器、热水器、饮水机、电饭煲、电磁炉、空气炸锅、破壁机）
厨房用品（锅具、刀具、碗盘、筷子、勺子、铲子、砧板、保鲜盒、调料瓶）
食品（零食、饮料、酒水、茶叶、咖啡、食材、调料、粮油、干货、冷冻食品、方便食品、糖果、饼干、坚果）
药品（感冒药、退烧药、消炎药、胃药、过敏药）
医疗健康（创可贴、口罩、消毒液、棉签、体温计、血压计、保健品、维生素、钙片、血糖仪、轮椅、拐杖、护具、药箱）
日用品（纸巾、湿巾、垃圾袋、电池、灯泡、胶带、清洁剂、洗衣液、香皂、毛巾、牙刷牙膏、洗发水、沐浴露）
家具（桌椅、柜子、沙发、床、床垫、书架、鞋柜、床头柜）
家居用品（床品、枕头、被子、窗帘、地毯、收纳箱、衣架、挂钩、置物架、台灯、闹钟、镜子、垃圾桶、晾衣架）
工具（螺丝刀、扳手、钳子、锤子、卷尺、电钻、胶枪、梯子、工具箱、剪刀、美工刀）
汽车用品（行车记录仪、车载充电器、座垫、脚垫、遮阳挡、洗车液、机油、玻璃水、安全锤、灭火器、拖车绳）
运动户外（健身、瑜伽、跳绳、球类、帐篷、睡袋、户外炉具、登山杖、骑行、游泳）
书籍（杂志、教材、绘本）
服装（衣物、鞋、帽子、包、饰品、手表）
宠物用品（猫粮、狗粮、猫砂、宠物玩具、宠物药品）
儿童用品（玩具、童装、尿不湿、奶瓶）
易耗品, 贵重物品

注意：不需要填 device_id。

输出格式示例：
[
  { "name": "U盘", "spec_model": "金士顿 64G", "quantity": 5, "tags": "数码电子", "source": "京东采购", "storage_location": "抽屉A" },
  { "warehouse_name": "工作仓库", "name": "笔记本", "spec_model": "联想E14 16G+500G", "source": "公司配发", "department_path": "技术部", "responsible_person": "李宇阳" }
]

请只输出JSON数组，不要加任何解释文字。`;

    try {
        await navigator.clipboard.writeText(prompt);
        showToast('AI提示语已复制到剪贴板，粘贴给AI即可', 'success');
    } catch (err) {
        const ta = document.createElement('textarea');
        ta.value = prompt;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('AI提示语已复制到剪贴板', 'success');
    }
}

// 插入 JSON 示例（到期日期动态计算）
function insertJsonExample() {
    const d6  = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
    const d29 = new Date(Date.now() + 29 * 86400000).toISOString().slice(0, 10);
    const d200 = new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10);
    document.getElementById('batchPasteText').value = `[
  {
    "warehouse_name": "37",
    "name": "联想ThinkPad X1 Carbon",
    "spec_model": "ThinkPad X1 Carbon Gen 11 / i7-1365U / 16GB / 512GB SSD",
    "serial_number": "SN-THINKPAD-X1C-20260501",
    "source": "公司采购",
    "department_path": "技术部/前端组",
    "responsible_person": "张伟",
    "storage_location": "A区-3号柜-2层",
    "quantity": 1,
    "tags": "电脑,办公设备,笔记本",
    "remark": "主力开发机，配备Type-C扩展坞",
    "expiry_date": "${d6}"
  },
  {
    "warehouse_name": "34",
    "name": "华为AX6路由器",
    "spec_model": "华为路由 AX6 / Wi-Fi 6+ / 7200Mbps",
    "serial_number": "SN-HUAWEI-AX6-20260315",
    "source": "京东自营",
    "department_path": "技术部/运维组",
    "responsible_person": "李娜",
    "storage_location": "B区-1号柜-3层",
    "quantity": 1,
    "tags": "网络设备,路由器",
    "remark": "会议室Wi-Fi覆盖，支持160MHz频宽",
    "expiry_date": "${d29}"
  },
  {
    "warehouse_name": "工作",
    "name": "佳能激光打印机",
    "spec_model": "Canon LBP2900+ / A4黑白激光 / 14ppm",
    "serial_number": "SN-CANON-LBP2900-20260110",
    "source": "供应商惠通科技",
    "department_path": "行政部",
    "responsible_person": "王芳",
    "storage_location": "C区-2号柜-1层",
    "quantity": 1,
    "tags": "办公设备,打印机",
    "remark": "行政部专用，附带2个备用硒鼓",
    "expiry_date": "${d200}"
  }
]`;
}

// 批量粘贴导入
async function startBatchImport() {
    const text = document.getElementById('batchPasteText').value.trim();
    if (!text) { showToast('请粘贴设备数据', 'warning'); return; }

    let data;
    try {
        data = JSON.parse(text);
        if (!Array.isArray(data)) throw new Error('数据必须是 JSON 数组');
    } catch (e) {
        showToast('JSON 格式错误: ' + e.message + '\n\n请检查括号和引号是否匹配。', 'error');
        return;
    }

    const resultEl = document.getElementById('importBatchResult');
    resultEl.style.display = 'block';
    resultEl.innerHTML = '<div style="color:var(--text-muted);font-size:var(--text-sm);">导入中...</div>';

    try {
        const res = await fetch(API_BASE + '/devices/import-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data, warehouseName: (currentWarehouse && currentWarehouse.id !== '__unassigned__') ? currentWarehouse.name : '' }),
        });
        const result = await res.json();
        if (result.errors && result.errors.length) {
            resultEl.innerHTML = `<div style="color:var(--danger);font-size:var(--text-sm);">成功导入 ${result.success || 0} 条，${result.errors.length} 条失败：<br>${result.errors.map(e => escapeHtml(String(e))).join('<br>')}</div>`;
        } else {
            resultEl.innerHTML = `<div style="color:var(--success);font-size:var(--text-sm);">成功导入 ${result.success || data.length} 条设备！</div>`;
        }
        if (result.success > 0) { loadDevices(); loadWarehouses(); }
    } catch (e) {
        resultEl.innerHTML = `<div style="color:var(--danger);font-size:var(--text-sm);">导入失败: ${escapeHtml(e.message)}</div>`;
    }
}

// ===== 排序 =====
const SORT_FIELDS = [
    { key: 'name', label: '设备名称' },
    { key: 'spec_model', label: '规格型号' },
    { key: 'warehouse_name', label: '所属仓库' },
    { key: 'checkin_time', label: '入库时间' },
    { key: 'expiry_date', label: '到期日期' },
];
let sortField = localStorage.getItem('dms_sort_field') || 'checkin_time';
let sortAsc = (() => {
    const saved = localStorage.getItem('dms_sort_asc');
    return saved === null ? false : saved === 'true';
})();

function applySort() {
    const va = (a,b) => {
        let va = a[sortField] || '', vb = b[sortField] || '';
        if (sortField === 'checkin_time' || sortField === 'expiry_date') {
            va = va || '0000-00-00';
            vb = vb || '0000-00-00';
        }
        if (typeof va === 'string') va = va.toLowerCase();
        if (typeof vb === 'string') vb = vb.toLowerCase();
        if (va < vb) return sortAsc ? -1 : 1;
        if (va > vb) return sortAsc ? 1 : -1;
        return 0;
    };
    allDevices.sort(va);
    localStorage.setItem('dms_sort_field', sortField);
    localStorage.setItem('dms_sort_asc', sortAsc);
}

function toggleSort(e) {
    e.stopPropagation();
    const menu = document.getElementById('sortDropdown');
    const btn = e.currentTarget;
    if (!menu || !btn) return;
    const isOpen = menu.style.display === 'block';
    if (isOpen) { menu.style.display = 'none'; return; }

    // 定位到按钮下方（以 header-row 为基准）
    const container = btn.closest('.header-row');
    const containerRect = container ? container.getBoundingClientRect() : null;
    const btnRect = btn.getBoundingClientRect();
    if (containerRect) {
        menu.style.left = (btnRect.left - containerRect.left) + 'px';
        menu.style.top = (btnRect.bottom - containerRect.top + 4) + 'px';
    } else {
        menu.style.left = btnRect.left + 'px';
        menu.style.top = (btnRect.bottom + 4) + 'px';
    }

    const currentLabel = SORT_FIELDS.find(f => f.key === sortField)?.label || '';
    menu.innerHTML = SORT_FIELDS.map(f => {
        const active = f.key === sortField;
        const arrow = active ? (sortAsc ? ' ↑' : ' ↓') : '';
        return `<div class="sort-dropdown-item${active ? ' active' : ''}" data-field="${f.key}" onclick="selectSortField('${f.key}')">
            <span>${f.label}</span>
            <span class="sort-arrow">${arrow}</span>
        </div>`;
    }).join('');
    menu.style.display = 'block';
}

function selectSortField(field) {
    if (field === sortField) {
        sortAsc = !sortAsc;
    } else {
        sortField = field;
        sortAsc = sortField === 'checkin_time' || sortField === 'expiry_date' ? false : true;
    }
    applySort();
    renderDevices();
    document.getElementById('sortDropdown').style.display = 'none';
    updateSortBtnIcon();
}

function updateSortBtnIcon() {
    const btn = document.getElementById('sortBtn');
    if (!btn) return;
    const icon = sortAsc ? 'bi-sort-up' : 'bi-sort-down';
    btn.innerHTML = `<i class="bi ${icon}"></i> 排序`;
}

// 点击外部关闭排序菜单
document.addEventListener('click', (e) => {
    const menu = document.getElementById('sortDropdown');
    if (menu && menu.style.display === 'block') {
        const sortBtn = document.getElementById('sortBtn');
        const filterBtn = document.getElementById('searchFilterBtn');
        const clickedBtn = sortBtn && sortBtn.contains(e.target);
        const clickedFilter = filterBtn && filterBtn.contains(e.target);
        if (!menu.contains(e.target) && !clickedBtn && !clickedFilter) {
            menu.style.display = 'none';
        }
    }
});

// ===== 公告 =====

// 删除公告
async function deleteAnnouncement(id) {
    if (!confirm('确定删除此公告？')) return;
    try {
        const r = await fetch(`${API_BASE}/announcements/${id}`, { method: 'DELETE' });
        const data = await r.json();
        if (data.success) {
            showToast('公告已删除', 'success');
            await loadAnnouncements();
            // 如果下拉开着，刷新内容
            const dropdown = document.getElementById('annDropdown');
            if (dropdown.style.display === 'block') renderDropdown();
        } else {
            showToast(data.error || '删除失败', 'error');
        }
    } catch(e) { showToast('删除失败', 'error'); }
}

// 显示新增公告表单（在 dropdown 顶部）
function showAddAnnouncement() {
    const dropdown = document.getElementById('annDropdown');
    if (dropdown.style.display !== 'block') {
        toggleAnnDropdown();
    }
    const inner = document.getElementById('annDropdownInner');
    const addForm = document.createElement('div');
    addForm.className = 'announcement-add-form';
    addForm.innerHTML = `
        <textarea class="announcement-edit-input" id="newAnnouncementInput" rows="3" placeholder="输入公告内容..."></textarea>
        <div class="announcement-edit-actions">
            <button class="btn-sm btn-sm-primary" onclick="event.stopPropagation();saveNewAnnouncement()"><i class="bi bi-plus-lg"></i> 发布</button>
            <button class="btn-sm" onclick="this.closest('.announcement-add-form').remove()"><i class="bi bi-x-lg"></i> 取消</button>
        </div>
    `;
    inner.prepend(addForm);
    document.getElementById('newAnnouncementInput').focus();
}

// 保存新增公告
async function saveNewAnnouncement() {
    const input = document.getElementById('newAnnouncementInput');
    if (!input) return;
    const content = input.value.trim();
    if (!content) { showToast('公告内容不能为空', 'error'); return; }
    try {
        const r = await fetch(`${API_BASE}/announcements`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        const data = await r.json();
        if (data.success) {
            showToast('公告已发布', 'success');
            await loadAnnouncements();
            // 关闭新增表单，刷新下拉
            renderDropdown();
        } else {
            showToast(data.error || '发布失败', 'error');
        }
    } catch(e) { showToast('发布失败', 'error'); }
}

// ===== 图片全屏 =====
function showImageFullscreen(src) {
    const existing = document.querySelector('.image-fullscreen-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.className = 'image-fullscreen-overlay';
    overlay.innerHTML = `<div class="image-fullscreen-close" onclick="this.parentElement.remove()"><i class="bi bi-x-lg"></i></div><img src="${src}" class="image-fullscreen-img" />`;
    overlay.onclick = () => overlay.remove();
    overlay.querySelector('img').onclick = e => e.stopPropagation();
    document.body.appendChild(overlay);
}



// ===== 键盘事件 =====
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeAllModals();
});

// ===== 搜索 =====
document.addEventListener('DOMContentLoaded', async function() {
    // 搜索实时过滤
    document.getElementById('searchInput').addEventListener('input', function() {
        renderDevices();
    });

    // 搜索回车
    document.getElementById('searchInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') renderDevices();
    });

    // 按钮事件绑定
    document.getElementById('addDeviceBtn').addEventListener('click', () => openDeviceModal(null));
    document.getElementById('exportBtn').addEventListener('click', exportDevices);
    updateSortBtnIcon();

    // 点击模态框外部关闭
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('modal-overlay')) closeAllModals();
    });

    // 加载数据
    await loadWarehouses();
    await loadDevices();
    await loadAnnouncements();

    // Step3+Step4: 初始根据窗口宽度决定视图
    // < 768  → 移动端视图（卡片 + mobile class）
    // < 1200 → 卡片视图
    // ≥ 1200 → 表格视图
    applyViewByWidth(true);

    // 初始统计高亮（默认 'all'）
    updateStatHighlight();
});

// ===== 窗口 resize：4步渐进式压缩 =====
// Step1: CSS 自动处理（table-layout:fixed + min-width 保护 ID/数量/日期/备注）
// Step2: ≤1500px → 标签列只显示1个 + 宽度缩减（JS + CSS@media）
// Step3: ≤1366px → 自动切换卡片视图，恢复宽度后切回表格
// Step4: ≤768px  → 移动端视图（CSS @media 768px 自动适配）
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        applyViewByWidth(false);
        // 表格视图下宽度变化可能触发标签数变化，重新渲染
        if (viewMode === 'table') renderDevices();
    }, 200);
});

function applyViewByWidth(isInit) {
    const w = window.innerWidth;
    if (w < 768) {
        // Step4: 移动端 → 卡片 + body 标记
        document.body.classList.add('is-mobile');
        if (viewMode !== 'list') {
            autoSwitchedToCard = true;
            switchView('list', true);
        }
    } else if (w < 1366) {
        // Step3: 卡片视图
        document.body.classList.remove('is-mobile');
        if (viewMode === 'table') {
            autoSwitchedToCard = true;
            switchView('list', true);
        }
    } else {
        // ≥1366: 表格视图（宽度恢复后始终切回）
        document.body.classList.remove('is-mobile');
        if (viewMode === 'list') {
            autoSwitchedToCard = false;
            switchView('table', true);
        }
    }
}

// ===== 仓库列表"显示更多" =====
function toggleWarehouseShowMore() {
    warehouseShowAll = !warehouseShowAll;
    renderWarehouseList();
}

// ===== 批量补全设备ID =====
async function backfillDeviceCodes() {
    if (!confirm('将为所有缺少设备ID码的旧设备自动生成6位码，是否继续？')) return;

    const btn = document.getElementById('btnBackfillCodes');
    if (!btn) return;
    btn.disabled = true;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;vertical-align:middle;margin-right:4px;"></span> 补全中...';

    try {
        const res = await fetch(`${API_BASE}/devices/backfill-codes`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '补全失败');
        alert(data.message);
        loadDevices();
    } catch (e) {
        alert('补全设备ID失败: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

// ===== 清空当前仓库 =====
async function clearCurrentWarehouse() {
    const isAll = !currentWarehouse || currentWarehouse.id === '__unassigned__';
    const label = isAll ? '全部设备' : `仓库【${currentWarehouse.name}】`;

    if (!confirm(`确定要清空 ${label} 下的所有设备吗？\n\n此操作不可撤销！`)) return;
    if (!confirm('再次确认：清空后数据不可恢复，确定继续？')) return;

    try {
        const res = await fetch(`${API_BASE}/devices/clear-warehouse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ warehouseName: isAll ? null : currentWarehouse.name })
        });
        const data = await res.json();
        if (data.success) {
            alert(`已清空 ${data.deleted} 台设备`);
            await loadDevices();
            await loadTagStats();
        } else {
            alert('清空失败: ' + (data.error || '未知错误'));
        }
    } catch (e) {
        alert('清空失败: ' + e.message);
    }
}

// ===== 添加设备下拉菜单 =====
function toggleAddDeviceMenu(e) {
    e.stopPropagation();
    const menu = document.getElementById('addDeviceDropdown');
    if (!menu) return;
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
}

// 点击外部关闭添加设备菜单
document.addEventListener('click', (e) => {
    const menu = document.getElementById('addDeviceDropdown');
    if (menu && menu.style.display === 'block') {
        const group = document.querySelector('.toolbar-btn-group');
        if (!group || !group.contains(e.target)) {
            menu.style.display = 'none';
        }
    }
});

// ===== 侧边栏展开/收起（移动端） =====
function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.toggle('show');
    if (overlay) overlay.classList.toggle('show');
}

// ===== 显示补全按钮 =====
function updateBackfillBtnVisibility() {
    const btn = document.getElementById('btnBackfillCodes');
    if (!btn) return;
    // 只有存在缺失 device_id 的设备时才显示补全按钮
    const nullCount = allDevices.filter(d => !d.device_id && !d.deviceId).length;
    btn.style.display = nullCount > 0 ? '' : 'none';
}
