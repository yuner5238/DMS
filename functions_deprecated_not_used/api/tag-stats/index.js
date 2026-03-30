import { jsonResponse } from '../../_middleware';

// GET /api/tag-stats - 获取标签统计
export async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const warehouseName = url.searchParams.get('warehouseName');

    let sql = `SELECT tag_name as name, COUNT(*) as device_count, SUM(quantity) as total_count FROM devices WHERE tag_name IS NOT NULL AND tag_name != ''`;
    let params = [];

    if (warehouseName) {
        sql += ' AND warehouse_name=?';
        params = [warehouseName];
    }

    sql += ' GROUP BY tag_name ORDER BY total_count DESC';

    const result = params.length > 0
        ? await env.DB.prepare(sql).bind(...params).all()
        : await env.DB.prepare(sql).all();

    return jsonResponse(result.results);
}
