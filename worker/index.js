// Cloudflare Workers 后端 - DMS 仓库资产管理系统
// 使用 Cloudflare D1 数据库
// 测试 GitHub Actions 自动部署 - 2025

// ============ 路由处理 ============
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        // 处理 CORS 预检请求
        if (method === 'OPTIONS') {
            return corsResponse();
        }

        try {
            // ===== 仓库 API =====
            if (path === '/api/warehouses' && method === 'GET') {
                return await getWarehouses(env);
            }
            if (path === '/api/warehouses' && method === 'POST') {
                return await createWarehouse(request, env);
            }
            if (path.match(/^\/api\/warehouses\/\d+$/) && method === 'PUT') {
                const id = path.split('/').pop();
                return await updateWarehouse(request, env, id);
            }
            if (path.match(/^\/api\/warehouses\/\d+$/) && method === 'DELETE') {
                const id = path.split('/').pop();
                return await deleteWarehouse(env, id);
            }

            // ===== 设备 API =====
            if (path === '/api/devices' && method === 'GET') {
                return await getDevices(request, env);
            }
            if (path === '/api/devices' && method === 'POST') {
                return await createDevice(request, env);
            }
            if (path.match(/^\/api\/devices\/\d+$/) && method === 'GET') {
                const id = path.split('/').pop();
                return await getDevice(env, id);
            }
            if (path.match(/^\/api\/devices\/\d+$/) && method === 'PUT') {
                const id = path.split('/').pop();
                return await updateDevice(request, env, id);
            }
            if (path.match(/^\/api\/devices\/\d+$/) && method === 'DELETE') {
                const id = path.split('/').pop();
                return await deleteDevice(env, id);
            }

            // ===== 标签 API =====
            if (path === '/api/tags' && method === 'GET') {
                return await getTags(env);
            }
            if (path === '/api/tags' && method === 'POST') {
                return await createTag(request, env);
            }
            if (path.match(/^\/api\/tags\/\d+$/) && method === 'PUT') {
                const id = path.split('/').pop();
                return await updateTag(request, env, id);
            }
            if (path.match(/^\/api\/tags\/\d+$/) && method === 'DELETE') {
                const id = path.split('/').pop();
                return await deleteTag(env, id);
            }

            // ===== 标签统计 API =====
            if (path === '/api/tag-stats' && method === 'GET') {
                return await getTagStats(request, env);
            }

            return jsonResponse({ error: 'Not Found' }, 404);
        } catch (err) {
            console.error(err);
            return jsonResponse({ error: err.message }, 500);
        }
    }
};

// ============ 仓库操作 ============

async function getWarehouses(env) {
    const result = await env.DB.prepare('SELECT * FROM warehouses ORDER BY id').all();
    return jsonResponse(result.results);
}

async function createWarehouse(request, env) {
    const { name, description } = await request.json();
    if (!name) return jsonResponse({ error: '仓库名称不能为空' }, 400);

    const result = await env.DB.prepare(
        'INSERT INTO warehouses (name, description) VALUES (?, ?)'
    ).bind(name, description || '').run();

    return jsonResponse({ id: result.meta.last_row_id, name, description });
}

async function updateWarehouse(request, env, id) {
    const { name, description } = await request.json();
    await env.DB.prepare(
        'UPDATE warehouses SET name=?, description=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
    ).bind(name, description || '', id).run();

    return jsonResponse({ id, name, description });
}

async function deleteWarehouse(env, id) {
    const warehouse = await env.DB.prepare(
        'SELECT name FROM warehouses WHERE id=?'
    ).bind(id).first();

    if (warehouse) {
        await env.DB.prepare('DELETE FROM devices WHERE warehouse_name=?').bind(warehouse.name).run();
    }

    await env.DB.prepare('DELETE FROM warehouses WHERE id=?').bind(id).run();
    return jsonResponse({ success: true });
}

// ============ 设备操作 ============

async function getDevices(request, env) {
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

async function getDevice(env, id) {
    const device = await env.DB.prepare('SELECT * FROM devices WHERE id=?').bind(id).first();
    if (!device) return jsonResponse({ error: '设备不存在' }, 404);
    return jsonResponse(device);
}

async function createDevice(request, env) {
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

async function updateDevice(request, env, id) {
    const body = await request.json();
    const { warehouseName, name, tag_name, status, quantity, storage_location, remark, location_status, destination, checkin_time, checkout_time } = body;

    await env.DB.prepare(
        `UPDATE devices SET warehouse_name=?, name=?, tag_name=?, status=?, quantity=?, storage_location=?, location_status=?, destination=?, remark=?, checkin_time=?, checkout_time=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(
        warehouseName, name, tag_name || '', status, quantity || 1, storage_location || '', location_status || 'in_stock', destination || '', remark || '', checkin_time || null, checkout_time || null, id
    ).run();

    return jsonResponse({ id, warehouseName, name });
}

async function deleteDevice(env, id) {
    await env.DB.prepare('DELETE FROM devices WHERE id=?').bind(id).run();
    return jsonResponse({ success: true });
}

// ============ 标签操作 ============

async function getTags(env) {
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

async function createTag(request, env) {
    const { name } = await request.json();
    if (!name) return jsonResponse({ error: '标签名称不能为空' }, 400);

    const result = await env.DB.prepare('INSERT INTO tags (name) VALUES (?)').bind(name).run();
    return jsonResponse({ id: result.meta.last_row_id, name });
}

async function updateTag(request, env, id) {
    const { name } = await request.json();
    await env.DB.prepare('UPDATE tags SET name=? WHERE id=?').bind(name, id).run();
    return jsonResponse({ id, name });
}

async function deleteTag(env, id) {
    await env.DB.prepare('DELETE FROM device_tags WHERE tag_id=?').bind(id).run();
    await env.DB.prepare('DELETE FROM tags WHERE id=?').bind(id).run();
    return jsonResponse({ success: true });
}

// ============ 标签统计 ============

async function getTagStats(request, env) {
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

// ============ 工具函数 ============

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        }
    });
}

function corsResponse() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        }
    });
}
