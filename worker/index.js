// Cloudflare Workers 后端 - DMS 仓库资产管理系统
// 使用 Cloudflare D1 数据库
// 测试 GitHub Actions 自动部署 - 2025 第三次测试（Node.js v20）

// S3 存储根目录前缀（与 server/s3.config.js 保持一致）
const S3_BASE = 'DMS storage';

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
            // 通过设备码(device_id)查询设备
            if (path.match(/^\/api\/devices\/by-code\/[^/]+$/) && method === 'GET') {
                const code = path.split('/').pop();
                return await getDeviceByCode(env, code);
            }
            // 生成下一个设备码
            if (path === '/api/devices/next-code' && method === 'GET') {
                return await getNextDeviceCode(env);
            }
            // 批量补全设备码
            if (path === '/api/devices/backfill-codes' && method === 'POST') {
                return await backfillDeviceCodes(env);
            }
            // 批量删除设备
            if (path === '/api/devices/batch-delete' && method === 'POST') {
                return await batchDeleteDevices(request, env);
            }

            // ===== 标签统计 API =====
            if (path === '/api/tag-stats' && method === 'GET') {
                return await getTagStats(request, env);
            }

            // ===== 临期设备 API =====
            if (path === '/api/devices/expiring' && method === 'GET') {
                return await getExpiringDevices(request, env);
            }

            // ===== 公告 API =====
            if (path === '/api/announcements' && method === 'GET') {
                return await getAnnouncements(env);
            }
            if (path === '/api/announcements' && method === 'POST') {
                return await createAnnouncement(request, env);
            }
            if (path.match(/^\/api\/announcements\/\d+$/) && method === 'DELETE') {
                const id = path.split('/').pop();
                return await deleteAnnouncement(env, id);
            }

            // ===== 公开配置 API =====
            if (path === '/api/config' && method === 'GET') {
                return jsonResponse({
                    s3PublicUrl: env.S3_PUBLIC_URL || `${env.S3_ENDPOINT}/${env.S3_BUCKET}`,
                });
            }

            // ===== S3 图片 API =====
            // 上传图片
            if (path === '/api/upload/image' && method === 'POST') {
                return await uploadImage(request, env);
            }
            // 列出设备图片
            const imageListMatch = path.match(/^\/api\/images\/list\/([^/]+)$/);
            if (imageListMatch && method === 'GET') {
                return await listImages(env, imageListMatch[1]);
            }
            // 删除图片
            const imageDeleteMatch = path.match(/^\/api\/images\/([^/]+)\/([^/]+)$/);
            if (imageDeleteMatch && method === 'DELETE') {
                return await deleteImage(env, imageDeleteMatch[1], imageDeleteMatch[2]);
            }
            // 代理图片（GET 图片）
            if (imageDeleteMatch && method === 'GET') {
                return await proxyImage(env, imageDeleteMatch[1], imageDeleteMatch[2]);
            }

            // ===== S3 附件 API =====
            // 上传附件
            if (path === '/api/upload/attachment' && method === 'POST') {
                return await uploadAttachment(request, env);
            }
            // 列出设备附件
            const attachListMatch = path.match(/^\/api\/attachments\/([^/]+)$/);
            if (attachListMatch && method === 'GET') {
                return await listAttachments(env, attachListMatch[1]);
            }
            // 删除附件
            const attachDelMatch = path.match(/^\/api\/attachments\/([^/]+)\/([^/]+)$/);
            if (attachDelMatch && method === 'DELETE') {
                return await deleteAttachment(env, attachDelMatch[1], attachDelMatch[2]);
            }
            // 代理附件（GET 附件）
            if (attachDelMatch && method === 'GET') {
                return await proxyAttachment(env, attachDelMatch[1], attachDelMatch[2]);
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
    const { device_id, warehouseName, name, tag_names, tag_name, status, quantity, storage_location, remark, location_status, destination, checkin_time, expiry_date, responsible_person, department_path, serial_number, spec_model, source } = body;

    if (!name) return jsonResponse({ error: '设备名称不能为空' }, 400);

    const locStatus = location_status || 'in_stock';
    const checkinTime = checkin_time || (locStatus === 'in_stock' ? new Date().toISOString() : null);
    const tags = tag_names || tag_name || '';

    const result = await env.DB.prepare(
        `INSERT INTO devices (device_id, warehouse_name, name, tag_names, status, quantity, storage_location, location_status, destination, remark, expiry_date, checkin_time, responsible_person, department_path, serial_number, spec_model, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        device_id || null, warehouseName || null, name, tags, status || '正常', quantity || 1, storage_location || '', locStatus, destination || '', remark || '', expiry_date || null, checkinTime, responsible_person || null, department_path || null, serial_number || null, spec_model || null, source || null
    ).run();

    return jsonResponse({ id: result.meta.last_row_id, warehouseName, name });
}

async function updateDevice(request, env, id) {
    const body = await request.json();

    // 先获取原设备数据（避免部分更新时清空未传入的字段）
    const existing = await env.DB.prepare('SELECT * FROM devices WHERE id=?').bind(id).first();
    if (!existing) return jsonResponse({ error: '设备不存在' }, 404);

    // 合并：请求中的字段覆盖原值，未传入的保留原值
    const merged = { ...existing };
    const fields = ['device_id', 'warehouse_name', 'name', 'tag_names', 'status', 'quantity',
        'storage_location', 'location_status', 'destination', 'remark', 'expiry_date',
        'checkin_time', 'checkout_time', 'responsible_person', 'department_path', 'serial_number', 'spec_model', 'source'];
    const fieldMap = {
        device_id: 'device_id',
        warehouseName: 'warehouse_name',
        name: 'name',
        tag_names: 'tag_names',
        tag_name: 'tag_names',
        status: 'status',
        quantity: 'quantity',
        storage_location: 'storage_location',
        location_status: 'location_status',
        destination: 'destination',
        remark: 'remark',
        expiry_date: 'expiry_date',
        checkin_time: 'checkin_time',
        checkout_time: 'checkout_time',
        responsible_person: 'responsible_person',
        department_path: 'department_path',
        serial_number: 'serial_number',
        spec_model: 'spec_model',
        source: 'source'
    };

    for (const [reqKey, dbKey] of Object.entries(fieldMap)) {
        if (body[reqKey] !== undefined) {
            merged[dbKey] = body[reqKey];
        }
    }

    // 特殊处理 tag_names：tag_name 也映射到 tag_names
    if (body.tag_names !== undefined || body.tag_name !== undefined) {
        merged.tag_names = body.tag_names || body.tag_name || '';
    }

    await env.DB.prepare(
        `UPDATE devices SET device_id=?, warehouse_name=?, name=?, tag_names=?, status=?, quantity=?, storage_location=?, location_status=?, destination=?, remark=?, expiry_date=?, checkin_time=?, checkout_time=?, responsible_person=?, department_path=?, serial_number=?, spec_model=?, source=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(
        merged.device_id || null, merged.warehouse_name || '', merged.name || '', merged.tag_names || '',
        merged.status || '正常', merged.quantity || 1, merged.storage_location || '',
        merged.location_status || 'in_stock', merged.destination || '', merged.remark || '',
        merged.expiry_date || null, merged.checkin_time || null, merged.checkout_time || null,
        merged.responsible_person || null, merged.department_path || null, merged.serial_number || null,
        merged.spec_model || null, merged.source || null, id
    ).run();

    return jsonResponse({ id, warehouseName: merged.warehouse_name, name: merged.name });
}

async function deleteDevice(env, id) {
    await env.DB.prepare('DELETE FROM devices WHERE id=?').bind(id).run();
    return jsonResponse({ success: true });
}

// 通过设备码(device_id)查询设备
async function getDeviceByCode(env, code) {
    const device = await env.DB.prepare('SELECT * FROM devices WHERE device_id=?').bind(code).first();
    if (!device) return jsonResponse({ error: '设备不存在' }, 404);
    return jsonResponse(device);
}

// 生成下一个设备码（6位数字）
async function getNextDeviceCode(env) {
    const result = await env.DB.prepare(
        "SELECT MAX(CAST(device_id AS INTEGER)) as max_code FROM devices WHERE device_id IS NOT NULL AND device_id != ''"
    ).first();
    const maxCode = result && result.max_code ? result.max_code : 0;
    const nextCode = String(maxCode + 1).padStart(6, '0');
    return jsonResponse({ code: nextCode });
}

// 批量补全缺失 device_id 的旧设备
async function backfillDeviceCodes(env) {
    const devices = await env.DB.prepare(
        "SELECT id FROM devices WHERE device_id IS NULL OR device_id = '' ORDER BY id"
    ).all();

    const maxResult = await env.DB.prepare(
        "SELECT MAX(CAST(device_id AS INTEGER)) as max_code FROM devices WHERE device_id IS NOT NULL AND device_id != ''"
    ).first();
    let maxCode = maxResult && maxResult.max_code ? maxResult.max_code : 0;

    let count = 0;
    for (const device of devices.results) {
        maxCode++;
        const newCode = String(maxCode).padStart(6, '0');
        await env.DB.prepare('UPDATE devices SET device_id=? WHERE id=?').bind(newCode, device.id).run();
        count++;
    }

    return jsonResponse({ message: `已为 ${count} 个设备补全设备ID码` });
}

// 批量删除设备
async function batchDeleteDevices(request, env) {
    const { ids } = await request.json();
    if (!Array.isArray(ids) || ids.length === 0) {
        return jsonResponse({ error: '请提供要删除的设备ID列表' }, 400);
    }
    // D1 需要逐个绑定参数，构建 IN (?, ?, ...) 语句
    const placeholders = ids.map(() => '?').join(',');
    const result = await env.DB.prepare(
        `DELETE FROM devices WHERE id IN (${placeholders})`
    ).bind(...ids).run();
    return jsonResponse({ success: true, deleted: result.meta?.changes || ids.length });
}

// ============ 标签统计 ============

async function getTagStats(request, env) {
    const url = new URL(request.url);
    const warehouseName = url.searchParams.get('warehouseName');

    let sql = `SELECT tag_names, quantity FROM devices WHERE tag_names IS NOT NULL AND tag_names != ''`;
    let params = [];

    if (warehouseName) {
        sql += ' AND warehouse_name=?';
        params = [warehouseName];
    }

    const rows = params.length > 0
        ? await env.DB.prepare(sql).bind(...params).all()
        : await env.DB.prepare(sql).all();

    // 拆分 JSON 数组格式的标签并聚合
    const tagCountMap = {};
    (rows.results || []).forEach(row => {
        if (row.tag_names) {
            let tags = [];
            try {
                tags = JSON.parse(row.tag_names);
            } catch (e) {
                // 兼容旧的逗号分隔格式
                tags = row.tag_names.split(',').map(t => t.trim()).filter(t => t);
            }
            tags.forEach(tag => {
                const name = tag.trim();
                if (name) {
                    if (!tagCountMap[name]) {
                        tagCountMap[name] = { name, device_count: 0, total_count: 0 };
                    }
                    tagCountMap[name].device_count += 1;
                    tagCountMap[name].total_count += row.quantity || 1;
                }
            });
        }
    });

    const result = Object.values(tagCountMap).sort((a, b) => b.total_count - a.total_count);

    return jsonResponse(result);
}

// ============ 临期设备 ============

async function getExpiringDevices(request, env) {
    const result = await env.DB.prepare(
        `SELECT id, device_id, name, expiry_date, location_status,
            CAST(julianday(expiry_date) - julianday('now') AS INTEGER) AS remaining_days
        FROM devices
        WHERE expiry_date IS NOT NULL
        AND expiry_date >= date('now')
        ORDER BY remaining_days ASC
        LIMIT 10`
    ).all();
    return jsonResponse(result.results);
}

// ============ 公告操作 ============

async function getAnnouncements(env) {
    const result = await env.DB.prepare('SELECT * FROM announcements ORDER BY created_at DESC').all();
    return jsonResponse({ success: true, data: result.results });
}

async function createAnnouncement(request, env) {
    const { content } = await request.json();
    if (!content) return jsonResponse({ success: false, error: '公告内容不能为空' }, 400);

    // 获取北京时间（UTC+8）
    const now = new Date();
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const beijingTimeStr = beijingTime.toISOString().slice(0, 19).replace('T', ' ');

    const result = await env.DB.prepare(
        'INSERT INTO announcements (content, created_at) VALUES (?, ?)'
    ).bind(content, beijingTimeStr).run();

    const announcement = await env.DB.prepare('SELECT * FROM announcements WHERE id=?').bind(result.meta.last_row_id).first();
    return jsonResponse({ success: true, data: announcement });
}

async function deleteAnnouncement(env, id) {
    await env.DB.prepare('DELETE FROM announcements WHERE id=?').bind(id).run();
    return jsonResponse({ success: true });
}

// ============ S3 图片操作 ============

// 列出设备图片
async function listImages(env, deviceId) {
    if (!deviceId || deviceId === '0') {
        return jsonResponse({ success: true, images: [] });
    }

    const prefix = `${S3_BASE}/images/${deviceId}/`;
    const s3Url = new URL(`${env.S3_ENDPOINT}/${env.S3_BUCKET}`);
    s3Url.searchParams.set('list-type', '2');
    s3Url.searchParams.set('prefix', prefix);
    s3Url.searchParams.set('max-keys', '500');

    const signedRequest = await signS3Request(env, 'GET', s3Url);

    try {
        const resp = await fetch(s3Url.toString(), { headers: signedRequest.headers });
        if (!resp.ok) {
            const body = await resp.text();
            console.error('[S3列表] HTTP', resp.status, body);
            return jsonResponse({ error: 'S3 请求失败' }, 502);
        }

        const xml = await resp.text();
        const images = parseS3ListXml(xml, prefix, deviceId, env);

        return jsonResponse({ success: true, images });
    } catch (err) {
        console.error('[S3列表] 异常:', err.message);
        return jsonResponse({ error: err.message }, 500);
    }
}

// 上传图片到 S3
async function uploadImage(request, env) {
    try {
        const formData = await request.formData();
        const file = formData.get('image');
        const deviceId = formData.get('deviceId');

        if (!file || !file.name) return jsonResponse({ error: '请选择图片文件' }, 400);
        if (!deviceId || deviceId === '0') return jsonResponse({ error: '缺少 deviceId 参数' }, 400);
        if (file.size > 5 * 1024 * 1024) return jsonResponse({ error: '图片大小不能超过5MB' }, 400);

        // 生成唯一文件名
        const ext = file.name.includes('.') ? '.' + file.name.split('.').pop().toLowerCase() : '.png';
        const filename = `${Date.now()}_${crypto.randomUUID().slice(0, 6)}${ext}`;
        const s3Key = `${S3_BASE}/images/${deviceId}/${filename}`;
        const s3Url = new URL(`${env.S3_ENDPOINT}/${env.S3_BUCKET}/${encodeURI(s3Key)}`);

        const body = await file.arrayBuffer();
        const contentType = file.type || 'application/octet-stream';

        const signedRequest = await signS3Request(env, 'PUT', s3Url, body, contentType);

        const resp = await fetch(s3Url.toString(), {
            method: 'PUT',
            headers: signedRequest.headers,
            body: new Uint8Array(body),
        });

        if (!resp.ok && resp.status !== 200) {
            const text = await resp.text();
            console.error('[S3上传] HTTP', resp.status, text);
            return jsonResponse({ error: '上传到 S3 失败' }, 502);
        }

        // ★ 上传后验证：HEAD 请求确认文件已落盘，防止假成功
        try {
            const headSigned = await signS3Request(env, 'HEAD', s3Url);
            const headResp = await fetch(s3Url.toString(), { method: 'HEAD', headers: headSigned.headers });
            if (!headResp.ok) {
                console.error('[S3上传] HEAD 验证失败: HTTP', headResp.status, s3Key);
                return jsonResponse({ error: '图片上传后验证失败，请重试' }, 500);
            }
        } catch (headErr) {
            console.error('[S3上传] HEAD 验证异常:', headErr.message, s3Key);
            return jsonResponse({ error: '图片上传后验证失败，请重试' }, 500);
        }

        const imageUrl = `/api/images/${deviceId}/${filename}`;

        return jsonResponse({ success: true, url: imageUrl, key: s3Key });
    } catch (err) {
        console.error('[S3上传] 异常:', err.message);
        return jsonResponse({ error: err.message }, 500);
    }
}

// 删除 S3 图片
async function deleteImage(env, deviceId, filename) {
    if (!deviceId || deviceId === '0') return jsonResponse({ error: '缺少 deviceId' }, 400);

    const s3Key = `${S3_BASE}/images/${deviceId}/${filename}`;
    const s3Url = new URL(`${env.S3_ENDPOINT}/${env.S3_BUCKET}/${encodeURI(s3Key)}`);

    const signedRequest = await signS3Request(env, 'DELETE', s3Url);

    try {
        const resp = await fetch(s3Url.toString(), {
            method: 'DELETE',
            headers: signedRequest.headers,
        });

        if (!resp.ok && resp.status !== 204) {
            return jsonResponse({ error: 'S3 删除失败' }, 502);
        }

        return jsonResponse({ success: true });
    } catch (err) {
        console.error('[S3删除] 异常:', err.message);
        return jsonResponse({ error: err.message }, 500);
    }
}

// 代理 S3 图片（签名后读取二进制数据返回，不走公开读重定向）
async function proxyImage(env, deviceId, filename) {
    const s3Url = new URL(`${env.S3_ENDPOINT}/${env.S3_BUCKET}/${S3_BASE}/images/${deviceId}/${encodeURIComponent(filename)}`);
    const signedRequest = await signS3Request(env, 'GET', s3Url);

    try {
        const resp = await fetch(s3Url.toString(), {
            method: 'GET',
            headers: signedRequest.headers,
        });
        if (!resp.ok) {
            return new Response('Image not found', { status: resp.status });
        }
        const contentType = resp.headers.get('Content-Type') || 'application/octet-stream';
        // 流式传输：直接传递 body 流，边下边发（不缓冲整个文件）
        return new Response(resp.body, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=86400, immutable',
            },
        });
    } catch (err) {
        return new Response('S3 fetch error: ' + err.message, { status: 500 });
    }
}

// 代理 S3 附件（签名后读取二进制数据返回）
async function proxyAttachment(env, deviceId, filename) {
    const s3Url = new URL(`${env.S3_ENDPOINT}/${env.S3_BUCKET}/${S3_BASE}/attachments/${deviceId}/${encodeURIComponent(filename)}`);
    const signedRequest = await signS3Request(env, 'GET', s3Url);

    try {
        const resp = await fetch(s3Url.toString(), {
            method: 'GET',
            headers: signedRequest.headers,
        });
        if (!resp.ok) {
            return new Response('Attachment not found', { status: resp.status });
        }
        const contentType = resp.headers.get('Content-Type') || 'application/octet-stream';
        // 流式传输：直接传递 body 流，边下边发（不缓冲整个文件）
        return new Response(resp.body, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=86400, immutable',
                'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
            },
        });
    } catch (err) {
        return new Response('S3 fetch error: ' + err.message, { status: 500 });
    }
}

// ============ 附件操作 ============

async function listAttachments(env, deviceId) {
    if (!deviceId || deviceId === '0') {
        return jsonResponse({ success: true, attachments: [] });
    }

    const prefix = `${S3_BASE}/attachments/${deviceId}/`;
    const s3Url = new URL(`${env.S3_ENDPOINT}/${env.S3_BUCKET}`);
    s3Url.searchParams.set('list-type', '2');
    s3Url.searchParams.set('prefix', prefix);
    s3Url.searchParams.set('max-keys', '100');

    const signedRequest = await signS3Request(env, 'GET', s3Url);

    try {
        const resp = await fetch(s3Url.toString(), { headers: signedRequest.headers });
        if (!resp.ok) {
            return jsonResponse({ error: 'S3 请求失败' }, 502);
        }
        const xml = await resp.text();
        const attachments = parseS3ListAttachmentsXml(xml, prefix, env);
        return jsonResponse({ success: true, attachments });
    } catch (err) {
        console.error('[S3附件列表] 异常:', err.message);
        return jsonResponse({ error: err.message }, 500);
    }
}

async function uploadAttachment(request, env) {
    try {
        const formData = await request.formData();
        const file = formData.get('attachment');
        const deviceId = formData.get('deviceId');

        if (!file || !file.name) return jsonResponse({ error: '请选择附件文件' }, 400);
        if (!deviceId || deviceId === '0') return jsonResponse({ error: '缺少 deviceId 参数' }, 400);
        if (file.size > 20 * 1024 * 1024) return jsonResponse({ error: '附件大小不能超过20MB' }, 400);

        const ext = file.name.includes('.') ? '.' + file.name.split('.').pop().toLowerCase() : '';
        const baseName = ext
            ? file.name.slice(0, file.name.length - ext.length).replace(/[\/\\:*?"<>|]/g, '_').substring(0, 200)
            : file.name.replace(/[\/\\:*?"<>|]/g, '_').substring(0, 200);
        const filename = `${Date.now()}_${crypto.randomUUID().slice(0, 6)}_${encodeURIComponent(baseName)}${ext}`;
        const s3Key = `${S3_BASE}/attachments/${deviceId}/${filename}`;
        const s3Url = new URL(`${env.S3_ENDPOINT}/${env.S3_BUCKET}/${encodeURI(s3Key)}`);

        const body = await file.arrayBuffer();
        const contentType = file.type || 'application/octet-stream';

        const signedRequest = await signS3Request(env, 'PUT', s3Url, body, contentType);

        const resp = await fetch(s3Url.toString(), {
            method: 'PUT',
            headers: signedRequest.headers,
            body: new Uint8Array(body),
        });

        if (!resp.ok && resp.status !== 200) {
            return jsonResponse({ error: '上传到 S3 失败' }, 502);
        }

        // ★ 上传后验证：HEAD 请求确认文件已落盘，防止假成功
        try {
            const headSigned = await signS3Request(env, 'HEAD', s3Url);
            const headResp = await fetch(s3Url.toString(), { method: 'HEAD', headers: headSigned.headers });
            if (!headResp.ok) {
                console.error('[S3附件上传] HEAD 验证失败: HTTP', headResp.status, s3Key);
                return jsonResponse({ error: '附件上传后验证失败，请重试' }, 500);
            }
        } catch (headErr) {
            console.error('[S3附件上传] HEAD 验证异常:', headErr.message, s3Key);
            return jsonResponse({ error: '附件上传后验证失败，请重试' }, 500);
        }

        const attachmentUrl = `/api/attachments/${deviceId}/${encodeURIComponent(filename)}`;

        return jsonResponse({
            success: true,
            url: attachmentUrl,
            key: s3Key,
            filename,
            originalName: file.name,
            size: file.size,
        });
    } catch (err) {
        console.error('[S3附件上传] 异常:', err.message);
        return jsonResponse({ error: err.message }, 500);
    }
}

async function deleteAttachment(env, deviceId, filename) {
    if (!deviceId || deviceId === '0') return jsonResponse({ error: '缺少 deviceId' }, 400);

    const s3Key = `${S3_BASE}/attachments/${deviceId}/${filename}`;
    const s3Url = new URL(`${env.S3_ENDPOINT}/${env.S3_BUCKET}/${encodeURI(s3Key)}`);

    const signedRequest = await signS3Request(env, 'DELETE', s3Url);

    try {
        const resp = await fetch(s3Url.toString(), {
            method: 'DELETE',
            headers: signedRequest.headers,
        });
        if (!resp.ok && resp.status !== 204) {
            return jsonResponse({ error: 'S3 删除失败' }, 502);
        }
        return jsonResponse({ success: true });
    } catch (err) {
        console.error('[S3附件删除] 异常:', err.message);
        return jsonResponse({ error: err.message }, 500);
    }
}

// ============ S3 工具函数 ============

// AWS Signature V4 签名
async function signS3Request(env, method, s3Url, body, contentType) {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z'; // YYYYMMDD'T'HHMMSS'Z'
    const dateStamp = amzDate.slice(0, 8);

    const region = env.S3_REGION || 'us-east-1';
    const service = 's3';
    const host = s3Url.host;
    const canonicalUri = s3Url.pathname;
    const canonicalQuery = s3Url.searchParams.toString()
        .split('&').sort().join('&')
        .replace(/\+/g, '%20');  // AWS S3 签名 V4 要求 query string 空格为 %20 而非 +

    const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const payloadHash = body ? await sha256Hash(body) : 'UNSIGNED-PAYLOAD';

    const headersToSign = {
        'host': host,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
    };

    // 对于 PUT，添加 Content-Type 到头
    if (method === 'PUT' && contentType) {
        headersToSign['content-type'] = contentType;
    }

    const signedHeaders = Object.keys(headersToSign).sort().join(';');

    const canonicalHeaders = Object.keys(headersToSign)
        .sort()
        .map(k => `${k}:${headersToSign[k]}`)
        .join('\n') + '\n';

    const canonicalRequest = [
        method,
        canonicalUri,
        canonicalQuery,
        canonicalHeaders,
        signedHeaders,
        payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        await sha256Hash(new TextEncoder().encode(canonicalRequest)),
    ].join('\n');

    const key = await _hmacSha256(
        await _hmacSha256(
            await _hmacSha256(
                await _hmacSha256(
                    new TextEncoder().encode('AWS4' + env.S3_SECRET_KEY),
                    new TextEncoder().encode(dateStamp)
                ),
                new TextEncoder().encode(region)
            ),
            new TextEncoder().encode(service)
        ),
        new TextEncoder().encode('aws4_request')
    );

    const signature = _hex(await _hmacSha256(key, new TextEncoder().encode(stringToSign)));

    const authorization = `AWS4-HMAC-SHA256 Credential=${env.S3_ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
        headers: {
            ...headersToSign,
            'Authorization': authorization,
        }
    };
}

// SHA256 哈希（Web Crypto API）
async function sha256Hash(data) {
    let buf = data;
    if (typeof data === 'string') buf = new TextEncoder().encode(data);
    else if (data instanceof ArrayBuffer) buf = new Uint8Array(data);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return _hex(hash);
}

// HMAC-SHA256
function _hmacSha256(key, data) {
    return crypto.subtle.importKey(
        'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    ).then(k => crypto.subtle.sign('HMAC', k, data));
}

// 字节数组转十六进制
function _hex(buffer) {
    const arr = new Uint8Array(buffer);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// 解析 S3 ListObjectsV2 XML 响应
function parseS3ListXml(xml, prefix, env) {
    const images = [];
    // 简单正则解析（避免引入 XML 解析器）
    const contents = xml.match(/<Contents>[\s\S]*?<\/Contents>/g) || [];
    for (const content of contents) {
        const keyMatch = content.match(/<Key>([^<]+)<\/Key>/);
        const sizeMatch = content.match(/<Size>(\d+)<\/Size>/);
        const timeMatch = content.match(/<LastModified>([^<]+)<\/LastModified>/);
        if (keyMatch) {
            const key = keyMatch[1];
            if (key.endsWith('/')) continue; // 跳过目录占位符
            const filename = key.replace(prefix, '');
            images.push({
                filename,
                key,
                size: sizeMatch ? parseInt(sizeMatch[1]) : 0,
                lastModified: timeMatch ? timeMatch[1] : '',
                url: `${env.S3_PUBLIC_URL}/${key}`,
            });
        }
    }
    // 修正 URL：使用代理路径
    const deviceId = prefix.replace(`${S3_BASE}/images/`, '').replace('/', '');
    images.forEach(img => {
        img.url = `/api/images/${deviceId}/${img.filename}`;
    });
    return images;
}

// 解析 S3 List 响应用于附件
function parseS3ListAttachmentsXml(xml, prefix, env) {
    const attachments = [];
    const contents = xml.match(/<Contents>[\s\S]*?<\/Contents>/g) || [];
    for (const content of contents) {
        const keyMatch = content.match(/<Key>([^<]+)<\/Key>/);
        const sizeMatch = content.match(/<Size>(\d+)<\/Size>/);
        const timeMatch = content.match(/<LastModified>([^<]+)<\/LastModified>/);
        if (keyMatch) {
            const key = keyMatch[1];
            if (key.endsWith('/')) continue;
            const filename = key.replace(prefix, '');
            const parts = filename.match(/^(\d+)_([0-9a-f]+)_(.+)$/);
            const displayName = parts ? decodeURIComponent(parts[3]) : filename;
            attachments.push({
                filename,
                displayName,
                key,
                size: sizeMatch ? parseInt(sizeMatch[1]) : 0,
                lastModified: timeMatch ? timeMatch[1] : '',
                url: `/api/attachments/${key.replace(`${S3_BASE}/attachments/`, '').split('/').slice(0, 1)[0]}/${encodeURIComponent(filename)}`,
            });
        }
    }
    // 修正 URL：使用代理路径和 deviceId
    const attDeviceId = prefix.replace(`${S3_BASE}/attachments/`, '').replace('/', '');
    attachments.forEach(att => {
        att.url = `/api/attachments/${attDeviceId}/${encodeURIComponent(att.filename)}`;
    });
    return attachments;
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
