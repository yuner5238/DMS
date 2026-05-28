// ===== 公开配置（从服务器动态获取） =====
window.S3_PUBLIC_URL = '';

async function loadPublicConfig() {
    try {
        const res = await fetch('/api/config');
        const cfg = await res.json();
        window.S3_PUBLIC_URL = cfg.s3PublicUrl || '';
    } catch (e) {
        console.warn('加载公开配置失败:', e);
    }
}

// ===== API 配置（自动切换）=====
// 本地开发（Node.js + MySQL）：http://localhost:3000 → 走本地 /api
// 云端部署（Pages Functions）：使用相对路径，直接调用 Pages Functions
// 备用方案：如果 Pages Functions 不可用，回退到 Worker
const API_BASE = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? '/api'
    : '/api';  // 优先使用同域名的 Pages Functions
// ===================

let currentWarehouseId = null;
let currentWarehouseName = null;
let allDevices = [];
let warehouses = [];
let tagStats = [];
let currentTagFilter = null;
let locationFilters = { in_stock: true, checked_out: true };  // 状态过滤，默认显示全部设备
let filterPanelVisible = true;  // 过滤面板默认显示
let announcements = [];
let dismissedAnnouncements = new Set();
let viewMode = 'table';  // 视图模式：'list' 列表模式 或 'table' 表格模式

// ===== 表格列显示控制 =====
const COLUMN_DEFS = [
    { key: 'deviceId',    label: '设备ID',   dataCol: 'device-id' },
    { key: 'name',        label: '设备名称', dataCol: 'name' },
    { key: 'quantity',    label: '数量',     dataCol: 'quantity' },
    { key: 'tags',        label: '标签',     dataCol: 'tags' },
    { key: 'location',    label: '位置/去向', dataCol: 'location' },
    { key: 'expiry',      label: '到期日期', dataCol: 'expiry' },
    { key: 'remark',      label: '备注',     dataCol: 'remark' },
    { key: 'responsible', label: '负责人',   dataCol: 'responsible', defaultVisible: false },
    { key: 'status',      label: '状态',     dataCol: 'status',      defaultVisible: false },
    { key: 'checkin',     label: '入库时间', dataCol: 'checkin',      defaultVisible: false },
    { key: 'actions',     label: '操作',     dataCol: 'actions' },
];

let columnVisibility = (() => {
    try {
        const saved = localStorage.getItem('dms_column_visibility');
        if (saved) {
            const parsed = JSON.parse(saved);
            COLUMN_DEFS.forEach(c => { if (!(c.key in parsed)) parsed[c.key] = c.defaultVisible !== false; });
            return parsed;
        }
    } catch (e) {}
    const defaults = {};
    COLUMN_DEFS.forEach(c => defaults[c.key] = c.defaultVisible !== false);
    return defaults;
})();

function applyColumnVisibility() {
    const visibleCols = new Set();
    for (const [key, val] of Object.entries(columnVisibility)) {
        if (val) {
            const def = COLUMN_DEFS.find(d => d.key === key);
            if (def) visibleCols.add(def.dataCol);
        }
    }
    document.querySelectorAll('[data-col]').forEach(el => {
        const col = el.getAttribute('data-col');
        el.classList.toggle('d-none', !visibleCols.has(col));
    });
    localStorage.setItem('dms_column_visibility', JSON.stringify(columnVisibility));
}

function toggleColumnSettings(e) {
    e.stopPropagation();
    const menu = document.getElementById('columnSettingsMenu');
    if (!menu) return;
    const isOpen = menu.style.display === 'block';
    // 关闭
    if (isOpen) { menu.style.display = 'none'; return; }
    // 生成菜单
    menu.innerHTML = COLUMN_DEFS.map(c => `
        <label class="column-settings-item">
            <input type="checkbox" ${columnVisibility[c.key] ? 'checked' : ''} onchange="toggleColumn('${c.key}', this.checked)">
            <span>${c.label}</span>
        </label>
    `).join('');
    menu.style.display = 'block';
}

function toggleColumn(key, visible) {
    columnVisibility[key] = visible;
    applyColumnVisibility();
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

// 格式化时间（北京时间）
function formatTime(timeStr) {
    if (!timeStr) return '';
    const date = new Date(timeStr);
    // 转换为北京时间（UTC+8）
    const beijingDate = new Date(date.getTime() + (8 * 60 * 60 * 1000) + (date.getTimezoneOffset() * 60 * 1000));
    const month = String(beijingDate.getMonth() + 1).padStart(2, '0');
    const day = String(beijingDate.getDate()).padStart(2, '0');
    const hour = String(beijingDate.getHours()).padStart(2, '0');
    const minute = String(beijingDate.getMinutes()).padStart(2, '0');
    return `${month}/${day} ${hour}:${minute}`;
}

// 格式化日期（设备列表用，北京时间）
function formatDate(timeStr) {
    if (!timeStr) return '';
    const date = new Date(timeStr);
    // 转换为北京时间（UTC+8）
    const beijingDate = new Date(date.getTime() + (8 * 60 * 60 * 1000) + (date.getTimezoneOffset() * 60 * 1000));
    return `${beijingDate.getFullYear()}.${String(beijingDate.getMonth() + 1).padStart(2, '0')}.${String(beijingDate.getDate()).padStart(2, '0')}`;
}

// 解析标签字段（JSON 数组格式，兼容旧的逗号分隔格式）
function parseTags(tagField) {
    if (!tagField || !tagField.trim()) return [];
    const field = tagField.trim();
    if (field.startsWith('[')) {
        try { return JSON.parse(field); } catch (e) { return []; }
    }
    // 兼容旧的逗号分隔格式
    return field.split(',').map(t => t.trim()).filter(t => t);
}

// 渲染多标签徽章（JSON 数组格式的 tag_names），最多显示 3 个，多余用省略号
function renderTagBadges(device) {
    const tagField = (device.tag_names || device.tag_name || '').trim();
    if (!tagField) return '-';
    const tags = parseTags(tagField);
    if (tags.length === 0) return '-';
    const visible = tags.slice(0, 2);
    const hidden = tags.length > 2
        ? `<span class="tag-badge tag-more">+${tags.length - 2}<span class="tag-tooltip">${tags.slice(2).map(t => `<span class="tag-badge">${t}</span>`).join('')}</span></span>`
        : '';
    return visible.map(t => `<span class="tag-badge">${t}</span>`).join('') + hidden;
}

// 解析用户输入的日期字符串，支持 2026.5.20 或 2026.05.20 格式
// 返回 YYYY-MM-DD 格式或 null
function parseDateInput(dateStr) {
    if (!dateStr || !dateStr.trim()) return null;
    const cleaned = dateStr.trim();
    // 支持 . - / 分隔符
    const parts = cleaned.split(/[.\-\/]/);
    if (parts.length !== 3) return null;
    const [year, month, day] = parts;
    if (!year || !month || !day) return null;
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    const d = parseInt(day, 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// 格式化日期为 MySQL datetime 格式（北京时间）
function formatDateTime(date) {
    const d = new Date(date);
    // 转换为北京时间（UTC+8）
    const beijingDate = new Date(d.getTime() + (8 * 60 * 60 * 1000) + (d.getTimezoneOffset() * 60 * 1000));
    const year = beijingDate.getFullYear();
    const month = String(beijingDate.getMonth() + 1).padStart(2, '0');
    const day = String(beijingDate.getDate()).padStart(2, '0');
    const hour = String(beijingDate.getHours()).padStart(2, '0');
    const minute = String(beijingDate.getMinutes()).padStart(2, '0');
    const second = String(beijingDate.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

// 显示备注预览
let _remarkOriginalContent = '';
let _remarkPreviewSource = 'table'; // 'table' | 'deviceModal'

function showRemarkPreview(deviceId, deviceName, remark, source = 'table') {
    _remarkPreviewSource = source;

    if (source === 'deviceModal') {
        // 从设备编辑弹窗打开：从 deviceRemarkEditor 读取内容
        const remarkEditor = document.getElementById('deviceRemarkEditor');
        const content = remarkEditor ? remarkEditor.innerHTML : '';
        document.getElementById('remarkPreviewDeviceId').value = document.getElementById('deviceId').value;
        document.getElementById('remarkPreviewDeviceIdCode').value = document.getElementById('deviceIdCode').value;
        document.getElementById('remarkDeviceName').textContent = document.getElementById('deviceName').value;
        document.getElementById('remarkContent').innerHTML = content;
        _remarkOriginalContent = document.getElementById('remarkContent').innerHTML;
        // 更新标题
        document.querySelector('#remarkPreviewModal .modal-title').innerHTML =
            '<i class="bi bi-pencil-square me-2" style="color: #495057;"></i>编辑备注' +
            '<span id="remarkPreviewStatus" style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: #198754; margin-left: 10px; flex-shrink: 0;" title="已是最新版本"></span>';
    } else {
        // 如果 remark 未传入，从 allDevices 数组中查找（避免 HTML/JS 引号转义问题）
        let deviceIdCode = '';
        if (remark === undefined || remark === null) {
            const device = allDevices.find(d => d.id == deviceId);
            if (device) {
                remark = device.remark || '';
                deviceIdCode = device.device_id || '';
            } else {
                remark = '';
            }
        }
        if (!remark) return;
        document.getElementById('remarkPreviewDeviceId').value = deviceId;
        document.getElementById('remarkPreviewDeviceIdCode').value = deviceIdCode;
        document.getElementById('remarkDeviceName').textContent = deviceName;
        const decoded = decodeRichText(remark);
        document.getElementById('remarkContent').innerHTML = decoded;
        _remarkOriginalContent = document.getElementById('remarkContent').innerHTML;
        // 更新标题
        document.querySelector('#remarkPreviewModal .modal-title').innerHTML =
            '<i class="bi bi-file-text me-2" style="color: #495057;"></i>备注详情' +
            '<span id="remarkPreviewStatus" style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: #198754; margin-left: 10px; flex-shrink: 0;" title="已是最新版本"></span>';
    }

    updateRemarkPreviewStatus();
    new bootstrap.Modal(document.getElementById('remarkPreviewModal')).show();
}

// 更新备注预览窗口的状态指示器
function updateRemarkPreviewStatus() {
    const current = document.getElementById('remarkContent').innerHTML;
    const dot = document.getElementById('remarkPreviewStatus');
    if (current !== _remarkOriginalContent) {
        dot.style.backgroundColor = '#dc3545';
        dot.title = '有未保存的修改';
    } else {
        dot.style.backgroundColor = '#198754';
        dot.title = '已是最新版本';
    }
}

// 监听备注内容编辑（脚本在 body 底部执行时 DOM 已就绪）
(function bindRemarkStatusWatcher() {
    const remarkContent = document.getElementById('remarkContent');
    if (remarkContent) {
        remarkContent.addEventListener('input', updateRemarkPreviewStatus);
        // 双击图片全屏查看
        remarkContent.addEventListener('dblclick', function(e) {
            if (e.target.tagName === 'IMG') {
                e.preventDefault();
                showImageFullscreen(e.target.src);
            }
        });
    }
})();

// 从备注预览窗口保存备注
async function saveRemarkFromPreview() {
    const deviceId = document.getElementById('remarkPreviewDeviceId').value;
    const content = document.getElementById('remarkContent').innerHTML;
    const remark = encodeRichText(content);

    try {
        // 统一调 API 保存，数据库始终是唯一真实来源
        const data = { remark: remark };

        console.log('保存备注 - 请求数据:', { deviceId, remark, source: _remarkPreviewSource });

        const res = await fetch(`${API_BASE}/devices/${deviceId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!res.ok) {
            const errorText = await res.text();
            console.error('保存备注 - 服务器返回错误:', res.status, errorText);
            throw new Error(`HTTP ${res.status}: ${errorText}`);
        }

        console.log('保存备注 - 成功');

        // 从设备编辑弹窗打开时：同步回 deviceRemarkEditor
        if (_remarkPreviewSource === 'deviceModal') {
            const remarkEditor = document.getElementById('deviceRemarkEditor');
            if (remarkEditor) remarkEditor.innerHTML = content;
            document.getElementById('deviceRemark').value = remark;
        }

        _remarkOriginalContent = content;
        updateRemarkPreviewStatus();
        bootstrap.Modal.getInstance(document.getElementById('remarkPreviewModal')).hide();

        if (_remarkPreviewSource !== 'deviceModal') {
            await loadDevices();
        }
    } catch (e) {
        console.error('保存备注 - 异常:', e);
        alert('保存失败: ' + e.message);
    }
}

// 排序设备
function sortDevices() {
    const sortType = document.getElementById('sortSelect').value;
    let sorted = [...allDevices];
    switch (sortType) {
        case 'name': sorted.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')); break;
        case 'checkin': sorted.sort((a, b) => !a.checkin_time ? 1 : !b.checkin_time ? -1 : new Date(b.checkin_time) - new Date(a.checkin_time)); break;
        case 'checkout': sorted.sort((a, b) => !a.checkout_time ? 1 : !b.checkout_time ? -1 : new Date(b.checkout_time) - new Date(a.checkout_time)); break;
    }
    renderDevices(sorted);
}

// 切换视图模式
function toggleViewMode() {
    viewMode = viewMode === 'list' ? 'table' : 'list';
    const btn = document.getElementById('viewToggleBtn');
    const icon = btn.querySelector('i');
    if (viewMode === 'table') {
        icon.className = 'bi bi-grid-3x3-gap';
        btn.classList.add('active');
        btn.title = '切换到列表视图';
    } else {
        icon.className = 'bi bi-layout-text-sidebar';
        btn.classList.remove('active');
        btn.title = '切换到表格视图';
    }
    localStorage.setItem('viewMode', viewMode);
    renderDevices(allDevices);
}

// 渲染表格视图
function renderDevicesTableView(devices) {
    const list = document.getElementById('deviceList');
    if (devices.length === 0) {
        list.innerHTML = `<div class="text-center text-muted py-5"><i class="bi bi-inbox" style="font-size: 48px;"></i><p class="mt-2">该仓库暂无设备，点击上方"添加设备"按钮</p></div>`;
        return;
    }

    const inStockDevices = devices.filter(d => d.location_status === 'in_stock' || !d.location_status);
    const checkedOutDevices = devices.filter(d => d.location_status === 'checked_out');
    const statusClass = { '正常': 'status-normal', '异常': 'status-abnormal', '维修中': 'status-maintenance' };

    const renderTable = (deviceArr, isOut) => {
        if (deviceArr.length === 0) {
            return `<div class="text-center text-muted py-3">暂无${isOut ? '已出库' : '在库'}设备</div>`;
        }
        
            const rows = deviceArr.map(device => {
            const locationText = isOut ? (device.destination || '已出库') : (device.storage_location || '在库');
            const expiryDateText = device.expiry_date ? formatDate(device.expiry_date) : '-';

            return `
                <tr class="${isOut ? 'checked-out-row' : ''}" onclick="showDeviceDetail('${device.device_id || device.id}')" style="cursor: pointer;">
                    <td data-col="device-id">${device.device_id ? `<span class="device-id-badge" onclick="event.stopPropagation()">${device.device_id}</span>` : '<span class="text-muted">-</span>'}</td>
                    <td data-col="name" class="device-name-cell"><strong>${device.name}</strong></td>
                    <td data-col="quantity">${device.quantity || 1}</td>
                    <td data-col="tags">${renderTagBadges(device)}</td>
                    <td data-col="location">${locationText}</td>
                    <td data-col="expiry">${expiryDateText}</td>
                    <td data-col="remark">${device.remark
                        ? `<span class="remark-tooltip-wrapper" onclick="event.stopPropagation();if(!window._remarkTouchFlag){showRemarkPreview(${device.id}, '${device.name.replace(/'/g, "\\'")}')}window._remarkTouchFlag=false"><i class="bi bi-file-text remark-icon" ontouchstart="window._remarkTouchFlag=true;event.stopPropagation()"></i></span>`
                        : '<span class="text-muted">-</span>'
                    }</td>
                    <td data-col="responsible">${device.responsible_person || '<span class="text-muted">-</span>'}</td>
                    <td data-col="status"><span class="status-badge ${statusClass[device.status] || ''}">${device.status || '-'}</span></td>
                    <td data-col="checkin">${device.checkin_time ? formatDate(device.checkin_time) : '<span class="text-muted">-</span>'}</td>
                    <td data-col="actions">
                        <div class="d-flex gap-1">
                            ${isOut
                                ? `<button class="btn btn-sm btn-outline-success" onclick="event.stopPropagation(); showCheckinModal(${device.id}, '${device.name}')" title="入库"><i class="bi bi-box-arrow-left"></i></button>`
                                : `<button class="btn btn-sm btn-outline-warning" onclick="event.stopPropagation(); showCheckoutModal(${device.id}, '${device.name}')" title="出库"><i class="bi bi-box-arrow-right"></i></button>`
                            }
                            <button class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation(); editDevice(${device.id})" title="修改"><i class="bi bi-pencil"></i></button>
                            <button class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation(); deleteDeviceFromList(${device.id}, '${device.name}')" title="删除"><i class="bi bi-trash"></i></button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        return `
            <table class="table table-hover table-sm device-table">
                <thead>
                    <tr>
                        <th data-col="device-id">设备ID</th>
                        <th data-col="name">设备名称</th>
                        <th data-col="quantity">数量</th>
                        <th data-col="tags">标签</th>
                        <th data-col="location">位置/去向</th>
                        <th data-col="expiry">到期日期</th>
                        <th data-col="remark">备注</th>
                        <th data-col="responsible">负责人</th>
                        <th data-col="status">状态</th>
                        <th data-col="checkin">入库时间</th>
                        <th data-col="actions">操作</th>
                        <th class="col-settings-th">
                            <button class="btn btn-sm btn-outline-secondary col-settings-btn" onclick="event.stopPropagation();toggleColumnSettings(event)" title="列设置">
                                <i class="bi bi-gear"></i>
                            </button>
                            <div class="column-settings-menu" id="columnSettingsMenu" style="display:none;"></div>
                        </th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    };

    const inStockHtml = `
        <div class="device-section in-stock-section">
            <div class="device-section-header" onclick="toggleSection('inStockBody')">
                <h6><i class="bi bi-box-seam"></i> 在库设备 <span class="badge bg-success">${inStockDevices.length}</span></h6>
                <i class="bi bi-chevron-down chevron-icon"></i>
            </div>
            <div class="device-section-body expanded p-0" id="inStockBody">
                <div class="table-responsive">${renderTable(inStockDevices, false)}</div>
            </div>
        </div>
    `;
    
    const checkedOutHtml = `
        <div class="device-section checked-out-section">
            <div class="device-section-header" onclick="toggleSection('checkedOutBody')">
                <h6><i class="bi bi-box-arrow-right"></i> 已出库设备 <span class="badge bg-warning text-dark">${checkedOutDevices.length}</span></h6>
                <i class="bi bi-chevron-down chevron-icon collapsed"></i>
            </div>
            <div class="device-section-body p-0" id="checkedOutBody">
                <div class="table-responsive">${renderTable(checkedOutDevices, true)}</div>
            </div>
        </div>
    `;

    list.innerHTML = inStockHtml + checkedOutHtml;
    setTimeout(applyColumnVisibility, 0);
}

// 加载仓库列表
async function loadWarehouses() {
    try {
        const res = await fetch(`${API_BASE}/warehouses`);
        const data = await res.json();
        warehouses = Array.isArray(data) ? data : [];
        // 在顶部添加"总仓库"选项
        warehouses.unshift({ id: 0, name: '总仓库' });
        renderWarehouseList();
        updateWarehouseSelect();
    } catch (e) { console.error('加载仓库失败:', e); }
}

// 加载标签统计（支持按仓库筛选和状态筛选、多标签拆分）
async function loadTagStats(warehouseName = null) {
    try {
        // 先获取设备数据用于标签统计
        let devicesUrl = `${API_BASE}/devices`;
        if (warehouseName) {
            devicesUrl += `?warehouseName=${encodeURIComponent(warehouseName)}`;
        }
        const res = await fetch(devicesUrl);
        const devices = await res.json();
        const allDevices = Array.isArray(devices) ? devices : [];

        // 根据状态过滤设备
        const filteredDevices = allDevices.filter(d => {
            if (locationFilters.in_stock && d.location_status !== 'checked_out') return true;
            if (locationFilters.checked_out && d.location_status === 'checked_out') return true;
            return false;
        });

        // 计算标签统计 — 支持 JSON 数组格式的多标签
        const tagCountMap = {};
        filteredDevices.forEach(d => {
            const tagField = d.tag_names || d.tag_name || '';
            if (tagField) {
                const tags = parseTags(tagField);
                tags.forEach(tag => {
                    const name = tag.trim();
                    if (name) {
                        if (!tagCountMap[name]) {
                            tagCountMap[name] = 0;
                        }
                        tagCountMap[name] += d.quantity || 1;
                    }
                });
            }
        });

        // 转换为标签统计数组
        tagStats = Object.entries(tagCountMap)
            .map(([name, total_count]) => ({ name, total_count }))
            .sort((a, b) => a.name.localeCompare(b.name));

        renderTagStats();
    } catch (e) {
        console.error('加载标签统计失败:', e);
        tagStats = [];
        renderTagStats();
    }
}

// 更新仓库下拉框
function updateWarehouseSelect() {
    const select = document.getElementById('deviceWarehouse');
    select.innerHTML = warehouses.map(w => `<option value="${w.name}">${w.name}</option>`).join('');
    if (currentWarehouseName) select.value = currentWarehouseName;
}

// 渲染仓库列表
function renderWarehouseList() {
    const list = document.getElementById('warehouseList');
    list.innerHTML = warehouses.map(w => {
        const inStock = w.inStockCount || 0;
        const checkedOut = w.checkedOutCount || 0;
        const isAll = w.id === 0;
        const isActive = currentWarehouseId === w.id;
        const icon = isAll ? 'bi-grid' : 'bi-box';
        const actionsHtml = isAll ? '' : `
            <div class="warehouse-actions" onclick="event.stopPropagation()">
                <button class="btn btn-sm btn-outline-light" onclick="editWarehouse(${w.id})" title="编辑"><i class="bi bi-pencil"></i></button>
                <button class="btn btn-sm btn-outline-danger" onclick="deleteWarehouseConfirm(${w.id})" title="删除"><i class="bi bi-trash"></i></button>
            </div>
        `;
        return `
            <div class="nav-link warehouse-card${isAll ? ' all' : ''}${isActive ? ' active' : ''}" data-id="${w.id}" data-name="${w.name}" onclick="selectWarehouse(${w.id}, '${w.name}')">
                ${actionsHtml}
                <div class="warehouse-name">
                    <i class="bi ${icon}"></i> ${w.name}
                </div>
                <div class="warehouse-stats">
                    <span class="stat-item in-stock">在库 ${inStock}</span>
                    <span class="stat-item checked-out">出库 ${checkedOut}</span>
                </div>
            </div>
        `;
    }).join('');
}

// 渲染标签统计
function renderTagStats() {
    const list = document.getElementById('tagStatsList');
    if (tagStats.length === 0) { list.innerHTML = '<div class="text-muted small">暂无标签数据</div>'; return; }
    list.innerHTML = tagStats.map(tag => `
        <div class="tag-list-item ${currentTagFilter === tag.name ? 'active' : ''}" onclick="filterByTag('${tag.name}')" style="cursor:pointer;">
            <span><i class="bi bi-tag"></i> ${tag.name} <span class="count">${tag.total_count}</span></span>
        </div>
    `).join('');
}

// 按标签筛选
function filterByTag(tagName) {
    if (currentTagFilter === tagName) {
        // 再次点击取消筛选
        currentTagFilter = null;
    } else {
        currentTagFilter = tagName;
    }
    renderTagStats();
    loadDevices();
}

// 切换过滤面板显示/隐藏
function toggleFilterPanel() {
    filterPanelVisible = !filterPanelVisible;
    const filterButtons = document.getElementById('filterButtons');
    filterButtons.style.display = filterPanelVisible ? 'flex' : 'none';
    updateFilterButtonStyles();
}

// 切换状态过滤
function toggleLocationFilter(location) {
    locationFilters[location] = !locationFilters[location];
    updateFilterButtonStyles();
    loadTagStats(currentWarehouseName);  // 刷新标签统计
    loadDevices();  // 刷新设备列表
}

// 更新过滤按钮样式
function updateFilterButtonStyles() {
    const inStockBtn = document.getElementById('filterInStock');
    const checkedOutBtn = document.getElementById('filterCheckedOut');

    if (locationFilters.in_stock) {
        inStockBtn.classList.add('active-in-stock');
    } else {
        inStockBtn.classList.remove('active-in-stock');
    }

    if (locationFilters.checked_out) {
        checkedOutBtn.classList.add('active-checked-out');
    } else {
        checkedOutBtn.classList.remove('active-checked-out');
    }
}

// 选择仓库
async function selectWarehouse(id, name) {
    currentWarehouseId = id;
    currentWarehouseName = name === '总仓库' ? null : name;
    currentTagFilter = null; // 切换仓库时清除标签筛选
    locationFilters = { in_stock: true, checked_out: true }; // 切换仓库时重置状态筛选（默认显示全部）
    updateFilterButtonStyles();
    document.getElementById('currentWarehouseTitle').innerHTML = `<i class="bi bi-folder"></i> ${name}`;
    document.getElementById('mobileWarehouseTitle').textContent = name;
    document.getElementById('deviceWarehouse').value = name;
    await loadDevices();
    // 加载标签统计（总仓库时传 null，其他传仓库名）
    await loadTagStats(currentWarehouseName);
    // 移动端选择仓库后自动收起侧边栏（仅当侧边栏当前是打开状态时）
    if (window.innerWidth <= 768) {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        if (sidebar.classList.contains('show')) {
            toggleSidebar();
        }
    }
}

// 加载设备
async function loadDevices() {
    if (!currentWarehouseId && currentWarehouseId !== 0) return;
    try {
        let url = `${API_BASE}/devices`;
        // 总仓库(id=0)加载所有设备，其他按仓库筛选
        if (currentWarehouseId > 0) {
            url += `?warehouseId=${currentWarehouseId}`;
        }
        const res = await fetch(url);
        const data = await res.json();
        let devices = Array.isArray(data) ? data : [];

        // 应用标签筛选（支持多标签：设备 tag_names JSON 数组中包含该标签即匹配）
        if (currentTagFilter) {
            devices = devices.filter(d => {
                const tags = parseTags(d.tag_names || d.tag_name || '');
                return tags.includes(currentTagFilter);
            });
        }

        // 应用状态筛选
        if (!locationFilters.in_stock || !locationFilters.checked_out) {
            devices = devices.filter(d => {
                if (locationFilters.in_stock && d.location_status !== 'checked_out') return true;
                if (locationFilters.checked_out && d.location_status === 'checked_out') return true;
                return false;
            });
        }

        allDevices = devices;
        renderDevices(devices);
        await updateStats();

        // 检查是否有设备缺少 device_id，显示/隐藏补全按钮
        const btnBackfill = document.getElementById('btnBackfillCodes');
        if (btnBackfill) {
            const nullCount = devices.filter(d => !d.device_id).length;
            btnBackfill.style.display = nullCount > 0 ? '' : 'none';
        }
    } catch (e) {
        console.error('加载设备失败:', e);
        allDevices = [];
        renderDevices([]);
    }
}

// 渲染设备列表
function renderDevices(devices) {
    const list = document.getElementById('deviceList');
    if (devices.length === 0) {
        list.innerHTML = `<div class="text-center text-muted py-5"><i class="bi bi-inbox" style="font-size: 48px;"></i><p class="mt-2">该仓库暂无设备，点击上方"添加设备"按钮</p></div>`;
        return;
    }
    
    // 根据视图模式渲染
    if (viewMode === 'table') {
        renderDevicesTableView(devices);
        return;
    }

    const inStockDevices = devices.filter(d => d.location_status === 'in_stock' || !d.location_status);
    const checkedOutDevices = devices.filter(d => d.location_status === 'checked_out');

    const renderDeviceItem = (device, isOut) => {
        const tagHtml = renderTagBadges(device);
        const actionBtn = isOut
            ? `<button class="btn btn-sm btn-outline-success checkin-btn" onclick="event.stopPropagation(); showCheckinModal(${device.id}, '${device.name}')" title="入库"><i class="bi bi-box-arrow-left"></i></button>`
            : `<button class="btn btn-sm btn-outline-warning checkout-btn" onclick="event.stopPropagation(); showCheckoutModal(${device.id}, '${device.name}')" title="出库"><i class="bi bi-box-arrow-right"></i></button>`;
        const destinationTag = isOut && device.destination ? `<span class="destination-tag"><i class="bi bi-geo-alt"></i> ${device.destination}</span>` : '';
        const checkinTimeValue = device.checkin_time ? formatDate(device.checkin_time) : '';
        const storageLocationValue = device.storage_location ? device.storage_location : '';

        return `
            <div class="device-item ${isOut ? 'checked-out' : ''}" onclick="showDeviceDetail('${device.device_id || device.id}')">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <div class="device-header-row">
                            <div class="device-name-section">
                                <div class="name-tags-row">
                                    <div class="name-quantity-wrapper">
                                        ${device.device_id ? `<span class="device-id-badge" onclick="event.stopPropagation()">${device.device_id}</span>` : ''}
                                        <strong id="device-name-${device.id}" class="device-name-text">${device.name}</strong>
                                        ${device.quantity ? `<span class="quantity-badge">${device.quantity}</span>` : ''}
                                    </div>
                                    <div class="status-tags-row">
                                        ${tagHtml}
                                        ${destinationTag}
                                    </div>
                                </div>
                            </div>
                            <div class="device-details">
                                <span class="detail-item remark"><span class="detail-label">备注:</span><span class="detail-value remark-clickable" onclick="event.stopPropagation(); showRemarkPreview(${device.id}, '${device.name.replace(/'/g, "\\'")}')">${decodeRichTextToSingleLine(device.remark || '')}</span></span>
                                <div class="detail-item location-checkin-row">
                                    <div class="detail-half location-half"><span class="detail-label">位置:</span><span class="detail-value location-value" title="${storageLocationValue}">${storageLocationValue}</span></div>
                                    <div class="detail-half checkin-half"><span class="detail-label">入库时间:</span><span class="detail-value checkin-time" title="${checkinTimeValue}">${checkinTimeValue}</span></div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="d-flex gap-2 align-items-center device-actions-wrapper">
                        <div class="d-flex gap-2 device-actions">
                            ${actionBtn}
                            <button class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation(); editDevice(${device.id})" title="修改"><i class="bi bi-pencil"></i></button>
                            <button class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation(); deleteDeviceFromList(${device.id}, '${device.name}')" title="删除"><i class="bi bi-trash"></i></button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    };

    const inStockHtml = inStockDevices.length > 0 ? inStockDevices.map(d => renderDeviceItem(d, false)).join('') : '<div class="text-center text-muted py-3">暂无在库设备</div>';
    const checkedOutHtml = checkedOutDevices.length > 0 ? checkedOutDevices.map(d => renderDeviceItem(d, true)).join('') : '<div class="text-center text-muted py-3">暂无已出库设备</div>';

    list.innerHTML = `
        <div class="device-section in-stock-section">
            <div class="device-section-header" onclick="toggleSection('inStockBody')">
                <h6><i class="bi bi-box-seam"></i> 在库设备 <span class="badge bg-success">${inStockDevices.length}</span></h6>
                <i class="bi bi-chevron-down chevron-icon"></i>
            </div>
            <div class="device-section-body expanded" id="inStockBody">${inStockHtml}</div>
        </div>
        <div class="device-section checked-out-section">
            <div class="device-section-header" onclick="toggleSection('checkedOutBody')">
                <h6><i class="bi bi-box-arrow-right"></i> 已出库设备 <span class="badge bg-warning text-dark">${checkedOutDevices.length}</span></h6>
                <i class="bi bi-chevron-down chevron-icon collapsed"></i>
            </div>
            <div class="device-section-body" id="checkedOutBody">${checkedOutHtml}</div>
        </div>
    `;
}

// 切换列表展开/折叠
function toggleSection(bodyId) {
    const body = document.getElementById(bodyId);
    const icon = body.previousElementSibling.querySelector('.chevron-icon');

    if (body.classList.contains('expanded')) {
        // 折叠
        body.classList.remove('expanded');
        icon.classList.add('collapsed');
    } else {
        // 展开
        body.classList.add('expanded');
        icon.classList.remove('collapsed');
    }
}

// 搜索过滤
function filterDevices() {
    const pcSearch = document.getElementById('searchInput');
    const mobileSearch = document.getElementById('mobileSearchInput');
    let keyword = '';
    
    // 获取搜索关键词（优先使用当前可见的输入框）
    if (pcSearch && pcSearch.offsetParent !== null) {
        keyword = pcSearch.value.toLowerCase();
    } else if (mobileSearch) {
        keyword = mobileSearch.value.toLowerCase();
    }
    
    const filtered = allDevices.filter(d =>
        d.name.toLowerCase().includes(keyword) ||
        ((d.tag_names || d.tag_name || '') && parseTags(d.tag_names || d.tag_name || '').some(t => t.toLowerCase().includes(keyword))) ||
        (d.destination && d.destination.toLowerCase().includes(keyword))
    );
    renderDevices(filtered);
}

// 更新统计（仓库在库/出库数量）
async function updateStats() {
    try {
        const res = await fetch(`${API_BASE}/devices`);
        const data = await res.json();
        const allData = Array.isArray(data) ? data : [];
        warehouses = warehouses.map(w => {
            if (w.id === 0) {
                // 总仓库统计所有设备
                w.inStockCount = allData.filter(d => d.location_status === 'in_stock' || !d.location_status).length;
                w.checkedOutCount = allData.filter(d => d.location_status === 'checked_out').length;
            } else {
                const wd = allData.filter(d => d.warehouse_name === w.name);
                w.inStockCount = wd.filter(d => d.location_status === 'in_stock' || !d.location_status).length;
                w.checkedOutCount = wd.filter(d => d.location_status === 'checked_out').length;
            }
            return w;
        });
        renderWarehouseList();
    } catch (e) {
        console.error('更新统计失败:', e);
        renderWarehouseList();
    }
}

// ============ 出库操作 ============
function showCheckoutModal(id, name) {
    document.getElementById('checkoutDeviceId').value = id;
    document.getElementById('checkoutDeviceName').textContent = name;
    document.getElementById('checkoutDestination').value = '';
    new bootstrap.Modal(document.getElementById('checkoutModal')).show();
}

async function confirmCheckout() {
    const id = document.getElementById('checkoutDeviceId').value;
    const destination = document.getElementById('checkoutDestination').value;
    const device = allDevices.find(d => d.id == id);
    try {
        await fetch(`${API_BASE}/devices/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                warehouseName: device.warehouse_name, name: device.name, tag_names: device.tag_names || '[]',
                status: device.status, quantity: device.quantity, storage_location: device.storage_location,
                location_status: 'checked_out', destination: destination || '', remark: device.remark,
                checkin_time: device.checkin_time, checkout_time: formatDateTime(new Date()),
                responsible_person: device.responsible_person || ''
            })
        });
        bootstrap.Modal.getInstance(document.getElementById('checkoutModal')).hide();
        await loadDevices(); await loadWarehouses(); await loadTagStats();
    } catch (e) { alert('出库失败: ' + e.message); }
}

// ============ 入库操作 ============
function showCheckinModal(id, name) {
    document.getElementById('checkinDeviceId').value = id;
    document.getElementById('checkinDeviceName').textContent = name;
    new bootstrap.Modal(document.getElementById('checkinModal')).show();
}

async function confirmCheckin() {
    const id = document.getElementById('checkinDeviceId').value;
    const device = allDevices.find(d => d.id == id);
    if (!device) { alert('未找到设备信息'); return; }
    try {
        await fetch(`${API_BASE}/devices/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                warehouseName: device.warehouse_name, name: device.name, tag_names: device.tag_names || '[]',
                status: device.status, quantity: device.quantity, storage_location: device.storage_location,
                location_status: 'in_stock', destination: '', remark: device.remark,
                checkin_time: formatDateTime(new Date()), checkout_time: null,
                responsible_person: device.responsible_person || ''
            })
        });
        bootstrap.Modal.getInstance(document.getElementById('checkinModal')).hide();
        await loadDevices(); await loadWarehouses(); await loadTagStats();
    } catch (e) { alert('入库失败: ' + e.message); }
}

// ============ 仓库操作 ============
function showWarehouseModal(id = null) {
    const modal = new bootstrap.Modal(document.getElementById('warehouseModal'));
    document.getElementById('warehouseModalTitle').textContent = id ? '编辑仓库' : '新建仓库';
    document.getElementById('deleteWarehouseBtn').style.display = id ? 'block' : 'none';
    if (id) {
        const w = warehouses.find(wh => wh.id === id);
        document.getElementById('warehouseId').value = w.id;
        document.getElementById('warehouseName').value = w.name;
        document.getElementById('warehouseDesc').value = w.description || '';
    } else {
        document.getElementById('warehouseId').value = '';
        document.getElementById('warehouseName').value = '';
        document.getElementById('warehouseDesc').value = '';
    }
    modal.show();
}

function editWarehouse(id) { showWarehouseModal(id); }

function deleteWarehouseConfirm(id) {
    if (!confirm('删除仓库将同时删除该仓库下所有设备，确定要删除吗？')) return;
    currentWarehouseId = id;
    deleteWarehouse();
}

async function saveWarehouse() {
    const id = document.getElementById('warehouseId').value;
    const data = { name: document.getElementById('warehouseName').value, description: document.getElementById('warehouseDesc').value };
    if (!data.name) { alert('请输入仓库名称'); return; }
    try {
        if (id) await fetch(`${API_BASE}/warehouses/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        else await fetch(`${API_BASE}/warehouses`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        bootstrap.Modal.getInstance(document.getElementById('warehouseModal')).hide();
        await loadWarehouses();
    } catch (e) { alert('保存失败: ' + e.message); }
}

async function deleteWarehouse() {
    try {
        await fetch(`${API_BASE}/warehouses/${currentWarehouseId}`, { method: 'DELETE' });
        currentWarehouseId = null; currentWarehouseName = null;
        const modalInstance = bootstrap.Modal.getInstance(document.getElementById('warehouseModal'));
        if (modalInstance) modalInstance.hide();
        await loadWarehouses(); await loadTagStats();
        document.getElementById('deviceList').innerHTML = `<div class="text-center text-muted py-5"><i class="bi bi-inbox" style="font-size: 48px;"></i><p class="mt-2">请先选择或创建一个仓库</p></div>`;
    } catch (e) { alert('删除失败: ' + e.message); }
}

// ============ 标签管理（Modal 中）============

let modalTags = []; // 当前编辑弹窗中的标签数组

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
    const allTags = collectAllTagNames();
    datalist.innerHTML = allTags.map(t => `<option value="${t}">`).join('');
}

// 渲染 Modal 中的标签 badges
function renderModalTagBadges() {
    const container = document.getElementById('deviceTagBadges');
    if (modalTags.length === 0) {
        container.innerHTML = '<span class="text-muted" style="font-size: 12px;">暂无标签</span>';
    } else {
        container.innerHTML = modalTags.map(tag => `
            <span class="tag-badge-editable">
                ${tag}
                <span class="tag-remove" onclick="removeTagFromDevice('${tag.replace(/'/g, "\\'")}')">&times;</span>
            </span>
        `).join('');
    }
}

// 添加标签
function addTagToDevice() {
    const input = document.getElementById('deviceTagInput');
    const tagName = input.value.trim();
    if (!tagName) return;
    if (modalTags.includes(tagName)) {
        alert('该标签已存在');
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

// 初始化 Modal 标签
function initModalTags(device) {
    if (device && (device.tag_names || device.tag_name)) {
        const tagField = (device.tag_names || device.tag_name || '').trim();
        if (tagField.startsWith('[')) {
            try { modalTags = JSON.parse(tagField); } catch (e) { modalTags = []; }
        } else if (tagField) {
            // 兼容旧格式：逗号分隔
            modalTags = tagField.split(',').map(t => t.trim()).filter(t => t);
        } else {
            modalTags = [];
        }
    } else {
        modalTags = [];
    }
    renderModalTagBadges();
    updateTagDatalist();
}

// 自动生成6位设备ID码
async function generateDeviceCode() {
    const input = document.getElementById('deviceIdCode');
    const btn = document.getElementById('btnGenerateDeviceCode');
    if (!input || !btn) return;

    // 编辑已有设备时不重新生成
    const deviceId = document.getElementById('deviceId').value;
    if (deviceId) {
        alert('已有设备ID不可重新生成');
        return;
    }

    btn.disabled = true;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span>';

    try {
        const res = await fetch(`${API_BASE}/devices/next-code`);
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || '生成失败');
        }
        const data = await res.json();
        input.value = data.code;
    } catch (e) {
        alert('生成设备ID失败: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

// 补全所有缺失 device_id 的旧设备
async function backfillDeviceCodes() {
    if (!confirm('将为所有缺少设备ID码的旧设备自动生成6位码，是否继续？')) return;

    const btn = document.getElementById('btnBackfillCodes');
    if (!btn) return;
    btn.disabled = true;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span> 补全中...';

    try {
        const res = await fetch(`${API_BASE}/devices/backfill-codes`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '补全失败');
        alert(data.message);
        loadDevices(); // 刷新列表
    } catch (e) {
        alert('补全设备ID失败: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

// ============ 设备操作 ============
function showDeviceModal(id = null) {
    if (warehouses.length === 0) { alert('请先创建仓库'); return; }
    const modal = new bootstrap.Modal(document.getElementById('deviceModal'));
    document.getElementById('deviceModalTitle').textContent = id ? '编辑设备' : '添加设备';
    updateWarehouseSelect();
    document.getElementById('deviceLocationStatus').onchange = function() { document.getElementById('destinationField').style.display = this.value === 'checked_out' ? 'block' : 'none'; };

    if (id) {
        const d = allDevices.find(dev => dev.id === id);
        document.getElementById('deviceId').value = d.id;
        document.getElementById('deviceIdCode').value = d.device_id || '';
        document.getElementById('deviceWarehouse').value = d.warehouse_name;
        document.getElementById('deviceName').value = d.name;
        document.getElementById('deviceQuantity').value = d.quantity;
        document.getElementById('deviceStorageLocation').value = d.storage_location || '';
        initModalTags(d);
        // 入库时间
        if (d.checkin_time) {
            document.getElementById('deviceCheckinTime').value = formatDate(d.checkin_time);
        } else {
            document.getElementById('deviceCheckinTime').value = '';
        }
        document.getElementById('deviceLocationStatus').value = d.location_status || 'in_stock';
        document.getElementById('deviceDestination').value = d.destination || '';
        document.getElementById('deviceStatus').value = d.status;
        document.getElementById('deviceRemark').value = d.remark || '';
        document.getElementById('deviceResponsiblePerson').value = d.responsible_person || '';
        // 到期日期
        if (d.expiry_date) {
            document.getElementById('deviceExpiryDate').value = formatDate(d.expiry_date);
        } else {
            document.getElementById('deviceExpiryDate').value = '';
        }
        document.getElementById('deviceRemarkEditor').innerHTML = decodeRichText(d.remark || '');
        document.getElementById('deleteDeviceBtn').style.display = 'block';
        document.getElementById('destinationField').style.display = (d.location_status === 'checked_out') ? 'block' : 'none';
    } else {
        document.getElementById('deviceId').value = '';
        document.getElementById('deviceIdCode').value = '';
        document.getElementById('deviceName').value = '';
        document.getElementById('deviceQuantity').value = 1;
        document.getElementById('deviceStorageLocation').value = '';
        initModalTags(null);
        // 新增设备默认入库时间为今天
        document.getElementById('deviceCheckinTime').value = formatDate(new Date());
        document.getElementById('deviceLocationStatus').value = 'in_stock';
        document.getElementById('deviceDestination').value = '';
        document.getElementById('deviceStatus').value = '正常';
        document.getElementById('deviceRemark').value = '';
        document.getElementById('deviceResponsiblePerson').value = '';
        document.getElementById('deviceExpiryDate').value = '';
        document.getElementById('deviceRemarkEditor').innerHTML = '';
        document.getElementById('deleteDeviceBtn').style.display = 'none';
        document.getElementById('destinationField').style.display = 'none';
        if (currentWarehouseName) document.getElementById('deviceWarehouse').value = currentWarehouseName;
        // 自动生成设备ID码
        generateDeviceCode();
    }
    modal.show();
    
    // 添加键盘事件监听
    setupDeviceModalKeyboardEvents();

    // 添加富文本编辑器的按键事件监听，确保换行正确
    const remarkEditor = document.getElementById('deviceRemarkEditor');
    if (remarkEditor) {
        remarkEditor.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                // 确保插入 <br> 而不是 <div> 或 <p>
                e.preventDefault();
                const selection = window.getSelection();
                const range = selection.getRangeAt(0);
                const br = document.createElement('br');
                range.deleteContents();
                range.insertNode(br);
                range.setStartAfter(br);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        });

        // 双击图片全屏查看
        remarkEditor.addEventListener('dblclick', function(e) {
            if (e.target.tagName === 'IMG') {
                e.preventDefault();
                showImageFullscreen(e.target.src);
            }
        });
    }
}

// 设置设备模态框的键盘事件
function setupDeviceModalKeyboardEvents() {
    const modalElement = document.getElementById('deviceModal');
    
    // 移除之前的事件监听器（避免重复绑定）
    modalElement.removeEventListener('keydown', handleDeviceModalKeydown);
    
    // 添加新的事件监听器
    modalElement.addEventListener('keydown', handleDeviceModalKeydown);
}

// 处理设备模态框的键盘事件
function handleDeviceModalKeydown(event) {
    // 如果焦点在备注编辑器中
    if (event.target.id === 'deviceRemarkEditor') {
        // 处理占位符
        if (event.target.textContent.trim() === '') {
            event.target.innerHTML = '';
        }
        // Ctrl+Enter 保存
        if (event.ctrlKey && event.key === 'Enter') {
            event.preventDefault();
            saveDevice();
        }
        // 普通回车键允许换行（不阻止默认行为）
        return;
    }

    // 焦点在标签输入框中时，回车添加标签
    if (event.target.id === 'deviceTagInput') {
        return;
    }

    // 在其他输入框中，回车键保存
    if (event.key === 'Enter') {
        event.preventDefault();
        saveDevice();
    }
}

// 显示设备详情
async function showDeviceDetail(deviceIdRef) {
    if (!deviceIdRef) {
        alert('设备ID无效');
        return;
    }
    // 优先使用设备ID码（6位码），否则使用数据库ID
    window.location.href = `/device.html?device_id=${deviceIdRef}`;
}

function editDevice(id) { showDeviceModal(id); }

async function saveDevice() {
    const id = document.getElementById('deviceId').value;
    const location_status = document.getElementById('deviceLocationStatus').value;
    const destination = location_status === 'checked_out' ? document.getElementById('deviceDestination').value : '';
    const checkinTimeInput = document.getElementById('deviceCheckinTime').value;
    const expiryDateInput = document.getElementById('deviceExpiryDate').value;
    const remarkEditor = document.getElementById('deviceRemarkEditor');

    // 解析日期输入
    const checkinTime = parseDateInput(checkinTimeInput);
    const expiryDate = parseDateInput(expiryDateInput);

    const data = {
        device_id: document.getElementById('deviceIdCode')?.value || '',
        warehouseName: document.getElementById('deviceWarehouse').value,
        name: document.getElementById('deviceName').value,
        tag_names: getDeviceTagsJSON(),
        quantity: parseInt(document.getElementById('deviceQuantity').value),
        storage_location: document.getElementById('deviceStorageLocation').value,
        location_status: location_status,
        destination: destination,
        status: document.getElementById('deviceStatus').value,
        remark: encodeRichText(remarkEditor ? remarkEditor.innerHTML : ''),
        checkin_time: checkinTime ? checkinTime + ' ' + new Date().toTimeString().slice(0,8) : null,
        expiry_date: expiryDate,
        responsible_person: document.getElementById('deviceResponsiblePerson')?.value || ''
    };

    if (!data.name) { alert('请输入设备名称'); return; }

    try {
        let res;
        if (id) {
            res = await fetch(`${API_BASE}/devices/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        } else {
            res = await fetch(`${API_BASE}/devices`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        }

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`HTTP ${res.status}: ${errorText}`);
        }

        bootstrap.Modal.getInstance(document.getElementById('deviceModal')).hide();
        await loadDevices(); await loadWarehouses(); await loadTagStats();

        // 清除URL中的edit参数，避免重新加载时自动打开编辑弹窗
        if (window.location.search.includes('edit=')) {
            const newUrl = window.location.pathname;
            window.history.replaceState({}, document.title, newUrl);
        }
    } catch (e) {
        console.error('保存失败:', e);
        alert('保存失败: ' + e.message);
    }
}

async function deleteDevice() {
    if (!confirm('确定要删除该设备吗？')) return;
    const id = document.getElementById('deviceId').value;
    try {
        await fetch(`${API_BASE}/devices/${id}`, { method: 'DELETE' });
        bootstrap.Modal.getInstance(document.getElementById('deviceModal')).hide();
        await loadDevices(); await loadWarehouses(); await loadTagStats();

        // 清除URL中的edit参数，避免重新加载时自动打开编辑弹窗
        if (window.location.search.includes('edit=')) {
            const newUrl = window.location.pathname;
            window.history.replaceState({}, document.title, newUrl);
        }
    } catch (e) { alert('删除失败: ' + e.message); }
}

// 从设备列表直接删除
async function deleteDeviceFromList(id, name) {
    if (!confirm(`确定要删除设备"${name}"吗？`)) return;
    try {
        await fetch(`${API_BASE}/devices/${id}`, { method: 'DELETE' });
        await loadDevices(); await loadWarehouses(); await loadTagStats();
    } catch (e) { alert('删除失败: ' + e.message); }
}

// ============ 备注图片功能 ============

// 双击图片全屏查看
function showImageFullscreen(src) {
    // 移除已有的全屏层
    const existing = document.querySelector('.image-fullscreen-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'image-fullscreen-overlay';
    overlay.innerHTML = `
        <div class="image-fullscreen-close"><i class="bi bi-x-lg"></i></div>
        <img src="${src}" class="image-fullscreen-img" />
    `;
    overlay.addEventListener('click', () => overlay.remove());
    overlay.querySelector('.image-fullscreen-img').addEventListener('click', (e) => e.stopPropagation());

    document.addEventListener('keydown', function onEsc(e) {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', onEsc);
        }
    });

    document.body.appendChild(overlay);
}



// ========== 图片管理（popup选择框 + 已有图片浏览弹窗） ==========

let _imageUploadDeviceId = null;
let _tablePickerOutsideHandler = null;
let _imageTargetEditorId = 'deviceRemarkEditor';
let _selectedImages = new Set();
let _existingImages = [];

// 打开图片选择 popup（定位到按钮位置）
function insertImageToRemark(deviceId, editorId) {
    _imageUploadDeviceId = deviceId;
    _imageTargetEditorId = editorId || 'deviceRemarkEditor';
    _selectedImages = new Set();

    const fileInput = document.getElementById('imagePickerFileInput');
    if (fileInput) fileInput.value = '';

    const popup = document.getElementById('imageInsertPopup');
    if (!popup) return;

    // 获取触发按钮的位置（兼容全局 event 和代码直接调用）
    const evt = (typeof event !== 'undefined') ? event : null;
    const btn = (evt && evt.target && evt.target.closest('button')) || document.activeElement;
    if (btn) {
        const rect = btn.getBoundingClientRect();
        // 先暂时显示以便测量高度
        popup.style.display = '';
        popup.style.visibility = 'hidden';
        const popupH = popup.offsetHeight;
        popup.style.visibility = '';

        popup.style.left = (rect.left + rect.width / 2) + 'px';
        // 弹窗显示在按钮上方
        popup.style.top = (rect.top - popupH - 8) + 'px';
        popup.style.transform = 'translateX(-50%)';
    }

    popup.style.display = '';

    // 点击外部关闭
    setTimeout(() => {
        document.addEventListener('click', _closeImagePopupOnOutside, { once: true });
    }, 0);
}

function _closeImagePopupOnOutside(e) {
    const popup = document.getElementById('imageInsertPopup');
    if (popup && !popup.contains(e.target)) {
        closeImageInsertPopup();
    } else if (popup) {
        // 如果点击的是popup内部，重新监听
        document.addEventListener('click', _closeImagePopupOnOutside, { once: true });
    }
}

// 关闭popup
function closeImageInsertPopup() {
    const popup = document.getElementById('imageInsertPopup');
    if (popup) popup.style.display = 'none';
}

// 触发文件上传
function triggerImageUpload() {
    document.getElementById('imagePickerFileInput').click();
}

// 打开已有图片浏览弹窗
function openImageBrowser() {
    _selectedImages = new Set();
    loadExistingImages(_imageUploadDeviceId);
    new bootstrap.Modal(document.getElementById('imageBrowserModal')).show();
}

// 加载已有图片列表
async function loadExistingImages(deviceId) {
    const container = document.getElementById('imageGridContainer');
    if (!container) return;

    if (!deviceId || deviceId === '0') {
        container.innerHTML = `
            <div class="image-empty-state">
                <i class="bi bi-inbox d-block"></i>
                <p>保存设备后可查看已有图片</p>
            </div>`;
        updateImageSelectionUI();
        return;
    }

    container.innerHTML = `
        <div class="image-empty-state">
            <i class="bi bi-hourglass-split d-block"></i>
            <p>加载中...</p>
        </div>`;

    try {
        const res = await fetch(`${API_BASE}/images/list/${deviceId}`);
        const data = await res.json();
        if (data.success) {
            _existingImages = data.images || [];
            renderImageGrid(_existingImages);
        } else {
            throw new Error(data.error || '加载失败');
        }
    } catch (err) {
        container.innerHTML = `
            <div class="image-empty-state">
                <i class="bi bi-exclamation-triangle d-block"></i>
                <p>加载失败: ${err.message}</p>
            </div>`;
    }
}

// 渲染图片网格
function renderImageGrid(images) {
    _selectedImages = new Set();
    const container = document.getElementById('imageGridContainer');
    if (!container) return;

    if (!images || images.length === 0) {
        container.innerHTML = `
            <div class="image-empty-state">
                <i class="bi bi-camera d-block"></i>
                <p>暂无图片，请先上传</p>
            </div>`;
        updateImageSelectionUI();
        return;
    }

    container.innerHTML = `
        <div class="image-grid">
            ${images.map(img => `
                <div class="image-grid-item" data-filename="${escapeHtml(img.filename)}" onclick="toggleImageSelection('${escapeHtml(img.filename)}')">
                    <img src="${img.url}" alt="${escapeHtml(img.filename)}" loading="lazy"
                         onerror="this.parentElement.style.display='none'">
                    <button class="delete-btn" title="删除此图片"
                            onclick="event.stopPropagation(); deleteSingleImage('${escapeHtml(img.filename)}')">
                        <i class="bi bi-x"></i>
                    </button>
                    <div class="select-check"><i class="bi bi-check-lg"></i></div>
                    <div class="file-info">
                        <span class="file-name">${truncateFilename(img.filename, 18)}</span>
                        <span class="file-size">${formatFileSize(img.size)}</span>
                    </div>
                </div>
            `).join('')}
        </div>`;
    updateImageSelectionUI();
}

// 切换单张图片选中状态
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

// 插入选中图片到编辑器
function insertSelectedImages() {
    if (_selectedImages.size === 0) return;

    const remarkEditor = document.getElementById(_imageTargetEditorId);
    if (!remarkEditor) return;

    _selectedImages.forEach(filename => {
        const img = _existingImages.find(i => i.filename === filename);
        if (img) {
            const imgId = 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
            const imgTag = `<img id="${imgId}" src="${img.url}" style="max-width: 100%; height: auto; margin: 8px 0; border-radius: 4px; border: 1px solid #dee2e6;" onerror="this.style.display='none'; this.insertAdjacentHTML('afterend', '<span style=\\'color:#dc3545;font-size:12px;\\'>[图片加载失败: ' + this.src + ']</span>');" />`;
            insertHTMLAtCursor(remarkEditor, imgTag);
        }
    });

    bootstrap.Modal.getInstance(document.getElementById('imageBrowserModal')).hide();
}

// 上传新图片
// 图片上传进度条样式（注入页面）
const UPLOAD_PROGRESS_CSS = `
#imgUploadProgressCss{display:none}
.img-upload-progress{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;margin:4px 0;background:rgba(0,0,0,0.03);border-radius:6px;}
.img-upload-progress-bar-outer{flex-shrink:0;width:180px;height:8px;background:#e9ecef;border-radius:4px;overflow:hidden;}
.img-upload-progress-bar-inner{display:block;height:100%;width:0;background:linear-gradient(90deg,#0d6efd,#6610f2);border-radius:4px;transition:width 0.2s;}
.img-upload-progress-text{color:#6c757d;font-size:12px;white-space:nowrap;min-width:32px;}
.img-upload-progress-done{color:#198754;font-size:12px;}
.img-upload-progress-error{color:#dc3545;font-size:12px;}
`;
if (!document.getElementById('imgUploadProgressCss')) {
    const style = document.createElement('style');
    style.id = 'imgUploadProgressCss';
    style.textContent = UPLOAD_PROGRESS_CSS;
    document.head.appendChild(style);
}

function handleImagePickerUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const deviceId = _imageUploadDeviceId;

    if (file.size > 5 * 1024 * 1024) {
        alert('图片大小不能超过5MB');
        event.target.value = '';
        return;
    }

    const remarkEditor = document.getElementById(_imageTargetEditorId);
    const progressId = 'imgUploadProg_' + Date.now();

    // 在编辑器光标位置插入进度条
    if (remarkEditor) {
        const progressHtml = `<div id="${progressId}" class="img-upload-progress">
            <span class="img-upload-progress-bar-outer">
                <span id="${progressId}_bar" class="img-upload-progress-bar-inner"></span>
            </span>
            <span id="${progressId}_text" class="img-upload-progress-text">0%</span>
        </div>`;
        insertHTMLAtCursor(remarkEditor, progressHtml);
    }

    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('image', file);
    formData.append('deviceId', deviceId || '0');

    xhr.open('POST', `${API_BASE}/upload/image`);

    xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            const bar = document.getElementById(progressId + '_bar');
            const text = document.getElementById(progressId + '_text');
            if (bar) bar.style.width = pct + '%';
            if (text) text.textContent = pct + '%';
        }
    };

    xhr.onload = function () {
        const progEl = document.getElementById(progressId);
        if (xhr.status >= 200 && xhr.status < 300) {
            try {
                const data = JSON.parse(xhr.responseText);
                if (progEl) progEl.remove();

                if (remarkEditor) {
                    const imgId = 'img_' + Date.now();
                    const imgTag = `<img id="${imgId}" src="${data.url}" style="max-width: 100%; height: auto; margin: 8px 0; border-radius: 4px; border: 1px solid #dee2e6;" onerror="this.style.display='none'; this.insertAdjacentHTML('afterend', '<span style=\\'color:#dc3545;font-size:12px;\\'>[图片加载失败: ' + this.src + ']</span>');" />`;
                    insertHTMLAtCursor(remarkEditor, imgTag);
                }
            } catch (e) {
                if (progEl && progEl.querySelector) {
                    const textEl = progEl.querySelector('.img-upload-progress-text');
                    if (textEl) { textEl.textContent = '解析失败'; textEl.className = 'img-upload-progress-error'; }
                }
            }
        } else {
            if (progEl && progEl.querySelector) {
                const textEl = progEl.querySelector('.img-upload-progress-text');
                if (textEl) { textEl.textContent = '上传失败'; textEl.className = 'img-upload-progress-error'; }
            }
            try {
                const err = JSON.parse(xhr.responseText);
                console.error('图片上传失败:', err.error || xhr.status);
            } catch (_) { }
        }
        event.target.value = '';
    };

    xhr.onerror = function () {
        const progEl = document.getElementById(progressId);
        if (progEl && progEl.querySelector) {
            const textEl = progEl.querySelector('.img-upload-progress-text');
            if (textEl) { textEl.textContent = '网络错误'; textEl.className = 'img-upload-progress-error'; }
        }
        event.target.value = '';
    };

    xhr.send(formData);
}

// 删除单个图片
async function deleteSingleImage(filename) {
    if (!confirm(`确定要删除图片 "${filename}" 吗？此操作不可撤销。`)) return;

    try {
        const res = await fetch(`${API_BASE}/images/${_imageUploadDeviceId}/${encodeURIComponent(filename)}`, {
            method: 'DELETE',
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || '删除失败');

        _existingImages = _existingImages.filter(i => i.filename !== filename);
        _selectedImages.delete(filename);
        renderImageGrid(_existingImages);
    } catch (err) {
        alert('删除失败: ' + err.message);
    }
}

// 批量删除选中图片
async function deleteSelectedImages() {
    if (_selectedImages.size === 0) return;

    const count = _selectedImages.size;
    if (!confirm(`确定要删除选中的 ${count} 张图片吗？此操作不可撤销。`)) return;

    let failed = 0;
    const toDelete = [..._selectedImages];

    for (const filename of toDelete) {
        try {
            const res = await fetch(`${API_BASE}/images/${_imageUploadDeviceId}/${encodeURIComponent(filename)}`, {
                method: 'DELETE',
            });
            const data = await res.json();
            if (data.success) {
                _existingImages = _existingImages.filter(i => i.filename !== filename);
                _selectedImages.delete(filename);
            } else {
                failed++;
            }
        } catch (err) {
            failed++;
        }
    }

    renderImageGrid(_existingImages);
    if (failed > 0) {
        alert(`删除完成，但有 ${failed} 张图片删除失败。`);
    }
}

// 更新选中状态UI
function updateImageSelectionUI() {
    const btnInsert = document.getElementById('btnInsertSelectedImages');
    const btnDelete = document.getElementById('btnDeleteSelectedImages');
    const countEl = document.getElementById('imageSelectionCount');

    if (btnInsert) btnInsert.disabled = _selectedImages.size === 0;
    if (btnDelete) btnDelete.disabled = _selectedImages.size === 0;
    if (countEl) {
        countEl.textContent = _selectedImages.size > 0
            ? `已选 ${_selectedImages.size} 张`
            : '';
    }
}

// 辅助：HTML转义
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// 在 contenteditable 编辑器光标位置插入 HTML（无光标时追加到末尾）
function insertHTMLAtCursor(editor, html) {
    editor.focus();
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        // 确保光标在 editor 内部
        if (editor.contains(range.commonAncestorContainer)) {
            range.deleteContents();
            const fragment = range.createContextualFragment(html);
            range.insertNode(fragment);
            // 将光标移到插入内容之后
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
            return;
        }
    }
    // fallback: 追加到末尾
    editor.innerHTML += html;
}

// 辅助：截断文件名
function truncateFilename(name, maxLen) {
    if (name.length <= maxLen) return name;
    const ext = name.lastIndexOf('.');
    if (ext > 0) {
        const extStr = name.slice(ext);
        const base = name.slice(0, ext);
        return base.slice(0, maxLen - extStr.length - 2) + '..' + extStr;
    }
    return name.slice(0, maxLen - 2) + '..';
}

// 辅助：格式化文件大小
function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) {
        size /= 1024;
        i++;
    }
    return size.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

function formatRemarkWithImages(remark) {
    if (!remark) return '';
    // 将 [图片:base64] 替换为 img 标签
    return remark.replace(/\[图片:([^\]]+)\]/g, function(match, base64) {
        return `<img src="${base64}" style="max-width: 100%; height: auto; margin: 8px 0; border-radius: 4px; border: 1px solid #dee2e6;" />`;
    });
}

// ============ 富文本编辑功能 ============
function openRichTextEditor() {
    const remarkEditor = document.getElementById('deviceRemarkEditor');
    const richTextEditor = document.getElementById('richTextEditor');

    if (!remarkEditor || !richTextEditor) {
        alert('无法打开编辑器：找不到相关元素');
        return;
    }

    // 直接从主富文本编辑器加载内容
    richTextEditor.innerHTML = remarkEditor.innerHTML;

    // 双击图片全屏查看
    richTextEditor.addEventListener('dblclick', function(e) {
        if (e.target.tagName === 'IMG') {
            e.preventDefault();
            showImageFullscreen(e.target.src);
        }
    });

    new bootstrap.Modal(document.getElementById('richTextEditorModal')).show();
}

// 将富文本HTML转换为可存储的文本格式
function encodeRichText(html) {
    if (!html) return '';

    // 创建临时元素来处理 HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    // 递归处理节点，将格式转换为 BBCode 标记
    function processNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const tagName = node.tagName.toLowerCase();
            let content = '';

            // 递归处理子节点
            for (let child of node.childNodes) {
                content += processNode(child);
            }

            // 根据标签类型添加格式标记
            switch (tagName) {
                case 'b':
                case 'strong':
                    return `[B]${content}[/B]`;
                case 'i':
                case 'em':
                    return `[I]${content}[/I]`;
                case 'u':
                    return `[U]${content}[/U]`;
                case 's':
                case 'strike':
                case 'del':
                    return `[S]${content}[/S]`;
                case 'font':
                    let color = node.getAttribute('color');
                    let size = node.getAttribute('size');
                    let fontBgColor = node.style.backgroundColor || node.getAttribute('style')?.match(/background-color:\s*([^;]+)/)?.[1]?.trim();
                    if (fontBgColor) {
                        return `[HIGHLIGHT=${fontBgColor}]${content}[/HIGHLIGHT]`;
                    }
                    if (color) {
                        return `[COLOR=${color}]${content}[/COLOR]`;
                    } else if (size) {
                        return `[SIZE=${size}]${content}[/SIZE]`;
                    }
                    return content;
                case 'span':
                    let spanBgColor = node.style.backgroundColor || node.getAttribute('style')?.match(/background-color:\s*([^;]+)/)?.[1]?.trim();
                    if (spanBgColor) {
                        return `[HIGHLIGHT=${spanBgColor}]${content}[/HIGHLIGHT]`;
                    }
                    return content;
                case 'br':
                    return '\n';
                case 'div':
                case 'p':
                    return content + '\n';
                case 'img':
                    // 保留图片标签
                    return node.outerHTML;
                case 'table':
                case 'thead':
                case 'tbody':
                case 'tfoot':
                case 'tr':
                case 'th':
                case 'td':
                    // 保留表格结构
                    return node.outerHTML;
                default:
                    return content;
            }
        }
        return '';
    }

    let text = '';
    for (let child of tempDiv.childNodes) {
        text += processNode(child);
    }

    // 处理 HTML 实体
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&amp;/g, '&');

    // 清理多余的空行
    text = text.replace(/\n{3,}/g, '\n\n');

    return text.trim();
}

// ========== 公告相关功能 ==========

// 加载公告列表
async function loadAnnouncements() {
    try {
        const response = await fetch(`${API_BASE}/announcements`);
        const data = await response.json();
        if (data.success) {
            announcements = data.data || [];
            renderAnnouncements();
            updateAnnouncementBadge();
        }
    } catch (error) {
        console.error('加载公告失败:', error);
    }
}

// 渲染公告列表
function renderAnnouncements() {
    const announcementList = document.getElementById('announcementList');
    const announcementBar = document.getElementById('announcementBar');

    // 过滤未被关闭的公告
    const visibleAnnouncements = announcements.filter(a => !dismissedAnnouncements.has(a.id));

    // 没有公告
    if (visibleAnnouncements.length === 0) {
        announcementList.innerHTML = '<div class="text-center py-3 text-muted" style="font-size: 13px;">暂无公告</div>';
        if (window.innerWidth <= 768) {
            announcementBar.classList.remove('collapsed');
        }
        return;
    }

    // 按时间排序，最新的在前面
    visibleAnnouncements.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // 渲染公告列表
    announcementList.innerHTML = visibleAnnouncements.map(announcement => `
        <div class="announcement-item" data-id="${announcement.id}">
            <div class="announcement-content">
                <span class="announcement-time">${formatTime(announcement.created_at)}</span>
                <span class="announcement-text" onclick="toggleAnnouncementText(this)" title="点击展开/收起">${escapeHtml(announcement.content)}</span>
            </div>
            <button class="announcement-close" onclick="dismissAnnouncement(${announcement.id})">
                <i class="bi bi-x"></i>
            </button>
        </div>
    `).join('');
}

// 关闭公告
function dismissAnnouncement(announcementId) {
    dismissedAnnouncements.add(announcementId);
    localStorage.setItem('dismissedAnnouncements', JSON.stringify([...dismissedAnnouncements]));
    renderAnnouncements();
    updateAnnouncementBadge();
}

// 更新公告按钮角标
function updateAnnouncementBadge() {
    const badge = document.getElementById('announcementBtnBadge');
    const mobileBadge = document.getElementById('mobileAnnouncementBadge');
    const visibleAnnouncements = announcements.filter(a => !dismissedAnnouncements.has(a.id));

    if (visibleAnnouncements.length > 0) {
        badge.textContent = visibleAnnouncements.length;
        badge.style.display = 'inline-flex';
        mobileBadge.textContent = visibleAnnouncements.length;
        mobileBadge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
        mobileBadge.style.display = 'none';
    }
}

// 显示新增公告模态框
function showAnnouncementModal() {
    document.getElementById('announcementContent').value = '';
    new bootstrap.Modal(document.getElementById('announcementModal')).show();
}

// 保存公告
async function saveAnnouncement() {
    const content = document.getElementById('announcementContent').value.trim();
    if (!content) {
        alert('请输入公告内容');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/announcements`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        const data = await response.json();
        if (data.success) {
            await loadAnnouncements();
            bootstrap.Modal.getInstance(document.getElementById('announcementModal')).hide();
            alert('公告发布成功！');
        } else {
            alert('发布失败：' + (data.error || '未知错误'));
        }
    } catch (error) {
        alert('发布失败：' + error.message);
    }
}

// 切换公告文本展开/收起
function toggleAnnouncementText(element) {
    element.classList.toggle('expanded');
}

// 移动端：切换公告列表显示
function toggleAnnouncementBar() {
    const announcementBar = document.getElementById('announcementBar');
    announcementBar.classList.toggle('collapsed');
}

// 切换公告栏显示/隐藏
function toggleAnnouncementBar() {
    const announcementBar = document.getElementById('announcementBar');
    announcementBar.classList.toggle('hidden');
}

// HTML转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 将存储的富文本标记转换回 HTML
function decodeRichText(text) {
    if (!text) return '';

    // 将转义的换行符和实际换行转换为 <br>
    let html = text.replace(/\\n/g, '<br>').replace(/\n/g, '<br>');

    // 解析富文本标记
    html = html.replace(/\[B\]([\s\S]*?)\[\/B\]/gi, '<b>$1</b>');
    html = html.replace(/\[I\]([\s\S]*?)\[\/I\]/gi, '<i>$1</i>');
    html = html.replace(/\[U\]([\s\S]*?)\[\/U\]/gi, '<u>$1</u>');
    html = html.replace(/\[S\]([\s\S]*?)\[\/S\]/gi, '<s>$1</s>');
    html = html.replace(/\[COLOR=([^\]]+)\]([\s\S]*?)\[\/COLOR\]/gi, '<font color="$1">$2</font>');
    html = html.replace(/\[HIGHLIGHT=([^\]]+)\]([\s\S]*?)\[\/HIGHLIGHT\]/gi, '<span style="background-color:$1;">$2</span>');
    html = html.replace(/\[SIZE=([^\]]+)\]([\s\S]*?)\[\/SIZE\]/gi, '<font size="$1">$2</font>');

    // 确保连续的换行被正确处理
    html = html.replace(/(<br>\s*){2,}/g, '<br><br>');

    // 将旧代理URL 替换为 S3 公开URL
    if (window.S3_PUBLIC_URL) {
        html = html.replace(/\/api\/images\/(\d+)\/([^"'>\s]+)/gi,
            window.S3_PUBLIC_URL + '/images/$1/$2');
    }

    // 为已有 <img> 标签添加加载错误提示（避免重复添加）
    html = html.replace(/<img([^>]*)>/gi, function(match, attrs) {
        if (attrs.includes('onerror')) return match;
        return `<img${attrs} onerror="this.style.display='none'; this.insertAdjacentHTML('afterend', '<span style=color:#dc3545;font-size:12px;>[图片加载失败: ' + this.src + ']</span>');">`;
    });

    return html;
}

// 将富文本转换为单行预览（用于列表显示，移除换行）
function decodeRichTextToSingleLine(text) {
    if (!text) return '';

    // 将换行符替换为空格
    let html = text.replace(/\n/g, ' ');

    // 解析富文本标记
    html = html.replace(/\[B\]([\s\S]*?)\[\/B\]/gi, '<b>$1</b>');
    html = html.replace(/\[I\]([\s\S]*?)\[\/I\]/gi, '<i>$1</i>');
    html = html.replace(/\[U\]([\s\S]*?)\[\/U\]/gi, '<u>$1</u>');
    html = html.replace(/\[S\]([\s\S]*?)\[\/S\]/gi, '<s>$1</s>');
    html = html.replace(/\[COLOR=([^\]]+)\]([\s\S]*?)\[\/COLOR\]/gi, '<font color="$1">$2</font>');
    html = html.replace(/\[HIGHLIGHT=([^\]]+)\]([\s\S]*?)\[\/HIGHLIGHT\]/gi, '<span style="background-color:$1;">$2</span>');
    html = html.replace(/\[SIZE=([^\]]+)\]([\s\S]*?)\[\/SIZE\]/gi, '<font size="$1">$2</font>');

    // 移除多余的空格
    html = html.replace(/\s+/g, ' ').trim();

    return html;
}

// 剥离富文本标记，返回纯文本（用于工具提示等场景）
function stripRichText(text) {
    if (!text) return '';
    return text.replace(/\[B\]|\[\/B\]|\[I\]|\[\/I\]|\[U\]|\[\/U\]|\[S\]|\[\/S\]/gi, '')
               .replace(/\[COLOR=[^\]]+\]|\[\/COLOR\]/gi, '')
               .replace(/\[HIGHLIGHT=[^\]]+\]|\[\/HIGHLIGHT\]/gi, '')
               .replace(/\[SIZE=[^\]]+\]|\[\/SIZE\]/gi, '')
               .replace(/\[图片:[^\]]+\]/g, '[图片]')
               .replace(/\n/g, ' ')
               .replace(/\s+/g, ' ')
               .trim();
}

// 备注悬停气泡 (body 级别，绕过 overflow 裁剪)
let _remarkTooltipEl = null;
let _remarkTooltipTimer = null;
let _remarkTouchHideTimer = null;

function _ensureRemarkTooltipEl() {
    if (!_remarkTooltipEl) {
        _remarkTooltipEl = document.createElement('div');
        _remarkTooltipEl.className = 'remark-body-tooltip';
        document.body.appendChild(_remarkTooltipEl);

        // 鼠标进入气泡时，取消关闭
        _remarkTooltipEl.addEventListener('mouseenter', () => {
            clearTimeout(_remarkTooltipTimer);
            clearTimeout(_remarkTouchHideTimer);
        });

        // 鼠标离开气泡时，关闭
        _remarkTooltipEl.addEventListener('mouseleave', () => {
            hideRemarkTooltip();
        });
    }
    return _remarkTooltipEl;
}

function showRemarkTooltip(e, text) {
    // 清除之前的延迟关闭计时器
    clearTimeout(_remarkTooltipTimer);
    clearTimeout(_remarkTouchHideTimer);

    _ensureRemarkTooltipEl();

    // 始终更新内容（切换不同备注项时也能刷新）
    _remarkTooltipEl.innerHTML = decodeRichText(text);

    // 基于鼠标位置定位，偏移 12px
    let left = e.clientX + 12;
    let top = e.clientY - 10;

    const tipWidth = _remarkTooltipEl.offsetWidth;
    const tipHeight = _remarkTooltipEl.offsetHeight;

    // 右侧溢出则显示在光标左侧
    if (left + tipWidth > window.innerWidth - 8) {
        left = e.clientX - tipWidth - 12;
    }
    // 下方溢出则显示在光标上方
    if (top + tipHeight > window.innerHeight - 8) {
        top = e.clientY - tipHeight - 10;
    }
    // 兜底
    if (left < 8) left = 8;
    if (top < 8) top = 8;

    _remarkTooltipEl.style.left = left + 'px';
    _remarkTooltipEl.style.top = top + 'px';
    _remarkTooltipEl.style.display = 'block';
}


// 延迟关闭（允许鼠标从图标滑入气泡）
function scheduleHideRemarkTooltip() {
    _remarkTooltipTimer = setTimeout(() => {
        hideRemarkTooltip();
    }, 250);
}

function hideRemarkTooltip() {
    clearTimeout(_remarkTooltipTimer);
    clearTimeout(_remarkTouchHideTimer);
    if (_remarkTooltipEl) {
        _remarkTooltipEl.remove();
        _remarkTooltipEl = null;
    }
}

// 执行富文本命令
function execCmd(command, value = null) {
    document.execCommand(command, false, value);
}

// ============ 表格插入功能 ============
let _tablePickerRows = 6;
let _tablePickerCols = 6;

function showTablePicker(btn) {
    const existing = document.querySelector('.table-picker-popup');
    if (existing) {
        existing.remove();
        return;
    }

    const rect = btn.getBoundingClientRect();
    const popup = document.createElement('div');
    popup.className = 'table-picker-popup';
    popup.style.position = 'fixed';
    popup.style.left = rect.left + 'px';
    popup.style.top = (rect.bottom + 4) + 'px';

    let html = '<div class="table-picker-label" id="tablePickerLabel">1 × 1 表格</div><div class="table-picker-grid">';
    for (let r = 0; r < _tablePickerRows; r++) {
        for (let c = 0; c < _tablePickerCols; c++) {
            html += `<div class="table-picker-cell" data-row="${r}" data-col="${c}"></div>`;
        }
    }
    html += '</div>';
    popup.innerHTML = html;

    // hover 高亮
    const cells = popup.querySelectorAll('.table-picker-cell');
    const label = popup.querySelector('#tablePickerLabel');
    let selectedRows = 0, selectedCols = 0;

    cells.forEach(cell => {
        cell.addEventListener('mouseenter', function() {
            const r = parseInt(this.dataset.row);
            const c = parseInt(this.dataset.col);
            selectedRows = r + 1;
            selectedCols = c + 1;
            label.textContent = `${selectedRows} × ${selectedCols} 表格`;
            cells.forEach(cell2 => {
                const r2 = parseInt(cell2.dataset.row);
                const c2 = parseInt(cell2.dataset.col);
                cell2.classList.toggle('active', r2 <= r && c2 <= c);
            });
        });
        cell.addEventListener('click', function() {
            const r = parseInt(this.dataset.row) + 1;
            const c = parseInt(this.dataset.col) + 1;
            popup.remove();
            insertTableHtml(r, c);
            document.removeEventListener('click', _tablePickerOutsideHandler);
        });
    });

    document.body.appendChild(popup);

    // 点击外部关闭
    _tablePickerOutsideHandler = function(e) {
        if (!popup.contains(e.target) && e.target !== btn) {
            popup.remove();
            document.removeEventListener('click', _tablePickerOutsideHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', _tablePickerOutsideHandler), 0);
}

function insertTableHtml(rows, cols) {
    let html = '<div style="overflow-x:auto;margin:8px 0;">';
    html += '<table style="border-collapse:collapse;width:100%;min-width:300px;border:1px solid #dee2e6;">';
    html += '<thead>';
    html += '<tr>';
    for (let c = 0; c < cols; c++) {
        html += '<th style="border:1px solid #dee2e6;padding:6px 10px;background:#f8f9fa;font-weight:600;text-align:left;min-width:60px;">&nbsp;</th>';
    }
    html += '</tr>';
    html += '</thead>';
    html += '<tbody>';
    for (let r = 1; r < rows; r++) {
        html += '<tr>';
        for (let c = 0; c < cols; c++) {
            html += '<td style="border:1px solid #dee2e6;padding:6px 10px;min-width:60px;">&nbsp;</td>';
        }
        html += '</tr>';
    }
    html += '</tbody>';
    html += '</table>';
    html += '</div>';
    execCmd('insertHTML', html);
}

// 色板颜色配置 - 9x9 统一色板
const SWATCH_COLORS = [
    // Row 1: 灰度
    '#FFFFFF', '#E6E6E6', '#CCCCCC', '#B3B3B3', '#999999', '#808080', '#666666', '#4D4D4D', '#000000',
    // Row 2: 红
    '#800000', '#A52A2A', '#B22222', '#DC143C', '#FF0000', '#FF3333', '#FF6666', '#FF8C69', '#FFA07A',
    // Row 3: 橙
    '#D2691E', '#FF4500', '#FF6600', '#FF8C00', '#FFA500', '#FFD700', '#FFCC00', '#DAA520', '#B8860B',
    // Row 4: 黄绿
    '#FFFF00', '#CCCC00', '#9ACD32', '#7FFF00', '#00FF00', '#32CD32', '#228B22', '#008000', '#006400',
    // Row 5: 绿
    '#00B050', '#2E8B57', '#3CB371', '#66CDAA', '#8FBC8F', '#90EE90', '#98FB98', '#ADFF2F', '#556B2F',
    // Row 6: 青
    '#00FFFF', '#00CED1', '#20B2AA', '#008B8B', '#008080', '#5F9EA0', '#7FFFD4', '#E0FFFF', '#B0E0E6',
    // Row 7: 蓝
    '#0070C0', '#0000FF', '#0000CD', '#00008B', '#1E90FF', '#4169E1', '#6495ED', '#87CEEB', '#B0C4DE',
    // Row 8: 紫
    '#8A2BE2', '#9400D3', '#800080', '#4B0082', '#6A5ACD', '#BA55D3', '#DA70D6', '#DDA0DD', '#E6E6FA',
    // Row 9: 暖/粉
    '#8B4513', '#CD853F', '#DEB887', '#F5DEB3', '#FFE4B5', '#FFDAB9', '#FFE4E1', '#FFC0CB', '#FFB6C1'
];

function toggleColorPanel(btn, command) {
    const panel = document.getElementById('colorSwatchPopover');
    const grid = document.getElementById('colorSwatchGrid');
    const title = document.getElementById('swatchTitle');
    if (!panel || !grid) return;

    if (panel.style.display === 'block' && panel.dataset.command === command) {
        panel.style.display = 'none';
        return;
    }

    panel.dataset.command = command;
    title.textContent = (command === 'hiliteColor' || command === 'backColor') ? '突出显示' : '文字颜色';

    grid.innerHTML = SWATCH_COLORS.map(c =>
        `<div class="color-swatch-item"
             style="background-color:${c};${c === '#FFFFFF' ? 'border-color:rgba(0,0,0,0.25);' : ''}"
             onmousedown="event.preventDefault(); applyColor('${c}');"
             title="${c}"></div>`
    ).join('');

    const rect = btn.getBoundingClientRect();
    panel.style.left = Math.min(rect.left, window.innerWidth - 256) + 'px';
    panel.style.top = (rect.bottom + 6) + 'px';
    panel.style.display = 'block';

    setTimeout(() => {
        document.addEventListener('mousedown', closeColorPanelOnOutside, { once: true });
    }, 0);
}

function closeColorPanelOnOutside(e) {
    const panel = document.getElementById('colorSwatchPopover');
    if (panel && !panel.contains(e.target)) {
        panel.style.display = 'none';
    } else {
        setTimeout(() => {
            document.addEventListener('mousedown', closeColorPanelOnOutside, { once: true });
        }, 0);
    }
}

function applyColor(color) {
    const panel = document.getElementById('colorSwatchPopover');
    const command = panel.dataset.command;
    if (command) {
        execCmd(command, color);
    }
    panel.style.display = 'none';
}

function toggleFontSizePanel(btn) {
    const panel = document.getElementById('fontSizePopover');
    if (!panel) return;
    if (panel.style.display === 'block') {
        panel.style.display = 'none';
        return;
    }
    const rect = btn.getBoundingClientRect();
    panel.style.left = Math.min(rect.left, window.innerWidth - 120) + 'px';
    panel.style.top = (rect.bottom + 6) + 'px';
    panel.style.display = 'block';
    setTimeout(() => {
        document.addEventListener('mousedown', closeFontSizePanelOnOutside, { once: true });
    }, 0);
}

function closeFontSizePanelOnOutside(e) {
    const panel = document.getElementById('fontSizePopover');
    if (panel && !panel.contains(e.target)) {
        panel.style.display = 'none';
    } else {
        setTimeout(() => {
            document.addEventListener('mousedown', closeFontSizePanelOnOutside, { once: true });
        }, 0);
    }
}

function applyFontSize(size) {
    execCmd('fontSize', size);
    const panel = document.getElementById('fontSizePopover');
    if (panel) panel.style.display = 'none';
}

// 保存富文本内容
function saveRichTextContent() {
    const richTextEditor = document.getElementById('richTextEditor');
    const remarkEditor = document.getElementById('deviceRemarkEditor');
    const textarea = document.getElementById('deviceRemark');

    if (!richTextEditor || !remarkEditor) {
        alert('保存失败：找不到编辑器');
        return;
    }

    // 直接将富文本编辑器的内容复制到主富文本编辑器
    remarkEditor.innerHTML = richTextEditor.innerHTML;

    // 同步更新隐藏的 textarea（用于保存到数据库）
    if (textarea) {
        textarea.value = encodeRichText(richTextEditor.innerHTML);
    }

    // 关闭富文本编辑器模态框 - 使用多种方法确保关闭
    try {
        const modal = bootstrap.Modal.getInstance(document.getElementById('richTextEditorModal'));
        if (modal) {
            modal.hide();
        } else {
            // 如果无法获取实例，尝试直接关闭
            const modalEl = document.getElementById('richTextEditorModal');
            if (modalEl) {
                modalEl.classList.remove('show');
                modalEl.style.display = 'none';
                // 移除 backdrop
                const backdrop = document.querySelector('.modal-backdrop');
                if (backdrop) backdrop.remove();
                document.body.classList.remove('modal-open');
                document.body.style.overflow = '';
                document.body.style.paddingRight = '';
            }
        }
    } catch (e) {
        console.error('关闭模态框失败:', e);
        // 备用方法：直接关闭
        const modalEl = document.getElementById('richTextEditorModal');
        if (modalEl) {
            modalEl.classList.remove('show');
            modalEl.style.display = 'none';
        }
    }

    // 自动保存设备信息
    setTimeout(() => {
        saveDevice();
    }, 300);
}

// 侧边栏收纳/展开控制（移动端）
function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    sidebar.classList.toggle('show');
    overlay.classList.toggle('show');
}

// 移动端搜索框显示/隐藏
function toggleMobileSearch() {
    const searchContainer = document.getElementById('mobileSearchContainer');
    const searchInput = document.getElementById('mobileSearchInput');
    if (searchContainer.style.display === 'none') {
        searchContainer.style.display = 'flex';
        searchInput.focus();
    } else {
        searchContainer.style.display = 'none';
        searchInput.value = '';
        filterDevices();
    }
}

// 侧边栏收纳/展开控制（PC端）
function toggleSidebarPC() {
    // 检测是否为移动端
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        // 移动端调用 toggleSidebar
        toggleSidebar();
        return;
    }

    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('collapsed');
}

// 侧边栏拖拽调整宽度
function initSidebarResize() {
    const handle = document.getElementById('sidebarResizeHandle');
    const sidebar = document.getElementById('sidebar');
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = sidebar.offsetWidth;
        handle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const diff = e.clientX - startX;
        const newWidth = Math.max(200, Math.min(400, startWidth + diff));
        sidebar.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            handle.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}

// 页面初始化
// 回车快捷保存（支持Shift/Alt+Enter换行）
document.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter') return;
    // Shift+Enter 或 Alt+Enter 允许换行，不触发保存
    if (e.shiftKey || e.altKey) return;
    // 在textarea中普通Enter允许换行
    if (e.target.tagName === 'TEXTAREA') return;

    const checkoutModal = document.getElementById('checkoutModal');
    const checkinModal = document.getElementById('checkinModal');
    const deviceModal = document.getElementById('deviceModal');

    if (checkoutModal && checkoutModal.classList.contains('show')) {
        e.preventDefault();
        confirmCheckout();
    } else if (checkinModal && checkinModal.classList.contains('show')) {
        e.preventDefault();
        confirmCheckin();
    } else if (deviceModal && deviceModal.classList.contains('show')) {
        e.preventDefault();
        saveDevice();
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    await loadPublicConfig();
    initSidebarResize();

    // 恢复视图模式
    const savedViewMode = localStorage.getItem('viewMode');
    if (savedViewMode) {
        viewMode = savedViewMode;
    }
    // 初始化按钮图标（默认表格视图）
    const btn = document.getElementById('viewToggleBtn');
    const icon = btn?.querySelector('i');
    if (viewMode === 'table' && icon && btn) {
        icon.className = 'bi bi-grid-3x3-gap';
        btn.classList.add('active');
    }

    // 恢复已关闭的公告状态
    const dismissed = localStorage.getItem('dismissedAnnouncements');
    if (dismissed) {
        dismissedAnnouncements = new Set(JSON.parse(dismissed));
    }

    // 加载公告
    await loadAnnouncements();

    // 移动端：确保侧边栏初始状态是关闭的
    if (window.innerWidth <= 768) {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        sidebar.classList.remove('show');
        overlay.classList.remove('show');
    }
    await loadWarehouses();
    if (warehouses.length > 0) {
        await selectWarehouse(warehouses[0].id, warehouses[0].name);
    }
    await loadTagStats();
    await updateStats();

    // 监听设备编辑弹窗关闭事件，清除URL参数
    const deviceModal = document.getElementById('deviceModal');
    if (deviceModal) {
        deviceModal.addEventListener('hidden.bs.modal', () => {
            if (window.location.search.includes('edit=')) {
                const newUrl = window.location.pathname;
                window.history.replaceState({}, document.title, newUrl);
            }
        });
    }

    // 检查URL参数，如果有edit参数，自动打开编辑模态框
    const urlParams = new URLSearchParams(window.location.search);
    const editDeviceId = urlParams.get('edit');
    console.log('URL参数检查:', { editDeviceId, currentUrl: window.location.href });
    if (editDeviceId) {
        console.log('准备打开编辑弹窗，设备ID:', editDeviceId);
        setTimeout(() => {
            // 确保设备数据已加载
            if (allDevices && allDevices.find(d => d.id === parseInt(editDeviceId))) {
                editDevice(parseInt(editDeviceId));
            } else {
                console.warn('设备未找到，延迟重试');
                setTimeout(() => {
                    editDevice(parseInt(editDeviceId));
                }, 500);
            }
        }, 500);
    }
});