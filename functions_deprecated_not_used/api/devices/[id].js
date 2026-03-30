import { jsonResponse } from '../../_middleware';

// GET /api/devices/:id - 获取单个设备
// PUT /api/devices/:id - 更新设备
// DELETE /api/devices/:id - 删除设备
export async function onRequestGet(context) {
    const { env, params } = context;
    const device = await env.DB.prepare('SELECT * FROM devices WHERE id=?').bind(params.id).first();
    if (!device) return jsonResponse({ error: '设备不存在' }, 404);
    return jsonResponse(device);
}

export async function onRequestPut(context) {
    const { request, env, params } = context;
    const body = await request.json();
    const { warehouseName, name, tag_name, status, quantity, storage_location, remark, location_status, destination, checkin_time, checkout_time } = body;
    const id = params.id;

    await env.DB.prepare(
        `UPDATE devices SET warehouse_name=?, name=?, tag_name=?, status=?, quantity=?, storage_location=?, location_status=?, destination=?, remark=?, checkin_time=?, checkout_time=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(
        warehouseName, name, tag_name || '', status, quantity || 1, storage_location || '', location_status || 'in_stock', destination || '', remark || '', checkin_time || null, checkout_time || null, id
    ).run();

    return jsonResponse({ id, warehouseName, name });
}

export async function onRequestDelete(context) {
    const { env, params } = context;
    await env.DB.prepare('DELETE FROM devices WHERE id=?').bind(params.id).run();
    return jsonResponse({ success: true });
}
