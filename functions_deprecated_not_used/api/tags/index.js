import { jsonResponse } from '../../_middleware';

// GET /api/tags - 获取所有标签
// POST /api/tags - 创建标签
export async function onRequestGet(context) {
    const { env } = context;
    const result = await env.DB.prepare(`
        SELECT t.id, t.name,
               COUNT(DISTINCT dt.device_id) as device_count,
               COALESCE(SUM(d.quantity), 0) as total_quantity
        FROM tags t
        LEFT JOIN device_tags dt ON t.id = dt.tag_id
        LEFT JOIN devices d ON dt.device_id = d.id
        GROUP BY t.id, t.name
        ORDER BY t.name
    `).all();
    return jsonResponse(result.results);
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const { name } = await request.json();
    if (!name) return jsonResponse({ error: '标签名称不能为空' }, 400);

    const result = await env.DB.prepare('INSERT INTO tags (name) VALUES (?)').bind(name).run();
    return jsonResponse({ id: result.meta.last_row_id, name });
}
