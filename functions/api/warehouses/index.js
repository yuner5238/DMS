import { jsonResponse } from '../../_middleware';

// GET /api/warehouses - 获取所有仓库
// POST /api/warehouses - 创建仓库
export async function onRequestGet(context) {
    const { env } = context;
    const result = await env.DB.prepare('SELECT * FROM warehouses ORDER BY id').all();
    return jsonResponse(result.results);
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const { name, description } = await request.json();
    if (!name) return jsonResponse({ error: '仓库名称不能为空' }, 400);

    const result = await env.DB.prepare(
        'INSERT INTO warehouses (name, description) VALUES (?, ?)'
    ).bind(name, description || '').run();

    return jsonResponse({ id: result.meta.last_row_id, name, description });
}
