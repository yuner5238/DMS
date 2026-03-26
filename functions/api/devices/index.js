import { jsonResponse } from '../../_middleware';

// GET /api/devices - 获取设备列表
// POST /api/devices - 创建设备
export async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const warehouseId = url.searchParams.get('warehouseId');
    const warehouseName = url.searchParams.get('warehouseName');

    let sql = 'SELECT * FROM devices';
    let params = [];

    if (warehouseId) {
        const wh = await env.DB.prepare('SELECT name FROM warehouses WHERE id=?').bind(warehouseId).first();
        if (wh) {
            sql += ' WHERE warehouse_name=?';
            params = [wh.name];
        }
    } else if (warehouseName) {
        sql += ' WHERE warehouse_name=?';
        params = [warehouseName];
    }

    sql += ' ORDER BY id';

    const result = params.length > 0
        ? await env.DB.prepare(sql).bind(...params).all()
        : await env.DB.prepare(sql).all();

    return jsonResponse(result.results);
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const body = await request.json();
    const { warehouseName, name, tag_name, status, quantity, storage_location, remark, location_status, destination, checkin_time } = body;

    if (!name) return jsonResponse({ error: '设备名称不能为空' }, 400);
    if (!warehouseName) return jsonResponse({ error: '请选择仓库' }, 400);

    const locStatus = location_status || 'in_stock';
    const checkinTime = checkin_time || (locStatus === 'in_stock' ? new Date().toISOString() : null);

    const result = await env.DB.prepare(
        `INSERT INTO devices (warehouse_name, name, tag_name, status, quantity, storage_location, location_status, destination, remark, checkin_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        warehouseName, name, tag_name || '', status || '正常', quantity || 1, storage_location || '', locStatus, destination || '', remark || '', checkinTime
    ).run();

    return jsonResponse({ id: result.meta.last_row_id, warehouseName, name });
}
