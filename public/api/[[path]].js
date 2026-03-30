// Cloudflare Pages Functions - API 代理
// 将前端请求代理到后端 Worker

const WORKER_API_URL = 'https://dms-worker.171519019.workers.dev/api';

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api/, '');

    // 构造 Worker API URL
    const workerUrl = `${WORKER_API_URL}${path}${url.search}`;

    try {
        // 代理请求到 Worker
        const response = await fetch(workerUrl, {
            method: request.method,
            headers: request.headers,
            body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.blob()
        });

        // 添加 CORS 头
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        };

        // 处理 OPTIONS 预检请求
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        // 返回响应
        const contentType = response.headers.get('content-type') || 'application/json';
        return new Response(response.body, {
            status: response.status,
            headers: {
                ...Object.fromEntries(response.headers.entries()),
                ...corsHeaders
            }
        });
    } catch (error) {
        console.error('API 代理错误:', error);
        return new Response(JSON.stringify({
            error: 'API 请求失败: ' + error.message
        }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}
