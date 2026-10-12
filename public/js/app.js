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
let currentTab = 'in'; // 'all' | 'in' | 'out' | 'expiring'
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
    { key: 'specModel',   label: '规格型号', dataCol: 'spec-model' },
    { key: 'warehouse',   label: '所属仓库', dataCol: 'warehouse' },
    { key: 'serialNumber',label: '序列号',   dataCol: 'serial-number', defaultVisible: false },
    { key: 'source',      label: '来源',     dataCol: 'source' },
    { key: 'quantity',    label: '数量',     dataCol: 'quantity' },
    { key: 'tags',        label: '标签',     dataCol: 'tags' },
    { key: 'department',  label: '所属路径', dataCol: 'department', defaultVisible: false },
    { key: 'responsible', label: '负责人',   dataCol: 'responsible', defaultVisible: false },
    { key: 'location',    label: '存放位置', dataCol: 'location' },
    { key: 'status',      label: '状态',     dataCol: 'status',      defaultVisible: false },
    { key: 'expiry',      label: '到期日期', dataCol: 'expiry' },
    { key: 'checkin',     label: '入库时间', dataCol: 'checkin',      defaultVisible: false },
    { key: 'remark',      label: '备注',     dataCol: 'remark' },
    { key: 'actions',     label: '操作',     dataCol: 'actions' },
];

const COLUMN_VERSION = 7;
let columnVisibility = (() => {
    try {
        const savedVersion = store.get('dms_column_version');
        const saved = store.get('dms_column_visibility');
        if (saved && Number(savedVersion) === COLUMN_VERSION) {
            const parsed = JSON.parse(saved);
            COLUMN_DEFS.forEach(c => { if (!(c.key in parsed)) parsed[c.key] = c.defaultVisible !== false; });
            return parsed;
        }
    } catch (e) {}
    const defaults = {};
    COLUMN_DEFS.forEach(c => defaults[c.key] = c.defaultVisible !== false);
    store.set('dms_column_version', COLUMN_VERSION);
    store.set('dms_column_visibility', JSON.stringify(defaults)); // 版本重置时立即落盘，避免旧配置在第二个会话复活
    return defaults;
})();

// 列排序（不含 batch-check 和 actions）
const ORDERABLE_KEYS = COLUMN_DEFS.filter(c => c.key !== 'actions' && c.key !== 'batch-check').map(c => c.key);
let columnOrder = (() => {
    try {
        const savedVersion = store.get('dms_column_order_version');
        const saved = store.get('dms_column_order');
        // 版本匹配时才使用缓存的列顺序
        if (saved && savedVersion && Number(savedVersion) === COLUMN_VERSION) {
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
            if (valid.length > 0) {
                store.set('dms_column_order_version', COLUMN_VERSION);
                return valid;
            }
        }
    } catch (e) {}
    store.set('dms_column_order_version', COLUMN_VERSION);
    store.set('dms_column_order', JSON.stringify([...ORDERABLE_KEYS])); // 同上：立即落盘默认顺序
    return [...ORDERABLE_KEYS];
})();

function saveColumnOrder() {
    store.set('dms_column_order', JSON.stringify(columnOrder));
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
    // 表格级 class + CSS 规则控制显隐（O(列数)），不再逐格遍历 td/th（O(单元格数)）
    const table = document.getElementById('deviceTable');
    if (table) {
        table.classList.remove(...COLUMN_DEFS.map(d => 'hide-col-' + d.dataCol));
        COLUMN_DEFS.forEach(d => {
            if (!visibleCols.has(d.dataCol)) table.classList.add('hide-col-' + d.dataCol);
        });
    }
    store.set('dms_column_visibility', JSON.stringify(columnVisibility));
}

// 列显隐 CSS 规则只需生成一次：#deviceTable.hide-col-x [data-col="x"]{display:none}
(function initColumnVisibilityStyles() {
    const styleEl = document.createElement('style');
    styleEl.textContent = COLUMN_DEFS.map(d =>
        `#deviceTable.hide-col-${d.dataCol} th[data-col="${d.dataCol}"], #deviceTable.hide-col-${d.dataCol} td[data-col="${d.dataCol}"]{display:none!important;}`
    ).join('\n');
    document.head.appendChild(styleEl);
})();

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
    if (!tbody || tbody._dragSelectInited) return; // 防止重渲染后重复挂载监听器（重复挂载会导致点选两次互相抵消）
    tbody._dragSelectInited = true;

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
    // 复用 renderDevices 缓存的过滤结果（切换全选只改选中状态，列表本身不变）
    const allIds = getLastFilteredDevices().map(d => d.id);
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
    const devices = getLastFilteredDevices();
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
    const devices = getLastFilteredDevices();
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
    if (!confirm(`确定要删除选中的 ${selectedDeviceIds.size} 个设备吗？这些设备的附件与图片将一并删除，此操作不可撤销。`)) return;
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
            // 局部更新：从内存移除选中设备（标签统计/临期列表已含在局部刷新内）
            if (!applyDeviceRemove(ids)) {
                await Promise.allSettled([loadDevices(), loadWarehouses(), loadTagStats(), loadExpiringDevices()]);
            }
        } else {
            showToast('批量删除失败: ' + (result.error || '未知错误'), 'error');
        }
    } catch (e) {
        showToast('批量删除失败: ' + e.message, 'error');
    }
}

// ===== 工具函数（转义/格式化已抽至 common.js） =====

// 临期统一口径：30 天内到期（含已过期），tab/统计/侧边栏列表共用
const EXPIRING_WINDOW_DAYS = 30;

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

// ===== 富文本备注模块（编解码/工具栏/上传逻辑已抽至 common.js） =====

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
        const result = await res.json().catch(() => null);
        // 局部更新：仅刷新该设备；失败时兜底全量拉取
        if (!(result && result.data && applyDeviceUpsert(result.data))) await loadDevices();
        _remarkOriginalContent = content;
        updateRemarkPreviewStatus();
        closeRemarkModal();
        showToast('备注已保存', 'success');
    } catch (e) {
        console.error('保存备注失败:', e);
        showToast('保存失败: ' + e.message, 'error');
    }
}

// ----- 编辑命令/表格插入/色板/字号均已抽至 common.js -----

// ----- 图片插入/上传/粘贴/右键尺寸菜单均已抽至 common.js（RT 配置驱动） -----

// ===== 图片浏览器（首页独有） =====
function openImageBrowser() {
    _selectedImages = new Set();
    loadExistingImages(RT._uploadDeviceId);
    document.getElementById('imageBrowserModal').style.display = 'flex';
}

function closeImageBrowser() {
    document.getElementById('imageBrowserModal').style.display = 'none';
}

// ===== 附件管理（编辑设备弹窗中使用） =====
let _selectedImages = new Set();
let _existingImages = [];

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
                <div class="modal-attachment-icon ${iconClass}">${escapeHtml(abbr)}</div>
                <div class="modal-attachment-info"><div class="modal-attachment-name"><a href="${escapeAttr(a.url)}" target="_blank" title="${escapeAttr(a.displayName||a.filename)}">${escapeHtml(a.displayName||a.filename)}</a></div><div class="modal-attachment-meta">${formatFileSize(a.size)}</div></div>
                <div class="modal-attachment-actions"><button onclick="deleteAttachmentFile(this,'${escapeAttr(deviceIdCode)}','${encodeURIComponent(a.filename)}')" class="btn-attachment-delete"><i class="bi bi-trash3"></i> 删除</button></div>
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
    const editor = document.getElementById(RT._targetEditorId || 'remarkContent');
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
            return `<div class="image-grid-item ${isUsed ? 'img-used' : ''}" data-filename="${escapeAttr(img.filename)}"
                 title="${isUsed ? '已在备注中使用' : '未使用'}" onclick="toggleImageSelection('${escapeOnClick(img.filename)}')">
                <img src="${escapeAttr(img.url)}" alt="${escapeAttr(img.filename)}" loading="lazy"
                     onerror="this.parentElement.style.display='none'">
                <button class="delete-btn" title="删除此图片"
                        onclick="event.stopPropagation();deleteSingleImage('${escapeOnClick(img.filename)}')">
                    <i class="bi bi-x"></i>
                </button>
                <div class="select-check"><i class="bi bi-check-lg"></i></div>
                <span class="usage-badge">${isUsed ? '已用' : '未用'}</span>
                <div class="file-info">
                    <span class="file-name">${escapeHtml(truncateFilename(img.filename, 18))}</span>
                    <span class="file-size">${escapeHtml(formatFileSize(img.size))}</span>
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
    const editor = document.getElementById(RT._targetEditorId || 'remarkContent');
    if (!editor) return;
    _selectedImages.forEach(filename => {
        const img = _existingImages.find(i => i.filename === filename);
        if (img) {
            const imgTag = `<img src="${escapeAttr(img.url)}" class="img-size-large" style="max-width:100%;height:auto;margin:8px 0;border-radius:4px;border:1px solid var(--border);" />`;
            insertHTMLAtCursor(editor, imgTag);
        }
    });
    updateRemarkPreviewStatus();
    closeImageBrowser();
}

async function deleteSingleImage(filename) {
    if (!confirm(`确定要删除图片 "${filename}" 吗？此操作不可撤销。`)) return;
    try {
        const res = await fetch(`${API_BASE}/images/${RT._uploadDeviceId}/${encodeURIComponent(filename)}`, { method: 'DELETE' });
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
            const res = await fetch(`${API_BASE}/images/${RT._uploadDeviceId}/${encodeURIComponent(filename)}`, { method: 'DELETE' });
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

// ----- 初始化备注编辑器事件 -----
// 首页注入公共富文本模块配置（common.js 的 RT 钩子）
RT.getDeviceId = () => RT._uploadDeviceId || document.getElementById('remarkPreviewDeviceIdCode')?.value || '0';
RT.getEditor = () => document.getElementById(RT._targetEditorId || 'remarkContent');
RT.onImageInserted = updateRemarkPreviewStatus;

(function bindRemarkEditorEvents() {
    const rc = document.getElementById('remarkContent');
    if (!rc) return;
    rc.addEventListener('input', updateRemarkPreviewStatus);
    // 双击全屏/右键尺寸菜单/粘贴上传均由 common.js 的 setupImagePaste / setupImageContextMenu 提供
    setupImageContextMenu(rc);
    setupImagePaste(rc, () => document.getElementById('remarkPreviewDeviceIdCode').value);
})();

// showToast 已抽至 common.js

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

let _loadDevicesSeq = 0; // 请求序号：快速切换仓库时丢弃过期响应
async function loadDevices() {
    const seq = ++_loadDevicesSeq;
    // 与 loadWarehouses 口径一致：3 次重试，间隔 500ms
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            let url = API_BASE + '/devices';
            // "未指定"仓库：加载全部设备，后续客户端过滤
            if (currentWarehouse && currentWarehouse.id !== '__unassigned__') {
                url += '?warehouseName=' + encodeURIComponent(currentWarehouse.name);
            }
            const r = await fetch(url);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            if (seq !== _loadDevicesSeq) return; // 已有更新的请求，丢弃本次结果
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
            return;
        } catch(e) {
            if (seq !== _loadDevicesSeq) return; // 已有更新的请求，放弃重试
            if (attempt < 2) {
                console.warn(`[加载设备] 第 ${attempt + 1} 次失败，重试中:`, e.message);
                await new Promise(res => setTimeout(res, 500));
            } else {
                console.error('加载设备失败:', e);
                allDevices = [];
                renderDevices();
                updateStats();
                loadExpiringDevices();
                loadTagStats();
                showToast('设备加载失败，请检查网络后重试', 'error');
            }
        }
    }
}

// ===== 局部更新（性能优化）：写操作后只刷新受影响设备，不再全量拉取 =====
function refreshAllViews() {
    applySort();
    renderDevices();
    updateStats();
    loadExpiringDevices();
    loadTagStats();
}

// 用服务端返回的完整记录更新内存并重渲染；返回 false 时调用方应兜底全量刷新
function applyDeviceUpsert(device) {
    if (!device || !device.id) return false;
    const idx = allDevices.findIndex(d => d.id == device.id);
    if (idx >= 0) {
        allDevices[idx] = device;
    } else {
        // 新增设备：仅当当前视图能看到它（全部/未指定/同仓库）才加入内存
        const w = currentWarehouse;
        if (w && w.id !== '__unassigned__' && w.name !== device.warehouse_name) return false;
        allDevices.push(device);
    }
    // 与 loadDevices 同口径：仅全部/未指定视图重算各仓库计数
    if (!currentWarehouse || currentWarehouse.id === '__unassigned__') updateWarehouseCounts();
    refreshAllViews();
    return true;
}

// 从内存移除设备并重渲染；返回 false（未命中）时调用方应兜底全量刷新
function applyDeviceRemove(ids) {
    const idSet = new Set((ids || []).map(String));
    const before = allDevices.length;
    allDevices = allDevices.filter(d => !idSet.has(String(d.id)));
    if (allDevices.length === before && idSet.size > 0) return false;
    if (!currentWarehouse || currentWarehouse.id === '__unassigned__') updateWarehouseCounts();
    refreshAllViews();
    return true;
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
// 临期列表改为基于内存 allDevices 前端计算：自动跟随当前仓库筛选，与服务端 7 天口径解耦
function loadExpiringDevices() {
    const list = allDevices
        .filter(d => { const r = getExpiryRemainingDays(d.expiry_date); return r !== null && r <= EXPIRING_WINDOW_DAYS; })
        .map(d => Object.assign({}, d, { remaining_days: getExpiryRemainingDays(d.expiry_date) }))
        .sort((a, b) => a.remaining_days - b.remaining_days);
    expiringDevicesAll = list;
    renderExpiringList(expiringShowAll ? expiringDevicesAll : expiringDevicesAll.slice(0, 5));
}

// 标签统计直接基于内存 allDevices 计算（loadDevices 已按仓库拉取并过滤），避免每次刷新重复全量请求
function loadTagStats() {
    const map = {};
    allDevices.forEach(d => {
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
        console.error('加载公告失败:', e);
        showToast('公告加载失败，请稍后刷新重试', 'error');
    }
}

function updateAnnBar() {
    const mobileBellBadge = document.getElementById('mobileBellBadge');
    const desktopBellBadge = document.getElementById('desktopBellBadge');
    if (announcementsData.length > 0) {
        if (mobileBellBadge) {
            mobileBellBadge.textContent = announcementsData.length;
            mobileBellBadge.classList.add('has-badge');
        }
        if (desktopBellBadge) {
            desktopBellBadge.textContent = announcementsData.length;
            desktopBellBadge.classList.add('has-badge');
        }
    } else {
        if (mobileBellBadge) {
            mobileBellBadge.textContent = '0';
            mobileBellBadge.classList.remove('has-badge');
        }
        if (desktopBellBadge) {
            desktopBellBadge.textContent = '0';
            desktopBellBadge.classList.remove('has-badge');
        }
    }
}

function renderDropdown() {
    const inner = document.getElementById('annDropdownInner');
    if (announcementsData.length === 0) {
        inner.innerHTML = '<div class="ann-dropdown-empty">暂无公告</div>';
        return;
    }
    announcementsData.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    inner.innerHTML = announcementsData.map((a, i) => `
        <div class="ann-dropdown-item${i === 0 ? ' selected' : ''}" data-id="${a.id}" onclick="selectAnnouncementItem(this)">
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

// 选中公告条目，切换黑点
function selectAnnouncementItem(el) {
    const items = document.querySelectorAll('.ann-dropdown-item');
    items.forEach(item => item.classList.remove('selected'));
    el.classList.add('selected');
}

function toggleAnnDropdown() {
    const dropdown = document.getElementById('annDropdown');
    if (!dropdown) return;
    if (dropdown.style.display === 'block') { closeAnnDropdown(); return; }
    renderDropdown();
    dropdown.classList.remove('closing');
    dropdown.style.display = 'block';

    // 桌面端遮罩
    const overlay = document.getElementById('annOverlay');
    if (overlay) overlay.classList.add('show');

    // 移动端：标题栏面板状态
    const topBar = document.getElementById('mobileTopBar');
    const menuToggle = document.getElementById('menuToggle');
    if (topBar) topBar.classList.add('ann-open');
    if (menuToggle) menuToggle.classList.add('active');

    // 移动端：隐藏主 FAB
    const fabContainer = document.getElementById('fabContainer');
    if (fabContainer) fabContainer.classList.add('hide');
}

function closeAnnDropdown() {
    const dropdown = document.getElementById('annDropdown');
    if (!dropdown) return;

    // 桌面端遮罩
    const overlay = document.getElementById('annOverlay');
    if (overlay) overlay.classList.remove('show');

    // 移动端：恢复标题栏状态
    const topBar = document.getElementById('mobileTopBar');
    const menuToggle = document.getElementById('menuToggle');
    if (topBar) topBar.classList.remove('ann-open');
    if (menuToggle) menuToggle.classList.remove('active');

    // 移动端：恢复主 FAB
    const fabContainer = document.getElementById('fabContainer');
    if (fabContainer) fabContainer.classList.remove('hide');

    // 关闭动画
    if (dropdown.style.display === 'block') {
        dropdown.classList.add('closing');
        dropdown.addEventListener('animationend', function handler() {
            dropdown.style.display = 'none';
            dropdown.classList.remove('closing');
            dropdown.removeEventListener('animationend', handler);
        }, { once: true });
    }
}

// 移动端 menuToggle：下拉展开时关闭下拉，否则打开侧边栏
function handleMobileMenuToggle(e) {
    const dropdown = document.getElementById('annDropdown');
    if (dropdown && dropdown.style.display === 'block') {
        e.stopPropagation();
        closeAnnDropdown();
    } else {
        toggleSidebar();
    }
}

// 点击外部关闭（移动端 topBar 区域不触发关闭，防止误触）
document.addEventListener('click', e => {
    const dropdown = document.getElementById('annDropdown');
    if (!dropdown || dropdown.style.display !== 'block') return;
    const mobileBell = document.getElementById('mobileBellBtn');
    const desktopBell = document.getElementById('desktopBellBtn');
    const mobileTopBar = document.getElementById('mobileTopBar');
    if (!dropdown.contains(e.target) && 
        !(mobileBell && mobileBell.contains(e.target)) &&
        !(desktopBell && desktopBell.contains(e.target)) &&
        !(mobileTopBar && mobileTopBar.contains(e.target))) {
        closeAnnDropdown();
    }
});

// ===== 渲染 =====
function updateStats() {
    const total = allDevices.length;
    const inStock = allDevices.filter(d => d.location_status !== 'checked_out').length;
    const checkedOut = allDevices.filter(d => d.location_status === 'checked_out').length;
    const expiring = allDevices.filter(d => { const r = getExpiryRemainingDays(d.expiry_date); return r !== null && r <= EXPIRING_WINDOW_DAYS; }).length;
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
        devices = devices.filter(d => { const r = getExpiryRemainingDays(d.expiry_date); return r !== null && r <= EXPIRING_WINDOW_DAYS; });
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

// 渲染周期缓存：renderDevices 算一次，批量 UI 函数直接复用，避免同一周期重复过滤 3 次
let _lastFilteredDevices = [];
function getLastFilteredDevices() { return _lastFilteredDevices; }

function renderDevices() {
    const devices = getFilteredDevices();
    _lastFilteredDevices = devices;
    document.getElementById('deviceCount').textContent = devices.length;
    const tabLabels = { all: '全部设备', in: '在库设备', out: '已出库', expiring: '临期设备' };
    document.getElementById('deviceTabLabel').textContent = tabLabels[currentTab] || '设备列表';
    // 仓库名（第二位）
    const whEl = document.getElementById('deviceWarehouseLabel');
    if (currentWarehouse) {
        whEl.textContent = '/ ' + (currentWarehouse.id === '__unassigned__' ? '未分配' : currentWarehouse.name);
    } else {
        whEl.textContent = '/ 全部仓库';
    }
    whEl.style.display = '';

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
            name:         `<td data-col="name" data-label="名称" class="device-name-cell"${d.name ? ` title="${escapeAttr(d.name)}"` : ''}><strong>${escapeHtml(d.name)}</strong></td>`,
            warehouse:    `<td data-col="warehouse" data-label="所属仓库">${d.warehouse_name ? escapeHtml(d.warehouse_name) : '<span style="color:var(--danger);font-weight:600;">未指定</span>'}</td>`,
            serialNumber: `<td data-col="serial-number" data-label="序列号"${d.serial_number ? ` title="${escapeAttr(d.serial_number)}"` : ''}>${d.serial_number ? escapeHtml(d.serial_number) : '<span class="text-muted">-</span>'}</td>`,
            specModel:    `<td data-col="spec-model" data-label="规格型号"${d.spec_model ? ` title="${escapeAttr(d.spec_model)}"` : ''}>${d.spec_model ? escapeHtml(d.spec_model) : '<span class="text-muted">-</span>'}</td>`,
            source:       `<td data-col="source" data-label="来源"${d.source ? ` title="${escapeAttr(d.source)}"` : ''}>${d.source ? escapeHtml(d.source) : '<span class="text-muted">-</span>'}</td>`,
            quantity:     `<td data-col="quantity" data-label="数量">${Number(d.quantity) || 1}</td>`,
            tags:         `<td data-col="tags" data-label="标签">${renderTagBadges(d, window.innerWidth < 1500 ? 1 : 2)}</td>`,
            department:   `<td data-col="department" data-label="部门">${d.department_path ? escapeHtml(d.department_path) : '<span class="text-muted">-</span>'}</td>`,
            responsible:  `<td data-col="responsible" data-label="负责人">${d.responsible_person ? escapeHtml(d.responsible_person) : '<span class="text-muted">-</span>'}</td>`,
            location:     `<td data-col="location" data-label="存放位置"${d.storage_location ? ` title="${escapeAttr(d.storage_location)}"` : ''}>${d.storage_location ? escapeHtml(d.storage_location) : '<span class="text-muted">-</span>'}</td>`,
            status:       `<td data-col="status" data-label="状态"><span class="status-badge ${statusClass[d.status] || ''}">${escapeHtml(d.status || '-')}</span></td>`,
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
        const isChecked = selectedDeviceIds.has(d.id);
        // 标签：最多显示2个，多余收起（点击展开隐藏标签）
        const visibleTags = tags.slice(0, 2);
        const hiddenTags = tags.slice(2);
        const tagsHtml = visibleTags.map(t => `<span class="device-card-tag">${escapeHtml(t)}</span>`).join('')
            + (hiddenTags.length > 0
                ? `<span class="tag-more device-card-tag-more" onclick="event.stopPropagation();this.classList.toggle('expanded')">+${hiddenTags.length}<span class="tag-more-tip">${hiddenTags.map(t => `<span class="tag-item-inline">${escapeHtml(t)}</span>`).join('')}</span></span>`
                : '');
        // 设备ID（取后6位）
        const deviceIdHtml = d.device_id ? `<span class="device-card-id">${escapeHtml(d.device_id.slice(-6))}</span>` : '';
        // 规格型号（行内）
        const specInlineHtml = d.spec_model ? `<span class="device-card-spec-inline">${escapeHtml(d.spec_model)}</span>` : '';
        // 到期日期
        const expiryHtml = d.expiry_date ? `<span class="device-card-expiry-inline">${formatExpiryBadge(d.expiry_date)}</span>` : '';
        // 位置：显示存放位置 storage_location
        // （在库/已出库状态已由卡片顶部 status-badge 体现，此处不再切换为去向 destination；
        //   存放位置为空时整行不渲染，避免把状态文案混入位置信息）
        const locationHtml = d.storage_location
            ? `<div class="device-card-location"><i class="bi bi-geo-alt"></i> ${escapeHtml(d.storage_location)}</div>`
            : '';
        // 备注（点击打开弹窗，不跳转详情）
        const remarkHtml = d.remark
            ? `<div class="device-card-remark" onclick="event.stopPropagation();showRemarkPreview(${d.id},'${escapeOnClick(d.name)}')"><i class="bi bi-chat-left-text"></i> ${escapeHtml(d.remark)}</div>`
            : '';
        // 批量模式：悬浮 Pill 标签 + 禁止点击跳转
        const pillHtml = batchSelectMode
            ? `<div class="batch-card-pill${isChecked ? ' selected' : ''}" onclick="event.stopPropagation();toggleDeviceSelect(${d.id});const c=this.closest('.device-card');c.classList.toggle('batch-selected');this.classList.toggle('selected')" data-device-id="${d.id}">${isChecked ? '已选' : '选择'}</div>`
            : '';
        const cardClass = `device-card${batchSelectMode ? ' batch-mode' : ''}${batchSelectMode && isChecked ? ' batch-selected' : ''}`;
        const cardClick = batchSelectMode
            ? `onclick="toggleDeviceSelect(${d.id});const pill=this.querySelector('.batch-card-pill');if(pill){pill.classList.toggle('selected');pill.textContent=pill.classList.contains('selected')?'已选':'选择'};this.classList.toggle('batch-selected')"`
            : `onclick="goDeviceDetail('${escapeOnClick(d.device_id || d.id)}')"`;
        const cardCursor = 'cursor:pointer;';
        return `<div class="${cardClass}" data-device-id="${d.id}" ${cardClick} style="${cardCursor}">
            ${pillHtml}
            <div class="device-card-top-row">
                ${deviceIdHtml}
                ${tagsHtml ? `<div class="device-card-tags">${tagsHtml}</div>` : ''}
                ${expiryHtml}
                <span class="status-badge ${isOut?'checked-out':'in-stock'}">${isOut?'已出库':'在库'}</span>
            </div>
            <div class="device-card-name-row">
                <div class="device-card-name">${escapeHtml(d.name)}${d.quantity > 1 ? `<span class="device-card-qty">×${d.quantity}</span>` : ''}</div>
                ${specInlineHtml}
            </div>
            ${locationHtml}
            ${remarkHtml}
        </div>`;
    }).join('');
    document.getElementById('listViewContainer').innerHTML = html;
    if (batchSelectMode) initDragSelect();
}

function renderWarehouseList() {
    const ul = document.getElementById('warehouseList');
    const btn = document.getElementById('warehouseShowMore');
    const totalCount = warehouses.reduce((sum, w) => sum + (w.device_count || 0), 0);
    const countStyle = 'color:#999;font-weight:700;font-size:var(--text-sm);margin-left:auto;';
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
    html += displayWarehouses.map(w => `<li class="${currentWarehouse && currentWarehouse.id===w.id?'active':''}" onclick="selectWarehouse(${w.id},'${escapeOnClick(w.name)}')">
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
        return `<span class="tag-item${active?' active':''}" onclick="selectTag('${escapeOnClick(t.name)}')">${escapeHtml(t.name)}<span class="tag-count">${t.total}</span></span>`;
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
        return `<li onclick="goDeviceDetail('${escapeOnClick(d.device_id || String(d.id))}')">
            <span>${escapeHtml(d.name)}</span>
            <span class="expiring-badge-sidebar" style="background:${cs.bg};color:${cs.color};">${days < 0 ? '过期' + (-days) + '天' : days + '天'}</span>
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
    currentTab = 'in';
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
    datalist.innerHTML = allTags.map(t => `<option value="${escapeAttr(t)}">`).join('');
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

async function generateCode() {
    try {
        const r = await fetch(API_BASE + '/devices/next-code');
        const data = await r.json();
        if (data.code) document.getElementById('frmDeviceCode').value = data.code;
    } catch(e) { showToast('生成设备ID失败', 'error'); }
}

let _submitLock = false; // 防重复提交锁：请求期间阻止再次触发（双击保存/导入等）
async function saveDevice() {
    if (_submitLock) return; _submitLock = true;
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
    if (!data.name) { showToast('请输入设备名称', 'warning'); _submitLock = false; return; }
    try {
        const url = id ? `${API_BASE}/devices/${id}` : `${API_BASE}/devices`;
        const method = id ? 'PUT' : 'POST';
        const r = await fetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
        if (!r.ok) { const t = await r.text(); throw new Error(t); }
        const result = await r.json().catch(() => null);
        closeAllModals();
        showToast(id ? '设备已更新' : '设备已添加', 'success');
        // 局部更新：仅刷新该设备；当前视图看不到时（如新设备在别的仓库）兜底全量
        if (!(result && result.data && applyDeviceUpsert(result.data))) {
            loadDevices();
            loadWarehouses();
        }
    } catch(e) { showToast('保存失败: ' + e.message, 'error'); }
    finally { _submitLock = false; }
}

function deleteDeviceFromModal() {
    const id = document.getElementById('frmDeviceId')?.value;
    const name = document.getElementById('frmDeviceName')?.value;
    if (!id) return;
    deleteDevice(parseInt(id), name);
}

async function deleteDevice(id, name) {
    if (!confirm(`确定要删除设备"${name}"吗？该设备的附件与图片将一并删除，此操作不可撤销。`)) return;
    try {
        const r = await fetch(`${API_BASE}/devices/${id}`, { method: 'DELETE' });
        if (!r.ok) throw new Error(await r.text());
        closeAllModals();
        showToast('设备已删除', 'success');
        // 局部更新：从内存移除该设备；未命中时兜底全量
        if (!applyDeviceRemove([id])) {
            loadDevices();
            loadWarehouses();
        }
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
    if (_submitLock) return; _submitLock = true;
    const dest = document.getElementById('checkoutDest')?.value || '';
    try {
        const r = await fetch(`${API_BASE}/devices/${checkoutDeviceId}`, {
            method: 'PUT', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ location_status: 'checked_out', destination: dest, checkout_time: new Date().toISOString() })
        });
        if (!r.ok) throw new Error(await r.text());
        const result = await r.json().catch(() => null);
        closeAllModals();
        showToast('设备已出库', 'success');
        // 局部更新：仅刷新该设备
        if (!(result && result.data && applyDeviceUpsert(result.data))) loadDevices();
    } catch(e) { showToast('出库失败: ' + e.message, 'error'); }
    finally { _submitLock = false; }
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
    if (_submitLock) return; _submitLock = true;
    try {
        const r = await fetch(`${API_BASE}/devices/${checkinDeviceId}`, {
            method: 'PUT', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ location_status: 'in_stock', destination: '', checkin_time: new Date().toISOString() })
        });
        if (!r.ok) throw new Error(await r.text());
        const result = await r.json().catch(() => null);
        closeAllModals();
        showToast('设备已入库', 'success');
        // 局部更新：仅刷新该设备
        if (!(result && result.data && applyDeviceUpsert(result.data))) loadDevices();
    } catch(e) { showToast('入库失败: ' + e.message, 'error'); }
    finally { _submitLock = false; }
}

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
                <button class="btn btn-secondary btn-sm" onclick="editWarehouseInline(${w.id},'${escapeOnClick(w.name)}','${escapeOnClick(w.description||'')}')"><i class="bi bi-pencil"></i></button>
                <button class="btn btn-danger btn-sm" onclick="deleteWarehouse(${w.id},'${escapeOnClick(w.name)}')"><i class="bi bi-trash"></i></button>
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
    if (!confirm(`确定要删除仓库"${name}"吗？该仓库下的所有设备及其附件与图片也将被删除。`)) return;
    try {
        const r = await fetch(`${API_BASE}/warehouses/${id}`, { method:'DELETE' });
        if (!r.ok) throw new Error(await r.text());
        showToast('仓库已删除', 'success');
        if (currentWarehouse && currentWarehouse.id === id) selectWarehouse(null);
        loadWarehouses();
        loadDevices(); // 刷新设备列表，清除被级联删除的"幽灵设备"
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
            <div class="form-hint">第一行为表头，支持：仓库名称、设备名称、规格型号、序列号、来源、数量、标签、所属路径、负责人、位置、状态、到期日期、入库时间、去向、在库状态、备注（"在库状态"填「已出库」即视为出库，留空则按"去向"是否填写自动推断）</div>
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
    if (_submitLock) return;
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

    _submitLock = true;

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
    } finally { _submitLock = false; }
}

// ===== 排序 =====
const SORT_FIELDS = [
    { key: 'name', label: '设备名称' },
    { key: 'spec_model', label: '规格型号' },
    { key: 'warehouse_name', label: '所属仓库' },
    { key: 'checkin_time', label: '入库时间' },
    { key: 'expiry_date', label: '到期日期' },
];
let sortField = store.get('dms_sort_field') || 'checkin_time';
let sortAsc = (() => {
    const saved = store.get('dms_sort_asc');
    return saved === null ? false : saved === 'true';
})();

function applySort() {
    // 比较器内变量与外层重名曾造成遮蔽，此处重命名消除
    const cmp = (a, b) => {
        let aVal = a[sortField] || '', bVal = b[sortField] || '';
        if (sortField === 'checkin_time' || sortField === 'expiry_date') {
            aVal = aVal || '0000-00-00';
            bVal = bVal || '0000-00-00';
        }
        if (typeof aVal === 'string') aVal = aVal.toLowerCase();
        if (typeof bVal === 'string') bVal = bVal.toLowerCase();
        if (aVal < bVal) return sortAsc ? -1 : 1;
        if (aVal > bVal) return sortAsc ? 1 : -1;
        return 0;
    };
    allDevices.sort(cmp);
    // localStorage 只在排序条件变化时写入（persistSortState），纯重排不重复写盘
}

// 排序条件变化时持久化（selectSortField / selectSortFieldFromFab 调用）
function persistSortState() {
    store.set('dms_sort_field', sortField);
    store.set('dms_sort_asc', sortAsc);
}

function toggleSort(e) {
    e.stopPropagation();
    const menu = document.getElementById('sortDropdown');
    const btn = e.currentTarget;
    if (!menu || !btn) return;
    const isOpen = menu.style.display === 'block';
    if (isOpen) { menu.style.display = 'none'; return; }

    // 先渲染内容：菜单宽度由内容决定，必须先渲染才能测量真实宽度
    menu.innerHTML = SORT_FIELDS.map(f => {
        const active = f.key === sortField;
        const arrow = active ? (sortAsc ? ' ↑' : ' ↓') : '';
        return `<div class="sort-dropdown-item${active ? ' active' : ''}" data-field="${f.key}" onclick="selectSortField('${f.key}')">
            <span>${f.label}</span>
            <span class="sort-arrow">${arrow}</span>
        </div>`;
    }).join('');

    // 不可见地显示一次，测量真实尺寸（边界检测需要宽度）
    menu.style.visibility = 'hidden';
    menu.style.display = 'block';
    const menuWidth = menu.offsetWidth;

    // 定位到按钮下方（以 header-row 为基准），并做左右边界检测
    const container = btn.closest('.header-row');
    const containerRect = container ? container.getBoundingClientRect() : null;
    const btnRect = btn.getBoundingClientRect();
    if (containerRect) {
        let left = btnRect.left - containerRect.left;
        // 右侧空间不足（移动端筛选按钮位于屏幕最右）→ 改为右对齐、向左展开
        if (left + menuWidth > containerRect.width) {
            left = (btnRect.right - containerRect.left) - menuWidth;
        }
        if (left < 0) left = 0; // 左侧兜底，防止反向溢出
        menu.style.left = left + 'px';
        menu.style.top = (btnRect.bottom - containerRect.top + 4) + 'px';
    } else {
        let left = btnRect.left;
        if (left + menuWidth > window.innerWidth) left = Math.max(8, window.innerWidth - menuWidth - 8);
        if (left < 0) left = 8;
        menu.style.left = left + 'px';
        menu.style.top = (btnRect.bottom + 4) + 'px';
    }
    menu.style.visibility = '';
}

function selectSortField(field) {
    if (field === sortField) {
        sortAsc = !sortAsc;
    } else {
        sortField = field;
        sortAsc = sortField === 'checkin_time' || sortField === 'expiry_date' ? false : true;
    }
    persistSortState();
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

// ===== FAB 浮动操作按钮 =====
function toggleFabMenu() {
    const container = document.getElementById('fabContainer');
    const menu = document.getElementById('fabMenu');
    const overlay = document.getElementById('fabOverlay');
    const isOpen = container.classList.contains('open');
    if (isOpen) {
        closeFabMenu();
    } else {
        container.classList.add('open');
        menu.classList.add('show');
        overlay.classList.add('show');
    }
}

function closeFabMenu() {
    const container = document.getElementById('fabContainer');
    const menu = document.getElementById('fabMenu');
    const sortMenu = document.getElementById('fabSortMenu');
    const overlay = document.getElementById('fabOverlay');
    container.classList.remove('open', 'flipped');
    menu.classList.remove('show');
    overlay.classList.remove('show');
    // 清理 sort menu 子项，避免残留 DOM 影响下次打开
    if (sortMenu) sortMenu.innerHTML = '';
}

// 从主菜单翻转到排序子菜单
function showFabSortMenu() {
    const container = document.getElementById('fabContainer');
    const sortMenu = document.getElementById('fabSortMenu');
    if (!container || !sortMenu) return;

    const currentField = sortField;
    const currentAsc = sortAsc;

    // 排序选项（1-5）+ 返回按钮（6th，末尾，与主菜单"排序"位置重合）
    sortMenu.innerHTML = SORT_FIELDS.map(f => {
        const active = f.key === currentField;
        const arrow = active ? (currentAsc ? ' ↑' : ' ↓') : '';
        return `<button class="fab-menu-item fab-sort-item${active ? ' active' : ''}" onclick="event.stopPropagation();selectSortFieldFromFab('${f.key}')">
            <span class="fab-menu-label">${f.label}</span>
            <span class="fab-sort-arrow">${arrow}</span>
        </button>`;
    }).join('') + `
        <button class="fab-menu-item fab-back-item" onclick="backToFabMenu()">
            <span class="fab-menu-icon"><i class="bi bi-arrow-left"></i></span>
            <span class="fab-menu-label">返回</span>
        </button>
    `;

    container.classList.add('flipped');
}

// 从排序子菜单翻转回主菜单
function backToFabMenu() {
    const container = document.getElementById('fabContainer');
    if (container) container.classList.remove('flipped');
}

// 在 FAB 排序子菜单中选中排序字段
function selectSortFieldFromFab(field) {
    if (field === sortField) {
        sortAsc = !sortAsc;
    } else {
        sortField = field;
        sortAsc = sortField === 'checkin_time' || sortField === 'expiry_date' ? false : true;
    }
    persistSortState();
    applySort();
    renderDevices();
    updateSortBtnIcon();
    closeFabMenu();
}

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

// 显示新增公告表单（在 dropdown 顶部，最多一个）
function showAddAnnouncement() {
    const dropdown = document.getElementById('annDropdown');
    if (dropdown.style.display !== 'block') {
        toggleAnnDropdown();
    }
    const inner = document.getElementById('annDropdownInner');
    // 已存在输入框则聚焦，不重复创建
    const existing = inner.querySelector('.announcement-add-form');
    if (existing) {
        document.getElementById('newAnnouncementInput')?.focus();
        return;
    }
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
    if (_submitLock) return; _submitLock = true;
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
    finally { _submitLock = false; }
}

// ===== 图片全屏（showImageFullscreen 已抽至 common.js） =====



// ===== 键盘事件 =====
// Esc 只关闭最上层弹窗（如在设备表单中打开的备注编辑器，避免误关整个表单丢失数据）
function closeTopModal() {
    const visible = Array.from(document.querySelectorAll('.modal-overlay')).filter(m => m.style.display === 'flex');
    if (!visible.length) return;
    const top = visible[visible.length - 1];
    if (top.id === 'remarkPreviewModal') { closeRemarkModal(); return; }
    top.style.display = 'none';
}
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeTopModal();
});

// ===== 搜索 =====
document.addEventListener('DOMContentLoaded', async function() {
    // 搜索实时过滤（250ms 防抖，避免每敲一个字符全量重建表格）
    let _searchDebounceTimer = null;
    document.getElementById('searchInput').addEventListener('input', function() {
        clearTimeout(_searchDebounceTimer);
        _searchDebounceTimer = setTimeout(renderDevices, 250);
    });

    // 搜索回车：立即渲染并取消未执行的防抖
    document.getElementById('searchInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { clearTimeout(_searchDebounceTimer); renderDevices(); }
    });

    // 按钮事件绑定
    document.getElementById('addDeviceBtn').addEventListener('click', () => openDeviceModal(null));
    updateSortBtnIcon();

    // 点击模态框外部关闭（只关最上层，保护底层表单数据）
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('modal-overlay')) closeTopModal();
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
let _lastInnerWidth = window.innerWidth;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        const w = window.innerWidth;
        // 仅当跨过 1500px 阈值（标签列显示 1→2 个变化）且仍在表格视图时才需要重渲染
        const crossedThreshold = (_lastInnerWidth < 1500) !== (w < 1500);
        _lastInnerWidth = w;
        applyViewByWidth(false);
        if (viewMode === 'table' && crossedThreshold) renderDevices();
    }, 200);
});

function applyViewByWidth(isInit) {
    // 说明：此处曾给 body 加/移除 is-mobile 类，但 style.css 中并无对应规则（死代码），
    // 移动端适配实际由 CSS @media (max-width: 768px) + 下方切卡片视图完成，故已移除该类操作。
    const w = window.innerWidth;
    if (w < 768) {
        // Step4: 移动端 → 卡片视图
        if (viewMode !== 'list') {
            autoSwitchedToCard = true;
            switchView('list', true);
        }
    } else if (w < 1366) {
        // Step3: 卡片视图
        if (viewMode === 'table') {
            autoSwitchedToCard = true;
            switchView('list', true);
        }
    } else {
        // ≥1366: 恢复宽度后切回表格视图；仅当当前卡片视图是系统自动切换的（用户手动选的卡片视图不动）
        if (autoSwitchedToCard && viewMode === 'list') {
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
        showToast(data.message || '设备ID补全完成', 'success');
        loadDevices();
    } catch (e) {
        showToast('补全设备ID失败: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

// ===== 清空当前仓库 =====
async function clearCurrentWarehouse() {
    const isAll = !currentWarehouse || currentWarehouse.id === '__unassigned__';
    const label = isAll ? '全部设备' : `仓库【${currentWarehouse.name}】`;

    if (!confirm(`确定要清空 ${label} 下的所有设备吗？\n\n这些设备的附件与图片将一并删除，此操作不可撤销！`)) return;
    if (!confirm('再次确认：清空后数据不可恢复，确定继续？')) return;

    try {
        const res = await fetch(`${API_BASE}/devices/clear-warehouse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ warehouseName: isAll ? null : currentWarehouse.name })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`已清空 ${data.deleted} 台设备`, 'success');
            await loadDevices();
            await loadTagStats();
        } else {
            showToast('清空失败: ' + (data.error || '未知错误'), 'error');
        }
    } catch (e) {
        showToast('清空失败: ' + e.message, 'error');
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
    const toggle = document.getElementById('menuToggle');
    sidebar.classList.toggle('show');
    if (overlay) overlay.classList.toggle('show');
    if (toggle) toggle.classList.toggle('active');
}

// ===== 显示补全按钮 =====
function updateBackfillBtnVisibility() {
    const btn = document.getElementById('btnBackfillCodes');
    if (!btn) return;
    // 只有存在缺失 device_id 的设备时才显示补全按钮
    const nullCount = allDevices.filter(d => !d.device_id && !d.deviceId).length;
    btn.style.display = nullCount > 0 ? '' : 'none';
}
