import { jsonResponse } from '../../_middleware';

// PUT /api/warehouses/:id - 更新仓库
// DELETE /api/warehouses/:id - 删除仓库
export async function onRequestPut(context) {
    const { request, env, params } = context;
    const { name, description } = await request.json();
    const id = params.id;

    await env.DB.prepare(
        'UPDATE warehouses SET name=?, description=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
    ).bind(name, description || '', id).run();

    return jsonResponse({ id, name, description });
}

export async function onRequestDelete(context) {
    const { env, params } = context;
    const id = params.id;

    const warehouse = await env.DB.prepare(
        'SELECT name FROM warehouses WHERE id=?'
    ).bind(id).first();

    if (warehouse) {
        await env.DB.prepare('DELETE FROM devices WHERE warehouse_name=?').bind(warehouse.name).run();
    }

    await env.DB.prepare('DELETE FROM warehouses WHERE id=?').bind(id).run();
    return jsonResponse({ success: true });
}
