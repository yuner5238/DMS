import { jsonResponse } from '../../_middleware';

// PUT /api/tags/:id - 更新标签
// DELETE /api/tags/:id - 删除标签
export async function onRequestPut(context) {
    const { request, env, params } = context;
    const { name } = await request.json();
    await env.DB.prepare('UPDATE tags SET name=? WHERE id=?').bind(name, params.id).run();
    return jsonResponse({ id: params.id, name });
}

export async function onRequestDelete(context) {
    const { env, params } = context;
    const id = params.id;
    await env.DB.prepare('DELETE FROM device_tags WHERE tag_id=?').bind(id).run();
    await env.DB.prepare('DELETE FROM tags WHERE id=?').bind(id).run();
    return jsonResponse({ success: true });
}
