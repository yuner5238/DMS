const http = require('http');

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/devices?warehouseId=1',
    method: 'GET'
};

const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        const devices = JSON.parse(data);
        console.log('API 返回的设备数据:');
        devices.forEach(d => {
            console.log(`\n设备: ${d.name}`);
            console.log(`  tags: ${JSON.stringify(d.tags)}`);
            console.log(`  tag_names: ${d.tag_names}`);
        });
    });
});

req.on('error', (e) => {
    console.error(`请求失败: ${e.message}`);
});

req.end();
