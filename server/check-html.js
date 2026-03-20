const http = require('http');

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/',
    method: 'GET'
};

const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        // 查找 renderDevices 函数
        const match = data.match(/function renderDevices\(devices\)[\s\S]*?^        \}/m);
        if (match) {
            console.log('找到 renderDevices 函数');
            // 检查是否有重复的标签渲染逻辑
            const func = match[0];
            const tagMatches = func.match(/tagHtml/g);
            console.log(`tagHtml 出现次数: ${tagMatches ? tagMatches.length : 0}`);
            
            // 检查 uniqueTags
            const uniqueMatches = func.match(/uniqueTags/g);
            console.log(`uniqueTags 出现次数: ${uniqueMatches ? uniqueMatches.length : 0}`);
        }
    });
});

req.on('error', (e) => {
    console.error(`请求失败: ${e.message}`);
});

req.end();
