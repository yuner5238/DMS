// Cloudflare Pages Functions - 中间件
// 拦截所有 /api/* 请求并代理到 Worker

const WORKER_API_URL = 'https://dms-worker.171519019.workers.dev/api';

export async function onRequest(context) {
    const url = new URL(context.request.url);

    // 只处理 /api/* 路径的请求
    if (!url.pathname.startsWith('/api')) {
        return context.next();
    }

    const path = url.pathname.replace(/^\/api/, '');
    const workerUrl = `${WORKER_API_URL}${path}${url.search}`;

    try {
        // 代理请求到 Worker
        const response = await fetch(workerUrl, {
            method: context.request.method,
            headers: context.request.headers,
            body: ['GET', 'HEAD'].includes(context.request.method) ? undefined : await context.request.blob()
        });

        // 添加 CORS 头
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        };

        // 处理 OPTIONS 预检请求
        if (context.request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        // 返回响应
        const newResponse = new Response(response.body, {
            status: response.status,
            headers: {
                ...Object.fromEntries(response.headers.entries()),
                ...corsHeaders
            }
        });

        return newResponse;
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
