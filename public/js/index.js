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
let tagEditMode = false;  // 标签管理模式
let announcements = [];
let dismissedAnnouncements = new Set();

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
function showRemarkPreview(deviceName, remark) {
    if (!remark) return;
    document.getElementById('remarkDeviceName').textContent = deviceName;
    document.getElementById('remarkContent').innerHTML = decodeRichText(remark);
    new bootstrap.Modal(document.getElementById('remarkPreviewModal')).show();
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

// 加载标签统计（支持按仓库筛选）
async function loadTagStats(warehouseName = null) {
    try {
        const url = warehouseName ? `${API_BASE}/tag-stats?warehouseName=${encodeURIComponent(warehouseName)}` : `${API_BASE}/tag-stats`;
        const res = await fetch(url);
        const data = await res.json();
        tagStats = Array.isArray(data) ? data : [];
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
        const icon = isAll ? 'bi-grid' : 'bi-box';
        const actionsHtml = isAll ? '' : `
            <div class="warehouse-actions" onclick="event.stopPropagation()">
                <button class="btn btn-sm btn-outline-light" onclick="editWarehouse(${w.id})" title="编辑"><i class="bi bi-pencil"></i></button>
                <button class="btn btn-sm btn-outline-danger" onclick="deleteWarehouseConfirm(${w.id})" title="删除"><i class="bi bi-trash"></i></button>
            </div>
        `;
        return `
            <div class="nav-link warehouse-card${isAll ? ' all' : ''}" data-id="${w.id}" data-name="${w.name}" onclick="selectWarehouse(${w.id}, '${w.name}')">
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
            ${tagEditMode ? `<button class="btn btn-sm btn-link text-danger p-0 ms-2 delete-tag-btn" onclick="event.stopPropagation(); confirmDeleteTag(${tag.id}, '${tag.name}')" title="删除标签"><i class="bi bi-trash"></i></button>` : ''}
        </div>
    `).join('');
}

// 切换标签管理模式
function toggleTagEditMode() {
    tagEditMode = !tagEditMode;
    renderTagStats();
}

// 确认删除标签
function confirmDeleteTag(id, name) {
    if (!confirm(`确定要删除标签 "${name}" 吗？`)) return;
    document.getElementById('tagId').value = id;
    deleteTag();
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

// 选择仓库
async function selectWarehouse(id, name) {
    currentWarehouseId = id;
    currentWarehouseName = name === '总仓库' ? null : name;
    currentTagFilter = null; // 切换仓库时清除标签筛选
    document.querySelectorAll('.warehouse-card').forEach(card => { card.classList.toggle('active', card.dataset.id == id); });
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

        // 应用标签筛选
        if (currentTagFilter) {
            devices = devices.filter(d => d.tag_name === currentTagFilter);
        }

        allDevices = devices;
        renderDevices(devices);
        await updateStats();
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

    const inStockDevices = devices.filter(d => d.location_status === 'in_stock' || !d.location_status);
    const checkedOutDevices = devices.filter(d => d.location_status === 'checked_out');
    const statusClass = { '正常': 'status-normal', '异常': 'status-abnormal', '维修中': 'status-maintenance' };

    const renderDeviceItem = (device, isOut) => {
        const tagHtml = device.tag_name ? `<span class="tag-badge">${device.tag_name}</span>` : '';
        const actionBtn = isOut
            ? `<button class="btn btn-sm btn-outline-success checkin-btn" onclick="event.stopPropagation(); showCheckinModal(${device.id}, '${device.name}')" title="入库"><i class="bi bi-box-arrow-left"></i></button>`
            : `<button class="btn btn-sm btn-outline-warning checkout-btn" onclick="event.stopPropagation(); showCheckoutModal(${device.id}, '${device.name}')" title="出库"><i class="bi bi-box-arrow-right"></i></button>`;
        const destinationTag = isOut && device.destination ? `<span class="destination-tag"><i class="bi bi-geo-alt"></i> ${device.destination}</span>` : '';
        const checkinTimeValue = device.checkin_time ? formatDate(device.checkin_time) : '';
        const storageLocationValue = device.storage_location ? device.storage_location : '';

        return `
            <div class="device-item ${isOut ? 'checked-out' : ''}" onclick="showDeviceDetail(${device.id})">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <div class="device-header-row">
                            <div class="device-name-section">
                                <div class="name-tags-row">
                                    <div class="name-quantity-wrapper">
                                        <strong id="device-name-${device.id}" class="device-name-text">${device.name}</strong>
                                        ${device.quantity ? `<span class="quantity-badge">${device.quantity}</span>` : ''}
                                    </div>
                                    <div class="status-tags-row">
                                        <span class="status-badge ${statusClass[device.status]}">${device.status}</span>
                                        ${tagHtml}
                                        ${destinationTag}
                                    </div>
                                </div>
                            </div>
                            <div class="device-details">
                                <span class="detail-item remark"><span class="detail-label">备注:</span><span class="detail-value remark-clickable" onclick="event.stopPropagation(); showRemarkPreview('${device.name}', '${(device.remark || '').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/`/g, '\\`')}')" title="${device.remark || ''}">${decodeRichTextToSingleLine(device.remark || '')}</span></span>
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
        (d.tag_name && d.tag_name.toLowerCase().includes(keyword)) ||
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
                warehouseName: device.warehouse_name, name: device.name, tag_name: device.tag_name || '',
                status: device.status, quantity: device.quantity, storage_location: device.storage_location,
                location_status: 'checked_out', destination: destination || '', remark: device.remark,
                checkin_time: device.checkin_time, checkout_time: formatDateTime(new Date())
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
                warehouseName: device.warehouse_name, name: device.name, tag_name: device.tag_name || '',
                status: device.status, quantity: device.quantity, storage_location: device.storage_location,
                location_status: 'in_stock', destination: '', remark: device.remark,
                checkin_time: formatDateTime(new Date()), checkout_time: null
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
        document.getElementById('deviceWarehouse').value = d.warehouse_name;
        document.getElementById('deviceName').value = d.name;
        document.getElementById('deviceTagName').value = d.tag_name || '';
        document.getElementById('deviceQuantity').value = d.quantity;
        document.getElementById('deviceStorageLocation').value = d.storage_location || '';
        // 入库时间
        if (d.checkin_time) {
            const checkinDate = new Date(d.checkin_time);
            document.getElementById('deviceCheckinTime').value = checkinDate.toISOString().split('T')[0];
        } else {
            document.getElementById('deviceCheckinTime').value = '';
        }
        document.getElementById('deviceLocationStatus').value = d.location_status || 'in_stock';
        document.getElementById('deviceDestination').value = d.destination || '';
        document.getElementById('deviceStatus').value = d.status;
        document.getElementById('deviceRemark').value = d.remark || '';
        document.getElementById('deviceRemarkEditor').innerHTML = decodeRichText(d.remark || '');
        document.getElementById('deleteDeviceBtn').style.display = 'block';
        document.getElementById('destinationField').style.display = (d.location_status === 'checked_out') ? 'block' : 'none';
    } else {
        document.getElementById('deviceId').value = '';
        document.getElementById('deviceName').value = '';
        document.getElementById('deviceTagName').value = '';
        document.getElementById('deviceQuantity').value = 1;
        document.getElementById('deviceStorageLocation').value = '';
        // 新增设备默认入库时间为今天
        document.getElementById('deviceCheckinTime').value = new Date().toISOString().split('T')[0];
        document.getElementById('deviceLocationStatus').value = 'in_stock';
        document.getElementById('deviceDestination').value = '';
        document.getElementById('deviceStatus').value = '正常';
        document.getElementById('deviceRemark').value = '';
        document.getElementById('deviceRemarkEditor').innerHTML = '';
        document.getElementById('deleteDeviceBtn').style.display = 'none';
        document.getElementById('destinationField').style.display = 'none';
        if (currentWarehouseName) document.getElementById('deviceWarehouse').value = currentWarehouseName;
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

    // 在其他输入框中，回车键保存
    if (event.key === 'Enter') {
        event.preventDefault();
        saveDevice();
    }
}

// 显示设备详情
async function showDeviceDetail(id) {
    if (!id) {
        alert('设备ID无效');
        return;
    }
    // 跳转到设备详情页面，地址栏末尾包含设备ID
    window.location.href = `/device.html?id=${id}`;
}

function editDevice(id) { showDeviceModal(id); }

async function saveDevice() {
    const id = document.getElementById('deviceId').value;
    const location_status = document.getElementById('deviceLocationStatus').value;
    const destination = location_status === 'checked_out' ? document.getElementById('deviceDestination').value : '';
    const checkinTimeInput = document.getElementById('deviceCheckinTime').value;
    const remarkEditor = document.getElementById('deviceRemarkEditor');

    const data = {
        warehouseName: document.getElementById('deviceWarehouse').value,
        name: document.getElementById('deviceName').value,
        tag_name: document.getElementById('deviceTagName').value,
        quantity: parseInt(document.getElementById('deviceQuantity').value),
        storage_location: document.getElementById('deviceStorageLocation').value,
        location_status: location_status,
        destination: destination,
        status: document.getElementById('deviceStatus').value,
        remark: encodeRichText(remarkEditor ? remarkEditor.innerHTML : ''),
        checkin_time: checkinTimeInput ? checkinTimeInput + ' ' + new Date().toTimeString().slice(0,8) : null
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
function insertImageToRemark() {
    document.getElementById('remarkImageInput').click();
}

function handleImageSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    // 检查文件大小（限制为2MB）
    if (file.size > 2 * 1024 * 1024) {
        alert('图片大小不能超过2MB');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const base64 = e.target.result;
        const remarkEditor = document.getElementById('deviceRemarkEditor');
        const imgTag = `<img src="${base64}" style="max-width: 100%; height: auto; margin: 8px 0; border-radius: 4px; border: 1px solid #dee2e6;" />`;
        remarkEditor.innerHTML += imgTag;
        event.target.value = '';
    };
    reader.readAsDataURL(file);
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
                    if (color) {
                        return `[COLOR=${color}]${content}[/COLOR]`;
                    } else if (size) {
                        return `[SIZE=${size}]${content}[/SIZE]`;
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

    // 先将换行转换为 <br>
    let html = text.replace(/\n/g, '<br>');

    // 解析富文本标记
    html = html.replace(/\[B\]([\s\S]*?)\[\/B\]/gi, '<b>$1</b>');
    html = html.replace(/\[I\]([\s\S]*?)\[\/I\]/gi, '<i>$1</i>');
    html = html.replace(/\[U\]([\s\S]*?)\[\/U\]/gi, '<u>$1</u>');
    html = html.replace(/\[S\]([\s\S]*?)\[\/S\]/gi, '<s>$1</s>');
    html = html.replace(/\[COLOR=([^\]]+)\]([\s\S]*?)\[\/COLOR\]/gi, '<font color="$1">$2</font>');
    html = html.replace(/\[SIZE=([^\]]+)\]([\s\S]*?)\[\/SIZE\]/gi, '<font size="$1">$2</font>');

    // 确保连续的换行被正确处理
    html = html.replace(/(<br>\s*){2,}/g, '<br><br>');

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
    html = html.replace(/\[SIZE=([^\]]+)\]([\s\S]*?)\[\/SIZE\]/gi, '<font size="$1">$2</font>');

    // 移除多余的空格
    html = html.replace(/\s+/g, ' ').trim();

    return html;
}

// 执行富文本命令
function execCmd(command, value = null) {
    document.execCommand(command, false, value);
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

// ============ 标签操作 ============
function showTagModal(id = null) {
    const modal = new bootstrap.Modal(document.getElementById('tagModal'));
    document.getElementById('tagModalTitle').textContent = id ? '编辑标签' : '添加标签';
    document.getElementById('deleteTagBtn').style.display = id ? 'block' : 'none';
    if (id) {
        const tag = tagStats.find(t => t.id === id);
        document.getElementById('tagId').value = tag.id;
        document.getElementById('tagName').value = tag.name;
    } else {
        document.getElementById('tagId').value = '';
        document.getElementById('tagName').value = '';
    }
    modal.show();
}

function editTag(id, name) { showTagModal(id); }

function deleteTagConfirm(id) {
    if (!confirm('确定要删除该标签吗？')) return;
    document.getElementById('tagId').value = id;
    deleteTag();
}

async function saveTag() {
    const id = document.getElementById('tagId').value;
    const data = { name: document.getElementById('tagName').value };
    if (!data.name) { alert('请输入标签名称'); return; }
    try {
        if (id) await fetch(`${API_BASE}/tags/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        else await fetch(`${API_BASE}/tags`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        bootstrap.Modal.getInstance(document.getElementById('tagModal')).hide();
        await loadTagStats();
    } catch (e) { alert('保存失败: ' + e.message); }
}

async function deleteTag() {
    const id = document.getElementById('tagId').value;
    try {
        await fetch(`${API_BASE}/tags/${id}`, { method: 'DELETE' });
        bootstrap.Modal.getInstance(document.getElementById('tagModal')).hide();
        await loadTagStats(); await loadWarehouses(); await loadDevices();
    } catch (e) { alert('删除失败: ' + e.message); }
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
    initSidebarResize();

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